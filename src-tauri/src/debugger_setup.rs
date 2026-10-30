use super::*;
use sha2::{Digest,Sha256};
pub struct JavaPaths {pub launcher:Option<PathBuf>,pub config:PathBuf,pub bundle:Option<PathBuf>}
pub fn junit_jar(home:&Path)->PathBuf{home.join("java-tests/junit-platform-console-standalone-1.13.4.jar")}
fn install_junit(home:&Path,manifest:&Value)->Result<()>{
    let jar=junit_jar(home);fs::create_dir_all(jar.parent().unwrap()).map_err(err)?;
    let expected=text(&manifest["junit"],"sha256")?;
    if !fs::read(&jar).map(|b|format!("{:x}",Sha256::digest(b))==expected).unwrap_or(false){tauri::async_runtime::block_on(download(text(&manifest["junit"],"url")?,&jar,expected))?;}
    Ok(())
}
pub fn hash(value:&str)->String{format!("{:x}",Sha256::digest(value.as_bytes()))[..24].into()}
fn find_file(folder:&Path,prefix:&str,suffix:&str)->Option<PathBuf>{fs::read_dir(folder).ok()?.filter_map(|e|e.ok()).map(|e|e.path()).find(|p|p.file_name().and_then(|s|s.to_str()).map(|s|s.starts_with(prefix)&&s.ends_with(suffix)).unwrap_or(false))}
pub fn java_paths(home:&Path)->JavaPaths{
    let server=home.join("java/jdtls/extension/server");
    JavaPaths{launcher:find_file(&server.join("plugins"),"org.eclipse.equinox.launcher_",".jar"),config:server.join("config_win"),bundle:find_file(&home.join("java/java-debug/extension/server"),"com.microsoft.java.debug.plugin-",".jar")}
}
fn probe(program:&str,args:&[&str],python_path:Option<&Path>)->Option<String>{
    if program.is_empty(){return None;}
    let mut command=hidden(program);command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(path)=python_path{command.env("PYTHONPATH",path);}
    let mut child=command.spawn().ok()?;let start=std::time::Instant::now();
    loop{match child.try_wait(){Ok(Some(_))=>break,Ok(None)=>{if start.elapsed()>Duration::from_secs(6){kill_tree(&mut child);return None;}thread::sleep(Duration::from_millis(20));},Err(_)=>return None}}
    let output=child.wait_with_output().ok()?;if !output.status.success(){return None;}
    Some((String::from_utf8_lossy(&output.stdout).to_string()+&String::from_utf8_lossy(&output.stderr)).trim().into())
}
pub fn resolve(settings:&Settings)->Settings{
    let mut python=settings.python.clone();let mut java=settings.java.clone();
    if python.is_empty(){
        let mut candidates=vec![];
        if let Some(local)=std::env::var_os("LOCALAPPDATA"){if let Ok(entries)=fs::read_dir(PathBuf::from(local).join("Programs/Python")){for entry in entries.flatten(){let exe=entry.path().join("python.exe");if exe.is_file(){candidates.push(exe.to_string_lossy().to_string());}}}}
        candidates.push("python".into());
        for candidate in candidates{if let Some(path)=probe(&candidate,&["-c","import sys; print(sys.executable)"],None){if Path::new(&path).is_file(){python=path;break;}}}
        if python.is_empty(){if let Some(path)=probe("py",&["-3","-c","import sys; print(sys.executable)"],None){if Path::new(&path).is_file(){python=path;}}}
    }
    if java.is_empty(){
        if let Some(home)=std::env::var_os("JAVA_HOME"){let exe=PathBuf::from(home).join("bin/java.exe");if exe.is_file(){java=exe.to_string_lossy().into();}}
        if java.is_empty(){if let Some(programs)=std::env::var_os("ProgramFiles"){for folder in ["Java","Eclipse Adoptium","Microsoft"]{if let Ok(entries)=fs::read_dir(PathBuf::from(&programs).join(folder)){let mut paths=entries.flatten().map(|e|e.path().join("bin/java.exe")).filter(|p|p.is_file()).collect::<Vec<_>>();paths.sort();if let Some(path)=paths.pop(){java=path.to_string_lossy().into();break;}}}}}
        if java.is_empty(){if let Some(properties)=probe("java",&["-XshowSettings:properties","-version"],None){if let Some(home)=properties.lines().find_map(|line|line.trim().strip_prefix("java.home = ")){java=Path::new(home).join("bin/java.exe").to_string_lossy().into();}}}
    }
    Settings{python,java}
}
fn python_home(home:&Path,settings:&Settings)->PathBuf{home.join("python").join(hash(&settings.python))}
pub fn python_env(command:&mut Command,home:&Path,settings:&Settings){
    let managed=python_home(home,settings);let mut paths=vec![managed];if let Some(existing)=std::env::var_os("PYTHONPATH"){paths.extend(std::env::split_paths(&existing));}if let Ok(path)=std::env::join_paths(paths){command.env("PYTHONPATH",path);}
}
pub fn info(home:&Path,settings:&Settings)->Result<Value>{
    let settings=resolve(settings);let python_version=probe(&settings.python,&["--version"],None);let java_version=probe(&settings.java,&["-version"],None);
    let python_ready=python_version.is_some()&&probe(&settings.python,&["-c","import debugpy; print(debugpy.__version__)"],Some(&python_home(home,&settings))).is_some();
    let java_major=java_version.as_deref().and_then(|s|s.split('"').nth(1)).and_then(|s|s.split('.').next()).and_then(|s|s.parse::<u32>().ok()).unwrap_or(0);
    let paths=java_paths(home);
    Ok(json!({"settings":settings,"pythonVersion":python_version,"javaVersion":java_version,"javaMajor":java_major,"pythonReady":python_ready,"javaReady":java_major>=21&&paths.launcher.is_some()&&paths.config.is_dir()&&paths.bundle.is_some(),"javaTestsReady":junit_jar(home).is_file(),"home":home}))
}
pub fn install(home:&Path,settings:&Settings,language:&str)->Result<Value>{
    let settings=resolve(settings);fs::create_dir_all(home).map_err(err)?;
    let manifest:Value=serde_json::from_str(include_str!("../debugger-assets.json")).map_err(err)?;
    match language{
        "python"=>{
            if settings.python.is_empty(){return Err("Choose a Python interpreter in Debugger settings first.".into());}
            let target=python_home(home,&settings);fs::create_dir_all(&target).map_err(err)?;
            let package=format!("debugpy=={}",manifest["pythonVersion"].as_str().ok_or("Missing Python debugger version")?);
            let output=hidden(&settings.python).args(["-m","pip","install","--isolated","--disable-pip-version-check","--no-input","--no-compile","--upgrade","--index-url","https://pypi.org/simple","--target"]).arg(&target).arg(package).output().map_err(err)?;
            if !output.status.success(){return Err(format!("Cannot install debugpy. Ensure this interpreter has pip. {}",String::from_utf8_lossy(&output.stderr).chars().take(3000).collect::<String>()));}
        }
        "java-tests"=>install_junit(home,&manifest)?,
        "java"=>{
            if settings.java.is_empty(){return Err("Choose a Java 21 or newer JDK in Debugger settings first.".into());}
            let java_dir=home.join("java");fs::create_dir_all(&java_dir).map_err(err)?;
            let script=home.join("extract-debugger.ps1");fs::write(&script,include_str!("../scripts/extract-debugger.ps1")).map_err(err)?;
            for asset in manifest["java"].as_array().ok_or("Missing Java debugger assets")?{
                let id=text(asset,"id")?;let archive=java_dir.join(format!("{id}.zip"));
                let expected=text(asset,"sha256")?;
                let verified=fs::read(&archive).map(|b|format!("{:x}",Sha256::digest(b))==expected).unwrap_or(false);
                if !verified{tauri::async_runtime::block_on(download(text(asset,"url")?,&archive,expected))?;}
                let system=std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(||PathBuf::from("C:\\Windows"));
                let output=hidden(system.join("System32/WindowsPowerShell/v1.0/powershell.exe")).args(["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File"]).arg(&script).arg("-Archive").arg(&archive).arg("-Destination").arg(java_dir.join(id)).output().map_err(err)?;
                if !output.status.success(){return Err(format!("Cannot extract Java debugging tools: {}",String::from_utf8_lossy(&output.stderr).chars().take(2000).collect::<String>()));}
            }
            install_junit(home,&manifest)?;
        }
        _=>return Err("Choose Python or Java debugging tools.".into())
    }
    info(home,&settings)
}
async fn download(url:&str,path:&Path,expected:&str)->Result<()>{
    let client=reqwest::Client::builder().timeout(Duration::from_secs(180)).build().map_err(err)?;
    let mut response=client.get(url).send().await.map_err(|e|format!("Cannot download debugger tools: {e}"))?;
    if !response.status().is_success(){return Err(format!("Debugger download returned HTTP {}",response.status()));}
    let mut file=fs::File::create(path).map_err(err)?;let mut hash=Sha256::new();let mut size=0;
    while let Some(bytes)=response.chunk().await.map_err(err)?{size+=bytes.len();if size>200*1024*1024{return Err("Debugger download exceeds the size limit.".into());}hash.update(&bytes);file.write_all(&bytes).map_err(err)?;}
    if format!("{:x}",hash.finalize())!=expected{return Err("Debugger download checksum mismatch. Nothing was installed.".into());}Ok(())
}
