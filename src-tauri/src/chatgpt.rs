//! Sign in with ChatGPT for this local app. No credentials cross the webview boundary.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::Write, path::PathBuf, sync::Mutex, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener, sync::{watch, Mutex as AsyncMutex}};

const ISSUER: &str = "https://auth.openai.com";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

pub struct ChatGptState {
    pub path: PathBuf,
    gate: AsyncMutex<()>,
    pending: Mutex<Option<watch::Sender<bool>>>,
    message: Mutex<String>,
}
impl ChatGptState {
    pub fn new(path: PathBuf) -> Self { Self { path, gate: AsyncMutex::new(()), pending: Mutex::new(None), message: Mutex::new(String::new()) } }
    fn lock_file(&self) -> Result<File, String> {
        fs::create_dir_all(self.path.parent().ok_or("Account folder unavailable.")?).map_err(|_| "Cannot create account storage.")?;
        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(self.path.with_extension("lock")).map_err(|_| "Cannot lock account storage.")?;
        file.try_lock().map_err(|_| "Accounts are busy in another BlueGay window. Try again shortly.")?;
        Ok(file)
    }
    fn read(&self) -> Result<Vault, String> {
        match fs::read(&self.path) {
            Ok(bytes) => { if bytes.len()>1_000_000 { return Err("Account storage is too large.".into()); } serde_json::from_slice(&protect(&bytes, false)?).map_err(|_| "Cannot read account storage. Existing data was preserved.".into()) }
            Err(e) if e.kind()==std::io::ErrorKind::NotFound => Ok(Vault::default()),
            Err(_) => Err("Cannot read account storage.".into()),
        }
    }
    fn write(&self, vault: &Vault) -> Result<(), String> {
        let bytes=protect(&serde_json::to_vec(vault).map_err(|_| "Cannot encode account storage.")?, true)?;
        let mut file=tempfile::NamedTempFile::new_in(self.path.parent().unwrap()).map_err(|_| "Cannot prepare account storage.")?;
        file.write_all(&bytes).and_then(|_|file.as_file().sync_all()).map_err(|_| "Cannot save account storage.")?;
        file.persist(&self.path).map_err(|_| "Cannot replace account storage.")?;
        Ok(())
    }
}

// DPAPI protects the complete vault for the current Windows user, without Credential Manager's blob-size limit.
#[cfg(windows)]
fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    #[repr(C)] struct Blob { len: u32, data: *mut u8 }
    #[link(name="crypt32")] extern "system" {
        fn CryptProtectData(input: *const Blob, description: *const u16, entropy: *const Blob, reserved: *mut std::ffi::c_void, prompt: *mut std::ffi::c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, description: *mut *mut u16, entropy: *const Blob, reserved: *mut std::ffi::c_void, prompt: *mut std::ffi::c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name="kernel32")] extern "system" { fn LocalFree(memory: *mut std::ffi::c_void) -> *mut std::ffi::c_void; }
    let input=Blob{len:bytes.len().try_into().map_err(|_| "Account storage is too large.")?,data:bytes.as_ptr() as *mut u8};
    let mut output=Blob{len:0,data:std::ptr::null_mut()};
    let result=unsafe {
        if encrypt { CryptProtectData(&input,std::ptr::null(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null_mut(),1,&mut output) }
        else { CryptUnprotectData(&input,std::ptr::null_mut(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null_mut(),1,&mut output) }
    };
    if result==0 { return Err("Windows could not protect or unlock your ChatGPT credentials.".into()); }
    let value=unsafe { std::slice::from_raw_parts(output.data,output.len as usize).to_vec() };
    unsafe { LocalFree(output.data.cast()); }
    Ok(value)
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> { Err("ChatGPT sign-in requires the Windows app.".into()) }

#[derive(Default, Serialize, Deserialize)]
struct Vault { host_id: String, active: Option<String>, accounts: Vec<Account> }
#[derive(Clone, Serialize, Deserialize)]
struct Account { client_id: String, subject: String, name: String, email: String, tokens: Option<Tokens> }
#[derive(Clone, Serialize, Deserialize)]
struct Tokens { access_token: String, refresh_token: String, id_token: String, scope: String, expires_at: u64, #[serde(default)] identity_pending: bool }
impl Account {
    fn public(&self) -> Value { json!({"id":self.client_id,"name":self.name,"email":self.email,"signedIn":self.tokens.is_some(),"planEnabled":self.tokens.as_ref().is_some_and(|t|plan_scope(&t.scope)),"label":format!("{} · {}",if self.email.is_empty(){&self.name}else{&self.email},self.client_id.chars().rev().take(6).collect::<String>().chars().rev().collect::<String>())}) }
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn random() -> Result<String,String> { let mut bytes=[0u8;32];getrandom::fill(&mut bytes).map_err(|_|"Cannot create secure sign-in state.")?;Ok(URL_SAFE_NO_PAD.encode(bytes)) }
fn host_id() -> Result<String,String> { let mut b=[0u8;16];getrandom::fill(&mut b).map_err(|_|"Cannot create host identity.")?;b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;let h=b.iter().map(|b|format!("{b:02x}")).collect::<String>();Ok(format!("urn:uuid:{}-{}-{}-{}-{}",&h[..8],&h[8..12],&h[12..16],&h[16..20],&h[20..])) }
fn plan_scope(scope:&str)->bool { scope.split_whitespace().any(|s|s=="chatgpt.tokens.use.direct") }
fn client()->Result<reqwest::Client,String> {reqwest::Client::builder().timeout(Duration::from_secs(25)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Cannot initialize sign-in connection.".into())}
async fn bounded_json(mut response:reqwest::Response)->Result<Value,String> {
    let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"The OpenAI connection was interrupted.")? { if bytes.len()+chunk.len()>1_000_000{return Err("OpenAI returned an oversized response.".into())}bytes.extend_from_slice(&chunk); }
    serde_json::from_slice(&bytes).map_err(|_|"OpenAI returned an unreadable response.".into())
}
fn auth_endpoint(value:&str)->Result<String,String>{let u=reqwest::Url::parse(value).map_err(|_|"Invalid OpenAI endpoint.")?;if u.scheme()!="https"||u.host_str()!=Some("auth.openai.com")||u.port_or_known_default()!=Some(443)||!u.username().is_empty()||u.password().is_some(){return Err("Untrusted OpenAI endpoint.".into())}Ok(value.into())}
async fn discovery(http:&reqwest::Client)->Result<Value,String>{let response=http.get(format!("{ISSUER}/.well-known/openid-configuration")).send().await.map_err(|_|"Cannot reach OpenAI sign-in. Check your connection.")?;if !response.status().is_success(){return Err("OpenAI sign-in discovery is unavailable.".into())}let value=bounded_json(response).await?;if value["issuer"]!=ISSUER{return Err("Unexpected sign-in issuer.".into())}Ok(value)}

#[derive(Deserialize)]
struct Claims { sub:String, iss:String, aud:Value, exp:u64, iat:u64, nonce:Option<String>, azp:Option<String>, #[serde(default)] name:String, #[serde(default)] email:String }
async fn identity(http:&reqwest::Client,token:&str,client_id:&str,nonce:Option<&str>)->Result<Claims,String>{
    let config=discovery(http).await?;
    let endpoint=auth_endpoint(config["jwks_uri"].as_str().ok_or("Missing identity keys.")?)?;
    let response=http.get(endpoint).send().await.map_err(|_|"Cannot verify the account identity.")?;
    if !response.status().is_success(){return Err("Identity keys are unavailable.".into())}
    let keys:JwkSet=serde_json::from_value(bounded_json(response).await?).map_err(|_|"Invalid identity keys.")?;
    verify_identity(token,&keys,client_id,nonce)
}
fn verify_identity(token:&str,keys:&JwkSet,client_id:&str,nonce:Option<&str>)->Result<Claims,String>{
    let header=decode_header(token).map_err(|_|"Invalid identity token.")?;
    if header.alg!=Algorithm::RS256 {return Err("Unsupported identity signature.".into())}
    let key=keys.find(header.kid.as_deref().ok_or("Missing identity key ID.")?).ok_or("Unknown identity key. Retry sign-in.")?;
    let key=DecodingKey::from_jwk(key).map_err(|_|"Invalid identity key.")?;
    let mut rules=Validation::new(Algorithm::RS256);rules.set_issuer(&[ISSUER]);rules.set_audience(&[client_id]);rules.leeway=5;rules.validate_nbf=true;rules.set_required_spec_claims(&["sub","exp","iat","iss","aud"]);
    let claims=decode::<Claims>(token,&key,&rules).map_err(|_|"Account identity validation failed. Please sign in again.")?.claims;
    validate_claims(&claims,client_id,nonce,now())?;Ok(claims)
}
fn validate_claims(c:&Claims,client_id:&str,nonce:Option<&str>,time:u64)->Result<(),String>{
    let audience=c.aud.as_str()==Some(client_id)||c.aud.as_array().is_some_and(|a|a.iter().any(|s|s.as_str()==Some(client_id)));
    if c.azp.as_deref().is_some_and(|party|party!=client_id)||c.aud.as_array().is_some_and(|a|a.len()>1)&&c.azp.as_deref()!=Some(client_id){return Err("Identity token authorized party did not match.".into())}
    if c.sub.is_empty()||c.iss!=ISSUER||!audience||c.exp.saturating_add(5)<time||c.iat>time+5||nonce.is_some_and(|n|c.nonce.as_deref()!=Some(n)){return Err("Account identity did not match the sign-in attempt.".into())}Ok(())
}
fn tokens(value:&Value,previous:Option<&Tokens>)->Result<Tokens,String>{
    if !value["token_type"].as_str().is_some_and(|s|s.eq_ignore_ascii_case("bearer")){return Err("Unsupported sign-in token type.".into())}
    let access=value["access_token"].as_str().filter(|v|!v.is_empty()).ok_or("No access token returned.")?;
    let expires=value["expires_in"].as_u64().filter(|s|*s>0&&*s<=86400).ok_or("Invalid token expiration.")?;
    let scope=value["scope"].as_str().or_else(||previous.map(|p|p.scope.as_str())).ok_or("No granted permissions returned.")?;
    Ok(Tokens{access_token:access.into(),refresh_token:value["refresh_token"].as_str().filter(|s|!s.is_empty()).or_else(||previous.map(|p|p.refresh_token.as_str())).unwrap_or("").into(),id_token:value["id_token"].as_str().or_else(||previous.map(|p|p.id_token.as_str())).unwrap_or("").into(),scope:scope.into(),expires_at:now()+expires,identity_pending:previous.is_some_and(|p|p.identity_pending||value["id_token"].is_string())})
}

struct Attempt {state:String,nonce:String,verifier:String,redirect:String,existing:Option<Account>}
fn authorization(attempt:&Attempt,host:&str,consent:bool)->Result<String,String>{
    let mut url=reqwest::Url::parse(&format!("{ISSUER}/api/accounts/authorize")).unwrap();
    {let mut q=url.query_pairs_mut();q.append_pair("client_id",attempt.existing.as_ref().map(|a|a.client_id.as_str()).unwrap_or("dynamic_agent_client"))
        .append_pair("ext_agent_host_id",host).append_pair("response_type","code").append_pair("redirect_uri",&attempt.redirect)
        .append_pair("scope",SCOPES).append_pair("resource",RESOURCE).append_pair("state",&attempt.state).append_pair("nonce",&attempt.nonce)
        .append_pair("code_challenge_method","S256").append_pair("code_challenge",&URL_SAFE_NO_PAD.encode(Sha256::digest(attempt.verifier.as_bytes())));
        if let Some(account)=&attempt.existing {if !account.email.is_empty(){q.append_pair("login_hint",&account.email);}}
        else {q.append_pair("agent_name_hint","BlueGay");}
        if consent {q.append_pair("prompt","consent");}
    }Ok(url.into())
}
fn callback_query(target:&str,attempt:&Attempt)->Result<(String,String),String>{
    let url=reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_|"Invalid sign-in callback.")?;
    if url.path()!="/auth/callback" {return Err("Invalid sign-in callback path.".into())}
    let mut params=std::collections::HashMap::new();
    for (k,v) in url.query_pairs(){if params.insert(k.into_owned(),v.into_owned()).is_some(){return Err("Duplicate callback parameter.".into())}}
    if params.get("state")!=Some(&attempt.state){return Err("Sign-in state did not match. Return to BlueGay and try again.".into())}
    if params.contains_key("error"){return Err("ChatGPT sign-in was declined. You can try again or use an API key.".into())}
    let issued=params.get("client_id").cloned().or_else(||attempt.existing.as_ref().map(|a|a.client_id.clone())).ok_or("Registration did not return a client ID.")?;
    if issued=="dynamic_agent_client"||!issued.starts_with("oaiapp_")||issued.len()>200||attempt.existing.as_ref().is_some_and(|a|a.client_id!=issued){return Err("Sign-in returned an unexpected client registration.".into())}
    let code=params.get("code").filter(|s|!s.is_empty()&&s.len()<8192).ok_or("No sign-in code returned.")?.clone();Ok((code,issued))
}
async fn receive_callback(listener:TcpListener,attempt:&Attempt)->Result<(String,String),String>{
    let deadline=tokio::time::Instant::now()+Duration::from_secs(300);
    loop {
        let (mut stream,_)=tokio::time::timeout_at(deadline,listener.accept()).await.map_err(|_|"Sign-in timed out. Please try again.")?.map_err(|_|"Sign-in listener closed.")?;
        let read=async {let mut data=Vec::new();loop{let mut b=[0u8;1024];let n=stream.read(&mut b).await.map_err(|_|"Invalid callback request.")?;if n==0{return Err("Incomplete callback request.")}data.extend_from_slice(&b[..n]);if data.len()>16384{return Err("Callback too large.")}if data.windows(4).any(|w|w==b"\r\n\r\n"){break}}Ok::<_,&str>(data)};
        let Ok(Ok(data))=tokio::time::timeout(Duration::from_secs(3),read).await else{continue};
        let request=String::from_utf8_lossy(&data);let mut parts=request.lines().next().unwrap_or("").split_whitespace();
        let method=parts.next().unwrap_or("");let target=parts.next().unwrap_or("");
        let host=format!("127.0.0.1:{}",reqwest::Url::parse(&attempt.redirect).unwrap().port().unwrap());
        let host_ok=request.lines().any(|l|l.split_once(':').is_some_and(|(k,v)|k.eq_ignore_ascii_case("host")&&v.trim()==host));
        if method!="GET"||!target.starts_with("/auth/callback?")||!host_ok {let _=stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;continue}
        // Unsolicited/stale callbacks do not consume the live transaction.
        let url=reqwest::Url::parse(&format!("http://127.0.0.1{target}"));
        if !url.as_ref().is_ok_and(|u|u.query_pairs().any(|(k,v)|k=="state"&&v==attempt.state)){let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;continue}
        let result=callback_query(target,attempt);
        let body="<!doctype html><title>BlueGay sign-in</title><h1>Return to BlueGay</h1><p>You can close this tab. BlueGay will verify your sign-in and display its result.</p>";
        let reply=format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
        let _=stream.write_all(reply.as_bytes()).await;return result;
    }
}

#[tauri::command]
pub async fn chatgpt_status(state:tauri::State<'_,ChatGptState>)->Result<Value,String>{
    let _gate=state.gate.lock().await;let _file=state.lock_file()?;let vault=state.read()?;
    Ok(json!({"accounts":vault.accounts.iter().map(Account::public).collect::<Vec<_>>(),"activeId":vault.active,"pending":state.pending.lock().map_err(|_|"Account state unavailable.")?.is_some(),"message":state.message.lock().map_err(|_|"Account state unavailable.")?.clone()}))
}
#[tauri::command]
pub async fn chatgpt_login(app:tauri::AppHandle,account_id:Option<String>,consent:bool)->Result<(),String>{
    let state=app.state::<ChatGptState>();
    let listener=TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await.map_err(|_|"Cannot open the local sign-in callback.")?;
    let redirect=format!("http://127.0.0.1:{}/auth/callback",listener.local_addr().map_err(|_|"Cannot read sign-in port.")?.port());
    let (host,existing)={let _gate=state.gate.lock().await;let _file=state.lock_file()?;let mut vault=state.read()?;
        if vault.host_id.is_empty(){vault.host_id=host_id()?;state.write(&vault)?;}
        let existing=match account_id {Some(id)=>Some(vault.accounts.iter().find(|a|a.client_id==id).ok_or("Select a saved account or add a new one.")?.clone()),None=>None};(vault.host_id,existing)};
    let attempt=Attempt{state:random()?,nonce:random()?,verifier:random()?,redirect,existing};
    let url=authorization(&attempt,&host,consent)?;
    let (sender,mut cancelled)=watch::channel(false);
    let cancellation_check=cancelled.clone();
    {let mut pending=state.pending.lock().map_err(|_|"Account state unavailable.")?;if pending.is_some(){return Err("A sign-in is already pending. Finish or cancel it first.".into())}*pending=Some(sender);}
    if let Err(error)=super::open_browser(&url){*state.pending.lock().unwrap()=None;return Err(error)}
    *state.message.lock().unwrap()="Finish signing in in your browser.".into();
    tauri::async_runtime::spawn(async move {
        let state=app.state::<ChatGptState>();
        let flow=async {
            let (code,issued)=receive_callback(listener,&attempt).await?;
            let http=client()?;
            let response=http.post(TOKEN).form(&[("grant_type","authorization_code"),("client_id",issued.as_str()),("code",code.as_str()),("code_verifier",attempt.verifier.as_str()),("redirect_uri",attempt.redirect.as_str()),("resource",RESOURCE)]).send().await.map_err(|_|"Could not complete ChatGPT sign-in. Please retry.")?;
            if !response.status().is_success(){return Err("ChatGPT could not exchange this sign-in code. Please start sign-in again.".into())}
            let saved=tokens(&bounded_json(response).await?,None)?;
            let claims=identity(&http,&saved.id_token,&issued,Some(&attempt.nonce)).await?;
            if attempt.existing.as_ref().is_some_and(|a|a.subject!=claims.sub){return Err("That identity differs from the selected account. Use Add account instead.".into())}
            let enabled=plan_scope(&saved.scope);
            let account=Account{client_id:issued.clone(),subject:claims.sub,name:claims.name,email:claims.email,tokens:Some(saved)};
            let _gate=state.gate.lock().await;let _file=state.lock_file()?;let mut vault=state.read()?;
            let pending=state.pending.lock().map_err(|_|"Account state unavailable.")?;
            if *cancellation_check.borrow()||pending.is_none(){return Err("Sign-in cancelled.".into())}
            if let Some(slot)=vault.accounts.iter_mut().find(|a|a.client_id==issued){if slot.subject!=account.subject{return Err("Account identity changed. Sign-in was not saved.".into())}*slot=account;}else{vault.accounts.push(account);}
            vault.active=Some(issued);state.write(&vault)?;
            drop(pending);
            Ok::<_,String>(if enabled{"Signed in. ChatGPT plan usage is enabled."}else{"Signed in. ChatGPT plan usage was not granted; enable it in Account settings or choose an API key."}.to_string())
        };
        let result=tokio::select!{result=flow=>result,_=cancelled.changed()=>Err("Sign-in cancelled.".into())};
        *state.message.lock().unwrap()=result.unwrap_or_else(|e|e);*state.pending.lock().unwrap()=None;
    });Ok(())
}
#[tauri::command]
pub fn chatgpt_cancel(state:tauri::State<ChatGptState>)->Result<(),String>{if let Some(sender)=state.pending.lock().map_err(|_|"Account state unavailable.")?.as_ref(){let _=sender.send(true);}Ok(())}

#[tauri::command]
pub async fn chatgpt_select(account_id:String,state:tauri::State<'_,ChatGptState>)->Result<(),String>{
    let _gate=state.gate.lock().await;let _file=state.lock_file()?;let mut vault=state.read()?;
    if state.pending.lock().unwrap().is_some(){return Err("Finish or cancel the current sign-in first.".into())}
    if !vault.accounts.iter().any(|a|a.client_id==account_id&&a.tokens.is_some()){return Err("Sign in to this account first.".into())}
    vault.active=Some(account_id);state.write(&vault)
}

pub async fn access(state:&ChatGptState,account_id:&str)->Result<String,String>{
    access_with(state,account_id,|old|async move {
        let response=client()?.post(TOKEN).form(&[("grant_type","refresh_token"),("client_id",account_id),("refresh_token",old.refresh_token.as_str()),("resource",RESOURCE)]).send().await.map_err(|_|"Could not renew ChatGPT access. Check your connection and retry.")?;
        Ok((response.status().is_success(),bounded_json(response).await?))
    },|token|async move {Ok(identity(&client()?,&token,account_id,None).await?.sub)}).await
}

async fn access_with<R,RF,V,VF>(state:&ChatGptState,account_id:&str,refresh:R,verify:V)->Result<String,String>
where R:FnOnce(Tokens)->RF,RF:std::future::Future<Output=Result<(bool,Value),String>>,V:FnOnce(String)->VF,VF:std::future::Future<Output=Result<String,String>> {
    let _gate=state.gate.lock().await;let _file=state.lock_file()?;let mut vault=state.read()?;
    if vault.active.as_deref()!=Some(account_id){return Err("Your ChatGPT account changed. Review Account settings and send again.".into())}
    let index=vault.accounts.iter().position(|a|a.client_id==account_id).ok_or("Sign in with ChatGPT first.")?;
    let old=vault.accounts[index].tokens.as_ref().ok_or("Sign in with ChatGPT again.")?.clone();
    if !plan_scope(&old.scope){return Err("Enable ChatGPT plan usage in Account settings, or explicitly choose API-key billing.".into())}
    if old.expires_at<=now()+60 {
        if old.refresh_token.is_empty(){return Err("Your session expired. Sign in with ChatGPT again.".into())}
        let (success,value)=refresh(old.clone()).await?;
        if !success {
            let error=value["error"].as_str().or(value["error"]["code"].as_str()).unwrap_or("");
            if ["invalid_grant","invalid_refresh_token","token_expired","refresh_token_expired","refresh_token_invalidated","refresh_token_reused"].contains(&error){vault.accounts[index].tokens=None;state.write(&vault)?;return Err("Your ChatGPT session ended. Sign in again in Account settings.".into())}
            return Err("ChatGPT access could not be renewed. Your account is preserved; retry later.".into())
        }
        // Rotation consumes the old refresh token. Persist its replacement before
        // identity discovery/JWKS requests can fail; pending identity blocks use.
        vault.accounts[index].tokens=Some(tokens(&value,Some(&old))?);state.write(&vault)?;
    }
    let next=vault.accounts[index].tokens.as_ref().unwrap();
    if next.identity_pending {
        if verify(next.id_token.clone()).await?!=vault.accounts[index].subject{return Err("Renewed account identity did not match.".into())}
        vault.accounts[index].tokens.as_mut().unwrap().identity_pending=false;state.write(&vault)?;
    }
    let next=vault.accounts[index].tokens.as_ref().unwrap();
    if !plan_scope(&next.scope){return Err("ChatGPT plan permission is no longer enabled. Open Account settings.".into())}Ok(next.access_token.clone())
}

#[tauri::command]
pub async fn chatgpt_models(account_id:String,state:tauri::State<'_,ChatGptState>)->Result<Value,String>{
    let token=access(&state,&account_id).await?;
    let response=client()?.get(format!("{RESOURCE}/models")).bearer_auth(&token).send().await.map_err(|_|"Cannot load ChatGPT models. Check your connection.")?;
    if !response.status().is_success(){return Err(provider_error(response,&token).await)}
    let value=bounded_json(response).await?;let models=value["models"].as_array().ok_or("ChatGPT returned an unexpected model catalog.")?;
    let list:Vec<Value>=models.iter().filter(|m|m["visibility"]=="list").filter_map(|m|{let id=m["slug"].as_str()?;if id.is_empty()||id.len()>100||!id.bytes().all(|c|c.is_ascii_alphanumeric()||b"._:-".contains(&c)){return None}Some(json!({"id":id,"label":m["display_name"].as_str().unwrap_or(id)}))}).collect();
    Ok(json!({"accountId":account_id,"models":list}))
}
pub async fn provider_error(response:reqwest::Response,secret:&str)->String{
    let status=response.status().as_u16();let request_id=response.headers().get("x-request-id").and_then(|v|v.to_str().ok()).unwrap_or("").chars().filter(|c|c.is_ascii_alphanumeric()||"-_".contains(*c)).take(150).collect::<String>();
    let value=bounded_json(response).await.unwrap_or(Value::Null);
    let clean=|v:&str|v.replace(secret,"[redacted]").chars().filter(|c|!c.is_control()).take(700).collect::<String>();
    let code=clean(value["error"]["code"].as_str().unwrap_or(""));
    let detail=clean(value["error"]["message"].as_str().or(value["detail"].as_str()).unwrap_or("Open Account settings to check access, or retry later."));
    format!("OpenAI HTTP {status} {code}: {detail}{}",if request_id.is_empty(){String::new()}else{format!(" (request {request_id})")})
}

#[tauri::command]
pub async fn chatgpt_logout(account_id:String,state:tauri::State<'_,ChatGptState>,agent:tauri::State<'_,crate::agent::AgentState>)->Result<Value,String>{
    crate::agent::cancel_all(&agent);
    if let Some(sender)=state.pending.lock().unwrap().as_ref(){let _=sender.send(true);}
    let _gate=state.gate.lock().await;let _file=state.lock_file()?;let mut vault=state.read()?;
    let account=vault.accounts.iter_mut().find(|a|a.client_id==account_id).ok_or("Unknown account.")?;
    let mut revoked=account.tokens.is_none();
    if let Some(saved)=&account.tokens {
        if !saved.refresh_token.is_empty(){
            let revoke=async {let http=client()?;let config=discovery(&http).await?;let endpoint=auth_endpoint(config["revocation_endpoint"].as_str().ok_or("Missing revocation endpoint.")?)?;
                for attempt in 0..2 {let result=http.post(&endpoint).form(&[("token",saved.refresh_token.as_str()),("token_type_hint","refresh_token"),("client_id",account_id.as_str())]).send().await;
                    match result {Ok(response) if response.status().as_u16()==200=>return Ok::<_,String>(()),Ok(response) if !response.status().is_server_error()=>break,_=>{}}
                    if attempt==0{tokio::time::sleep(Duration::from_millis(500)).await;}}
                Err("Remote revocation was not confirmed.".into())};revoked=revoke.await.is_ok();
        }
    }
    account.tokens=None;if vault.active.as_deref()==Some(&account_id){vault.active=None;}state.write(&vault)?;
    let message=if revoked{"Signed out."}else{"Signed out locally. Remote revocation was not confirmed. Disconnect BlueGay in ChatGPT Settings > Security and login > Sign in with ChatGPT."};
    *state.message.lock().unwrap()=message.into();Ok(json!({"message":message,"revoked":revoked}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn attempt(existing:Option<Account>)->Attempt{Attempt{state:"state-value".into(),nonce:"nonce-value".into(),verifier:"pkce-verifier".into(),redirect:"http://127.0.0.1:1455/auth/callback".into(),existing}}
    fn account()->Account{Account{client_id:"oaiapp_test".into(),subject:"test-subject".into(),name:"Student".into(),email:"student@example.test".into(),tokens:Some(Tokens{access_token:"secret-access".into(),refresh_token:"secret-refresh".into(),id_token:"secret-id".into(),scope:SCOPES.into(),expires_at:now()+3600,identity_pending:false})}}
    #[test]
    fn signed_identity_rejects_forgery_and_invalid_claims(){
        let fixture:Value=serde_json::from_str(include_str!("../../tests/chatgpt-identity-fixture.json")).unwrap();
        let keys:JwkSet=serde_json::from_value(fixture["keys"].clone()).unwrap();
        let claims=verify_identity(fixture["valid"].as_str().unwrap(),&keys,"oaiapp_test",Some("test-nonce")).unwrap();
        assert_eq!(claims.sub,"test-subject");
        for key in ["badSignature","expired","wrongAudience","wrongNonce","wrongIssuer","future","none"]{assert!(verify_identity(fixture[key].as_str().unwrap(),&keys,"oaiapp_test",Some("test-nonce")).is_err(),"{key}");}
        assert!(verify_identity(fixture["valid"].as_str().unwrap(),&keys,"oaiapp_other",Some("test-nonce")).is_err());
    }
    #[test]
    fn callback_is_bound_to_state_path_and_registration(){
        let fresh=attempt(None);
        let valid="/auth/callback?state=state-value&code=abc&client_id=oaiapp_new";
        assert_eq!(callback_query(valid,&fresh).unwrap(),("abc".into(),"oaiapp_new".into()));
        for target in ["/auth/callback?state=other&code=abc&client_id=oaiapp_new","/auth/callback?state=state-value&error=access_denied","/auth/callback?state=state-value&code=abc","/auth/callback?state=state-value&code=abc&client_id=dynamic_agent_client","/callback?state=state-value&code=abc&client_id=oaiapp_new","/auth/callback?state=state-value&state=other&code=abc&client_id=oaiapp_new"]{assert!(callback_query(target,&fresh).is_err());}
        let returning=attempt(Some(account()));assert_eq!(callback_query("/auth/callback?state=state-value&code=abc",&returning).unwrap().1,"oaiapp_test");
        assert!(callback_query(valid,&returning).is_err());
    }
    #[test]
    fn authorization_uses_pkce_and_reuses_registered_client(){
        let a=attempt(None);let url=reqwest::Url::parse(&authorization(&a,"urn:uuid:host",false).unwrap()).unwrap();let params:std::collections::HashMap<_,_>=url.query_pairs().into_owned().collect();
        assert_eq!(params["client_id"],"dynamic_agent_client");assert_eq!(params["agent_name_hint"],"BlueGay");assert_eq!(params["redirect_uri"],a.redirect);assert_eq!(params["code_challenge"],URL_SAFE_NO_PAD.encode(Sha256::digest(a.verifier.as_bytes())));
        assert!(params["scope"].contains("chatgpt.tokens.use.direct"));assert!(!params.contains_key("code_verifier"));
        let url=authorization(&attempt(Some(account())),"urn:uuid:host",true).unwrap();assert!(url.contains("client_id=oaiapp_test"));assert!(!url.contains("agent_name_hint"));assert!(url.contains("prompt=consent"));assert!(!url.contains("secret-"));
    }
    #[test]
    fn display_data_and_permission_checks_do_not_leak_tokens(){
        let display=account().public().to_string();assert!(!display.contains("secret-"));assert!(!display.contains("refresh_token"));assert!(!display.contains("subject"));
        assert!(plan_scope(SCOPES));assert!(!plan_scope("openid email"));assert!(!plan_scope("chatgpt.tokens.use.direct.evil"));
        assert!(auth_endpoint("https://auth.openai.com/.well-known/jwks.json").is_ok());for url in ["http://auth.openai.com/x","https://auth.openai.com.evil.test/x","https://user@auth.openai.com/x","https://auth.openai.com:123/x"]{assert!(auth_endpoint(url).is_err());}
    }
    #[test]
    fn vault_is_encrypted_and_serialized_across_instances(){
        let temp=tempfile::tempdir().unwrap();let state=ChatGptState::new(temp.path().join("account.dpapi"));let lock=state.lock_file().unwrap();
        let vault=Vault{host_id:host_id().unwrap(),active:Some("oaiapp_test".into()),accounts:vec![account()]};state.write(&vault).unwrap();
        let disk=fs::read(&state.path).unwrap();assert!(!String::from_utf8_lossy(&disk).contains("secret-access"));assert!(!String::from_utf8_lossy(&disk).contains("student@example.test"));
        assert_eq!(state.read().unwrap().accounts[0].tokens.as_ref().unwrap().access_token,"secret-access");
        let other=ChatGptState::new(state.path.clone());assert!(other.lock_file().is_err());drop(lock);assert!(other.lock_file().is_ok());
    }
    fn expired_vault(state:&ChatGptState){
        let mut saved=account();saved.tokens.as_mut().unwrap().expires_at=0;
        state.write(&Vault{host_id:"host".into(),active:Some(saved.client_id.clone()),accounts:vec![saved]}).unwrap();
    }
    fn rotated()->Value{json!({"access_token":"replacement-access","refresh_token":"replacement-refresh","id_token":"replacement-id","token_type":"Bearer","expires_in":3600,"scope":SCOPES})}
    #[tokio::test]
    async fn rotated_credentials_survive_identity_network_failure_and_retry_without_refresh(){
        let temp=tempfile::tempdir().unwrap();let state=ChatGptState::new(temp.path().join("account.dpapi"));expired_vault(&state);
        let error=access_with(&state,"oaiapp_test",|old|async move {assert_eq!(old.refresh_token,"secret-refresh");Ok((true,rotated()))},|_|async {Err("Identity keys are unavailable.".into())}).await.unwrap_err();
        assert!(error.contains("Identity keys"));
        let saved=state.read().unwrap().accounts[0].tokens.clone().unwrap();assert_eq!(saved.refresh_token,"replacement-refresh");assert!(saved.identity_pending);
        // A fresh app instance must validate the saved identity, without reusing
        // the already-consumed refresh token or releasing unverified access.
        let reopened=ChatGptState::new(state.path.clone());
        assert!(access_with(&reopened,"oaiapp_test",|_|async {panic!("must not refresh")},|_|async {Ok("different-subject".into())}).await.is_err());
        assert!(reopened.read().unwrap().accounts[0].tokens.as_ref().unwrap().identity_pending);
        let token=access_with(&reopened,"oaiapp_test",|_|async {panic!("must not refresh")},|id|async move {assert_eq!(id,"replacement-id");Ok("test-subject".into())}).await.unwrap();
        assert_eq!(token,"replacement-access");assert!(!reopened.read().unwrap().accounts[0].tokens.as_ref().unwrap().identity_pending);
    }
    #[tokio::test]
    async fn refresh_preserves_credentials_on_transient_errors_but_clears_terminal_errors(){
        let temp=tempfile::tempdir().unwrap();let state=ChatGptState::new(temp.path().join("account.dpapi"));expired_vault(&state);
        for code in ["temporarily_unavailable","invalid_client"]{
            assert!(access_with(&state,"oaiapp_test",|_|async move {Ok((false,json!({"error":code})))},|_|async {panic!("must not verify")}).await.is_err());
            assert_eq!(state.read().unwrap().accounts[0].tokens.as_ref().unwrap().refresh_token,"secret-refresh");
        }
        assert!(access_with(&state,"oaiapp_test",|_|async {Ok((false,json!({"error":{"code":"refresh_token_reused"}})))},|_|async {panic!("must not verify")}).await.is_err());
        assert!(state.read().unwrap().accounts[0].tokens.is_none());
    }
    #[test]
    fn older_saved_tokens_load_and_rotation_keeps_pending_identity_checks(){
        let legacy=json!({"access_token":"a","refresh_token":"r","id_token":"i","scope":SCOPES,"expires_at":0});
        let mut saved:Tokens=serde_json::from_value(legacy).unwrap();assert!(!saved.identity_pending);
        saved.identity_pending=true;let mut response=rotated();response.as_object_mut().unwrap().remove("id_token");
        let next=tokens(&response,Some(&saved)).unwrap();assert!(next.identity_pending);assert_eq!(next.id_token,"i");
    }
    #[tokio::test]
    async fn loopback_listener_ignores_unsolicited_callback_and_closes_after_success(){
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();let port=listener.local_addr().unwrap().port();let mut attempt=attempt(None);attempt.redirect=format!("http://127.0.0.1:{port}/auth/callback");
        let task=tokio::spawn(async move{receive_callback(listener,&attempt).await});
        let http=client().unwrap();let bad=http.get(format!("http://127.0.0.1:{port}/auth/callback?state=wrong&code=evil&client_id=oaiapp_new")).send().await.unwrap();assert_eq!(bad.status().as_u16(),400);
        let good=http.get(format!("http://127.0.0.1:{port}/auth/callback?state=state-value&code=test&client_id=oaiapp_new")).send().await.unwrap();assert_eq!(good.status().as_u16(),200);assert_eq!(task.await.unwrap().unwrap().0,"test");
        assert!(http.get(format!("http://127.0.0.1:{port}/auth/callback")).send().await.is_err());
    }
}
