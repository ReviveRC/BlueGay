//! Signed updates for the portable Windows executable. No arbitrary install paths
//! or download URLs are accepted from the webview.
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::PathBuf, sync::Mutex, time::Duration};
use tauri::Manager;

const MAX_EXE: u64 = 128 * 1024 * 1024;
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const PUBLIC_KEY: &[u8] = include_bytes!("../updater-public.pem");
type Result<T> = std::result::Result<T,String>;
#[derive(Clone, Deserialize, Serialize)]
struct Release { iss:String, aud:String, exp:u64, version:String, url:String, sha256:String, size:u64, notes:String }
#[derive(Serialize, Deserialize)]
struct Prepared { target:PathBuf, staged:PathBuf, sha256:String, old_sha256:String, pid:u32 }
#[derive(Default)]
pub struct UpdateState { candidate:Mutex<Option<String>>, prepared:Mutex<Option<PathBuf>>, busy:std::sync::atomic::AtomicBool }
struct Busy<'a>(&'a std::sync::atomic::AtomicBool);
impl Drop for Busy<'_> { fn drop(&mut self){self.0.store(false,std::sync::atomic::Ordering::SeqCst);} }
fn busy(state:&UpdateState)->Result<Busy<'_>> {
    if state.busy.swap(true,std::sync::atomic::Ordering::SeqCst){return Err("An update operation is already running.".into());}Ok(Busy(&state.busy))
}
fn version(value:&str)->Result<[u64;3]> {
    let parts:Vec<_>=value.split('.').collect();
    if parts.len()!=3{return Err("Update versions must use major.minor.patch.".into());}
    let mut result=[0;3];
    for (i,part) in parts.iter().enumerate(){
        if part.is_empty()||!part.bytes().all(|b|b.is_ascii_digit())||(part.len()>1&&part.starts_with('0')){return Err("Invalid update version.".into());}
        result[i]=part.parse().map_err(|_|"Invalid update version.")?;
    }Ok(result)
}
fn https(value:&str)->Result<reqwest::Url> {
    let url=reqwest::Url::parse(value).map_err(|_|"Enter a valid HTTPS update URL.")?;
    if url.scheme()!="https"||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.fragment().is_some(){return Err("Updates require an HTTPS URL without credentials or fragments.".into());}Ok(url)
}
fn verify(token:&str)->Result<Release> { verify_with_key(token,PUBLIC_KEY) }
fn verify_with_key(token:&str,key:&[u8])->Result<Release> {
    let mut validation=Validation::new(Algorithm::RS256);
    validation.set_issuer(&["bluegay-updates"]);validation.set_audience(&["bluegay-windows-x64"]);validation.leeway=0;
    let release=decode::<Release>(token.trim(),&DecodingKey::from_rsa_pem(key).map_err(|_|"Invalid embedded update key.")?,&validation)
        .map_err(|_|"The update signature is invalid or expired. Nothing was installed.")?.claims;
    version(&release.version)?;https(&release.url)?;
    if release.size<2||release.size>MAX_EXE||release.sha256.len()!=64||!release.sha256.bytes().all(|b|b.is_ascii_hexdigit())||release.notes.len()>16000{return Err("Invalid update release metadata.".into());}
    Ok(release)
}
fn endpoint(app:&tauri::AppHandle)->Result<String> {
    let file=app.path().app_config_dir().map_err(|e|e.to_string())?.join("updater-source.json");
    let config:Value=if file.exists(){serde_json::from_slice(&fs::read(file).map_err(|e|e.to_string())?).map_err(|_|"Invalid updater configuration.")?}
        else{serde_json::from_str(include_str!("../updater-config.json")).map_err(|e|e.to_string())?};
    Ok(config["endpoint"].as_str().unwrap_or("").into())
}
fn client()->Result<reqwest::Client> {
    reqwest::Client::builder().https_only(true).connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(180))
        .user_agent(concat!("BlueGay/",env!("CARGO_PKG_VERSION"))).build().map_err(|e|e.to_string())
}
async fn bounded(mut response:reqwest::Response,limit:u64)->Result<Vec<u8>> {
    if !response.status().is_success(){return Err(format!("The update server returned HTTP {}.",response.status().as_u16()));}
    if response.content_length().is_some_and(|n|n>limit){return Err("Update download exceeds its size limit.".into());}
    let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"Update download interrupted. Your current version was kept.")?{
        if bytes.len() as u64+chunk.len() as u64>limit{return Err("Update download exceeds its size limit.".into());}bytes.extend_from_slice(&chunk);
    }Ok(bytes)
}
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn validate_exe(bytes:&[u8],release:&Release)->Result<()> {
    if bytes.len() as u64!=release.size||!hash(bytes).eq_ignore_ascii_case(&release.sha256){return Err("Update checksum mismatch. Your current version was kept.".into());}
    if !bytes.starts_with(b"MZ"){return Err("The update is not a Windows executable.".into());}Ok(())
}
#[tauri::command]
pub fn update_info(app:tauri::AppHandle)->Result<Value>{Ok(json!({"currentVersion":CURRENT,"endpoint":endpoint(&app)?}))}
#[tauri::command]
pub fn update_source(app:tauri::AppHandle,state:tauri::State<'_,UpdateState>,url:String)->Result<()> {
    let _busy=busy(&state)?;let url=url.trim();if !url.is_empty(){https(url)?;}
    let dir=app.path().app_config_dir().map_err(|e|e.to_string())?;fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let mut tmp=tempfile::NamedTempFile::new_in(&dir).map_err(|e|e.to_string())?;
    tmp.write_all(json!({"endpoint":url}).to_string().as_bytes()).map_err(|e|e.to_string())?;
    tmp.persist(dir.join("updater-source.json")).map_err(|e|e.to_string())?;
    *state.candidate.lock().map_err(|_|"Updater unavailable.")?=None;
    if let Some(job)=state.prepared.lock().map_err(|_|"Updater unavailable.")?.take(){let _=fs::remove_dir_all(job.parent().unwrap());}Ok(())
}
#[tauri::command]
pub async fn update_check(app:tauri::AppHandle,state:tauri::State<'_,UpdateState>)->Result<Value> {
    let _busy=busy(&state)?;
    *state.candidate.lock().map_err(|_|"Updater unavailable.")?=None;
    let source=endpoint(&app)?;if source.is_empty(){return Ok(json!({"configured":false,"currentVersion":CURRENT,"available":false}));}
    let bytes=bounded(client()?.get(https(&source)?).send().await.map_err(|_|"Cannot reach the update server.")?,64*1024).await?;
    let token=String::from_utf8(bytes).map_err(|_|"Invalid update manifest.")?;let release=verify(&token)?;
    let newer=version(&release.version)?>version(CURRENT)?;
    if newer{*state.candidate.lock().map_err(|_|"Updater unavailable.")?=Some(token);}
    Ok(json!({"configured":true,"currentVersion":CURRENT,"available":newer,"version":release.version,"notes":release.notes}))
}
#[tauri::command]
pub async fn update_prepare(state:tauri::State<'_,UpdateState>)->Result<()> {
    let _busy=busy(&state)?;
    if state.prepared.lock().map_err(|_|"Updater unavailable.")?.is_some(){return Ok(());}
    let token=state.candidate.lock().map_err(|_|"Updater unavailable.")?.clone().ok_or("Check for an update first.")?;
    let release=verify(&token)?;if version(&release.version)?<=version(CURRENT)?{return Err("This update is not newer than your installed version.".into());}
    let bytes=bounded(client()?.get(https(&release.url)?).send().await.map_err(|_|"Cannot download the update.")?,release.size).await?;
    validate_exe(&bytes,&release)?;
    let target=std::env::current_exe().map_err(|e|e.to_string())?;
    // Write beside the existing EXE so replacement is a same-volume rename.
    // A portable EXE in a read-only folder fails here, before the app closes.
    let dir=tempfile::Builder::new().prefix(".bluegay-update-").tempdir_in(target.parent().ok_or("Executable folder unavailable.")?).map_err(|_|"The executable folder is not writable. Move BlueGay to a writable folder and try again.")?;
    let staged=dir.path().join("BlueGay.exe");fs::write(&staged,bytes).map_err(|e|e.to_string())?;
    let job=Prepared{old_sha256:hash(&fs::read(&target).map_err(|e|e.to_string())?),target,staged,sha256:release.sha256,pid:std::process::id()};
    let path=dir.path().join("job.json");fs::write(&path,serde_json::to_vec(&job).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    fs::write(dir.path().join("install.ps1"),include_str!("../../scripts/install-update.ps1")).map_err(|e|e.to_string())?;
    let _=dir.keep();*state.prepared.lock().map_err(|_|"Updater unavailable.")?=Some(path);Ok(())
}
#[tauri::command]
pub fn update_install(app:tauri::AppHandle,state:tauri::State<'_,UpdateState>)->Result<()> {
    let _busy=busy(&state)?;
    let path=state.prepared.lock().map_err(|_|"Updater unavailable.")?.clone().ok_or("Download the update first.")?;
    let token=state.candidate.lock().map_err(|_|"Updater unavailable.")?.clone().ok_or("Check for an update first.")?;
    let release=verify(&token)?;
    let job:Prepared=serde_json::from_slice(&fs::read(&path).map_err(|_|"Staged update unavailable. Check for updates again.")?).map_err(|_|"Invalid staged update.")?;
    let current=std::env::current_exe().map_err(|e|e.to_string())?;
    if job.target!=current||job.staged!=path.parent().unwrap().join("BlueGay.exe")||!job.sha256.eq_ignore_ascii_case(&release.sha256)||hash(&fs::read(&current).map_err(|e|e.to_string())?)!=job.old_sha256{return Err("Staged update changed. Your current version was kept.".into());}
    validate_exe(&fs::read(&job.staged).map_err(|_|"Staged update unavailable.")?,&release)?;
    #[cfg(windows)]{
        use std::os::windows::process::CommandExt;
        // Launch the Windows-supplied shell by absolute path. All variable data
        // is passed through a JSON file, never interpolated into shell code.
        let shell=PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows directory unavailable.")?).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        std::process::Command::new(shell).args(["-NoProfile","-NonInteractive","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File"])
            .arg(path.parent().unwrap().join("install.ps1")).arg("-JobPath").arg(&path)
            .creation_flags(0x08000000).spawn().map_err(|_|"Could not start the updater. Your current version was kept.")?;
        app.exit(0);Ok(())
    }
    #[cfg(not(windows))]{let _=(app,path);Err("Portable updates are available on Windows.".into())}
}
#[cfg(test)]mod tests{
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    #[test]fn versions_never_downgrade(){assert!(version("1.10.0").unwrap()>version("1.9.9").unwrap());assert!(version(CURRENT).is_ok());for bad in ["1","1.0","01.0.0","1.0.0-beta","1.0.-1"]{assert!(version(bad).is_err());}}
    #[test]fn rejects_unsafe_sources_and_unsigned_metadata(){for url in ["http://example.com/latest.jwt","file:///C:/app.exe","https://user:pass@example.com/a","https://example.com/a#b"]{assert!(https(url).is_err());}assert!(https("https://example.com/latest.jwt").is_ok());assert!(verify("unsigned").is_err());let token=format!("e30.{}.invalid",URL_SAFE_NO_PAD.encode(b"{}"));assert!(verify(&token).is_err());}
    #[test]fn corrupt_or_non_executable_downloads_are_rejected(){let bytes=b"MZtest";let mut release=Release{iss:"bluegay-updates".into(),aud:"bluegay-windows-x64".into(),exp:u64::MAX,version:"1.1.0".into(),url:"https://example.com/a.exe".into(),sha256:hash(bytes),size:bytes.len() as u64,notes:String::new()};assert!(validate_exe(bytes,&release).is_ok());assert!(validate_exe(b"MZevil",&release).is_err());release.sha256=hash(b"notexe");assert!(validate_exe(b"notexe",&release).is_err());}
    #[test]fn signed_releases_require_the_pinned_key_audience_and_expiry(){
        use jsonwebtoken::{encode,Header,EncodingKey};
        // This fixture key has no relationship to the production update key.
        let public=include_bytes!("../../tests/fixtures/update-signing/test-public.pem");
        let private=EncodingKey::from_rsa_pem(include_bytes!("../../tests/fixtures/update-signing/test-private.pem")).unwrap();
        let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let mut release=Release{iss:"bluegay-updates".into(),aud:"bluegay-windows-x64".into(),exp:now+3600,version:"1.0.1".into(),url:"https://example.invalid/BlueGay.exe".into(),sha256:hash(b"MZtest"),size:6,notes:"Release notes".into()};
        let token=encode(&Header::new(Algorithm::RS256),&release,&private).unwrap();
        assert_eq!(verify_with_key(&token,public).unwrap().version,"1.0.1");
        assert!(verify(&token).is_err(),"Test keys must never authenticate production updates");
        let mut parts:Vec<_>=token.split('.').map(String::from).collect();
        parts[1]=URL_SAFE_NO_PAD.encode(b"{}");assert!(verify_with_key(&parts.join("."),public).is_err());
        release.aud="other-app".into();assert!(verify_with_key(&encode(&Header::new(Algorithm::RS256),&release,&private).unwrap(),public).is_err());
        release.aud="bluegay-windows-x64".into();release.exp=now-3600;assert!(verify_with_key(&encode(&Header::new(Algorithm::RS256),&release,&private).unwrap(),public).is_err());
    }
}
