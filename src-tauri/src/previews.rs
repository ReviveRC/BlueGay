//! Isolated, read-only snapshots. The HTTP listener never reads paths from disk.
use std::{collections::HashMap,io::{Read,Write},net::{TcpListener,TcpStream},sync::{Arc,Mutex,RwLock,atomic::{AtomicBool,Ordering}},time::Duration};
use base64::{Engine,engine::general_purpose::STANDARD};
use serde::{Deserialize,Serialize};
use tauri::{Manager,State};
const LIMIT:usize=64*1024*1024;
type Entries=Arc<RwLock<HashMap<String,Vec<u8>>>>;
struct Server {base:String,entries:Entries,stop:Arc<AtomicBool>}
impl Drop for Server{fn drop(&mut self){self.stop.store(true,Ordering::SeqCst);}}
#[derive(Default)]pub struct PreviewState(Mutex<Option<Server>>);
impl PreviewState{pub fn shutdown(&self){if let Ok(mut server)=self.0.lock(){*server=None;}}}
#[derive(Deserialize)]pub struct PreviewFile{path:String,content:Option<String>,base64:Option<String>}
#[derive(Serialize)]#[serde(rename_all="camelCase")]pub struct PreviewAddress{base_url:String}
fn safe(path:&str)->bool{!path.is_empty()&&path.len()<500&&!path.starts_with('/')&&!path.chars().any(|c|c=='\\'||c==':'||c.is_control())&&path.split('/').all(|p|!p.is_empty()&&p!="."&&p!=".."&&!p.ends_with(['.',' '])&&!p.starts_with('.')&&!matches!(p.to_ascii_lowercase().as_str(),"credentials"|"id_rsa"|"id_ed25519"))}
fn mime(path:&str)->Option<&'static str>{match path.rsplit('.').next()?.to_ascii_lowercase().as_str(){"html"|"htm"=>Some("text/html"),"css"=>Some("text/css"),"js"|"mjs"=>Some("text/javascript"),"json"=>Some("application/json"),"svg"=>Some("image/svg+xml"),"png"=>Some("image/png"),"jpg"|"jpeg"=>Some("image/jpeg"),"gif"=>Some("image/gif"),"webp"=>Some("image/webp"),"avif"=>Some("image/avif"),"bmp"=>Some("image/bmp"),"ico"=>Some("image/x-icon"),"pdf"=>Some("application/pdf"),"woff"=>Some("font/woff"),"woff2"=>Some("font/woff2"),"ttf"=>Some("font/ttf"),"otf"=>Some("font/otf"),"txt"|"md"|"markdown"=>Some("text/plain"),_=>None}}
fn decode(path:&str)->Option<String>{let bytes=path.as_bytes();let mut out=Vec::new();let mut i=0;while i<bytes.len(){if bytes[i]==b'%'{if i+2>=bytes.len(){return None;}let h=std::str::from_utf8(&bytes[i+1..i+3]).ok()?;out.push(u8::from_str_radix(h,16).ok()?);i+=3;}else{out.push(bytes[i]);i+=1;}}String::from_utf8(out).ok()}
fn serve(mut stream:TcpStream,entries:Entries,prefix:String,host:String){
    let _=stream.set_read_timeout(Some(Duration::from_secs(2)));let _=stream.set_write_timeout(Some(Duration::from_secs(3)));
    let mut bytes=Vec::new();let mut buffer=[0;1024];while bytes.len()<8192{match stream.read(&mut buffer){Ok(0)|Err(_)=>return,Ok(n)=>{bytes.extend_from_slice(&buffer[..n]);if bytes.windows(4).any(|w|w==b"\r\n\r\n"){break;}}}}
    let request=String::from_utf8_lossy(&bytes);let mut lines=request.lines();let mut first=lines.next().unwrap_or("").split_whitespace();let method=first.next().unwrap_or("");let target=first.next().unwrap_or("");
    let valid_host=lines.any(|line|line.split_once(':').map(|(key,value)|key.eq_ignore_ascii_case("host")&&value.trim()==host).unwrap_or(false));
    let path=target.split('?').next().unwrap_or("").strip_prefix(&prefix).and_then(decode);
    let entry=if valid_host&&matches!(method,"GET"|"HEAD"){path.as_ref().filter(|p|safe(p)).and_then(|p|{let map=entries.read().ok()?;Some((mime(p)?,map.get(p)?.clone()))})}else{None};
    let (status,kind,body)=entry.map(|(kind,body)|("200 OK",kind,body)).unwrap_or(("404 Not Found","text/plain",b"Not found".to_vec()));
    let csp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; media-src 'self' blob: https:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
    let header=format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {csp}\r\n\r\n",body.len());let _=stream.write_all(header.as_bytes());if method!="HEAD"{let _=stream.write_all(&body);}
}
fn update(state:&PreviewState,files:Vec<PreviewFile>)->Result<PreviewAddress,String>{
    if files.len()>2000{return Err("Too many preview files.".into());}let mut next=HashMap::new();let mut total=0;
    for file in files{if !safe(&file.path)||mime(&file.path).is_none()||next.contains_key(&file.path){return Err("Invalid preview file path.".into());}let bytes=match file.base64{Some(value)=>STANDARD.decode(value).map_err(|_|"Invalid asset data")?,None=>file.content.unwrap_or_default().into_bytes()};total+=bytes.len();if total>LIMIT{return Err("Preview exceeds 64 MB.".into());}next.insert(file.path,bytes);}
    let mut server=state.0.lock().map_err(|_|"Preview unavailable")?;
    if server.is_none(){let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;listener.set_nonblocking(true).map_err(|e|e.to_string())?;let host=listener.local_addr().map_err(|e|e.to_string())?.to_string();let mut random=[0;24];getrandom::fill(&mut random).map_err(|e|e.to_string())?;let token=random.iter().map(|b|format!("{b:02x}")).collect::<String>();let prefix=format!("/{token}/");let base=format!("http://{host}{prefix}");let entries=Arc::new(RwLock::new(HashMap::new()));let stop=Arc::new(AtomicBool::new(false));let copy=entries.clone();let done=stop.clone();
        std::thread::spawn(move||{while !done.load(Ordering::SeqCst){match listener.accept(){Ok((stream,_))=>serve(stream,copy.clone(),prefix.clone(),host.clone()),Err(e)if e.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(15)),Err(_)=>break,}}});*server=Some(Server{base,entries,stop});}
    let live=server.as_ref().unwrap();*live.entries.write().map_err(|_|"Preview unavailable")?=next;Ok(PreviewAddress{base_url:live.base.clone()})
}
#[tauri::command]pub async fn preview_workspace(app:tauri::AppHandle,files:Vec<PreviewFile>)->Result<PreviewAddress,String>{tauri::async_runtime::spawn_blocking(move||update(&app.state::<PreviewState>(),files)).await.map_err(|e|e.to_string())?}
#[tauri::command]pub fn close_preview(state:State<'_,PreviewState>){state.shutdown();}
#[derive(Serialize)]pub struct Asset{base64:String,size:usize}
#[tauri::command]pub async fn read_preview_asset(app:tauri::AppHandle,path:String)->Result<Asset,String>{tauri::async_runtime::spawn_blocking(move||{
    let path=app.state::<crate::disk::DiskState>().authorize(&path).map_err(|e|e.message)?;if mime(&path.to_string_lossy()).is_none(){return Err("This file type cannot be previewed.".into());}let file=std::fs::File::open(path).map_err(|e|e.to_string())?;if !file.metadata().map_err(|e|e.to_string())?.is_file(){return Err("Not a regular file.".into());}let mut bytes=Vec::new();file.take(LIMIT as u64+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;if bytes.len()>LIMIT{return Err("Asset exceeds the 64 MB preview limit.".into());}Ok(Asset{base64:STANDARD.encode(&bytes),size:bytes.len()})}).await.map_err(|e|e.to_string())?}
#[cfg(test)]mod tests{use super::*;
#[test]fn paths_and_decoding(){for path in ["../x.html","/x","a\\b","a/../b","a/.env","a/.git/config","C:/x",""]{assert!(!safe(path),"{path}");}assert!(safe("pages/été #1.html"));assert_eq!(decode("%C3%A9%20%231.html"),Some("é #1.html".into()));assert!(decode("%GG").is_none());}
fn get(base:&str,path:&str)->String{let url=reqwest::Url::parse(base).unwrap();let mut stream=TcpStream::connect(("127.0.0.1",url.port().unwrap())).unwrap();stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();write!(stream,"GET {}{} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",url.path(),path,url.port().unwrap()).unwrap();let mut body=String::new();stream.read_to_string(&mut body).unwrap();body}
#[test]fn snapshot_serves_only_declared_files_and_replaces_atomically(){let state=PreviewState::default();let first=update(&state,vec![PreviewFile{path:"index.html".into(),content:Some("first".into()),base64:None}]).unwrap();let response=get(&first.base_url,"index.html");assert!(response.starts_with("HTTP/1.1 200"));assert!(response.ends_with("\r\n\r\nfirst"));assert!(get(&first.base_url,"missing.html").starts_with("HTTP/1.1 404"));assert!(get(&first.base_url,"%2e%2e/secret.html").starts_with("HTTP/1.1 404"));assert!(update(&state,vec![PreviewFile{path:"../x.html".into(),content:None,base64:None}]).is_err());let next=update(&state,vec![PreviewFile{path:"other.css".into(),content:Some("a{}".into()),base64:None}]).unwrap();assert_eq!(first.base_url,next.base_url);assert!(get(&next.base_url,"index.html").starts_with("HTTP/1.1 404"));state.shutdown();}
}
