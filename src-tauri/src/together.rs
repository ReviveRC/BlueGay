//! Direct, authenticated LAN/VPN collaboration. No relay or public discovery.
//! Only this session's selected root is exposed, never the app's other grants.
use super::*;
use serde_json::{json, Value};
use std::{net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{Arc, atomic::{AtomicBool, Ordering}}, thread, time::{Duration, Instant}};
use tauri::Manager;

// JSON can expand a UTF-8 control byte to six ASCII bytes (\u00XX).
// Keep the wire limits consistent with the disk limits, including that overhead.
const REQUEST_LIMIT: usize = FILE_LIMIT as usize * 6 + 64 * 1024;
const RESPONSE_LIMIT: usize = WORKSPACE_LIMIT * 6 + 4 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions { write: bool, create_delete: bool, #[serde(default)] console:bool }

struct Host {
    root: PathBuf,
    token: String,
    stopped: AtomicBool,
    permissions: Mutex<Permissions>,
    members: Mutex<std::collections::BTreeMap<String, (Instant, Value)>>,
    debugger:crate::debugger::DebuggerState,
}
#[derive(Default)]
pub struct TogetherState { host: Mutex<Option<Arc<Host>>> }
impl Drop for TogetherState {
    fn drop(&mut self) {
        if let Ok(Some(host)) = self.host.get_mut() { host.stopped.store(true, Ordering::SeqCst); }
    }
}

// Paths on the wire are always project-relative; reject all traversal and streams.
fn target(root: &Path, input: &str) -> Result<PathBuf> {
    if input.is_empty() || input.contains('\\') || input.split('/').any(|s| s.is_empty() || s == "." || s == ".." || s.contains(':')) {
        return Err(error("path", "Use a path inside the shared project."));
    }
    let path = resolved_target(&root.join(input))?;
    if path == root || !path.starts_with(root) { return Err(error("path", "Path is outside the shared project.")); }
    Ok(path)
}
fn remote_document(mut doc: Document, root: &Path) -> Document {
    doc.path = Path::new(&doc.absolute_path).strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
    doc.absolute_path = format!("together/{}", doc.path);
    doc
}
fn field<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key].as_str().ok_or_else(|| error("request", format!("Missing {key}")))
}
fn require(allowed: bool) -> Result<()> {
    if allowed { Ok(()) } else { Err(error("permission", "The host has not granted permission for this operation.")) }
}

fn dispatch(state: &DiskState, host: &Host, operation: &str, args: &Value) -> Result<Value> {
    // Hold permissions until completion: revocation/stop waits for in-flight work.
    let permissions = host.permissions.lock().map_err(|_| error("state", "Session unavailable"))?;
    if host.stopped.load(Ordering::SeqCst) { return Err(error("disconnected", "The host ended this session.")); }
    let root = &host.root;
    if operation == "snapshot" {
        let presence = update_presence(host, &args["presence"])?;
        let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
        let mut workspace = Workspace {root:"together".into(), name:root.file_name().unwrap_or_default().to_string_lossy().into(), files:vec![],folders:vec![],skipped:0};
        walk(root, root, &mut workspace, &mut 0)?;
        workspace.files = workspace.files.into_iter().map(|d|remote_document(d, root)).collect();
        return Ok(json!({"workspace":workspace,"permissions":*permissions,"presence":presence}));
    }
    if operation == "leave" {
        let id=field(args,"id")?;host.debugger.stop_owner(&format!("guest:{id}"));
        host.members.lock().map_err(|_|error("state","Session unavailable"))?.remove(id);
        return Ok(Value::Null);
    }
    if operation=="debugger" {
        require(permissions.console)?;
        let id=field(args,"id")?;if id.is_empty()||id.len()>64{return Err(error("request","Invalid console participant"));}
        if !host.members.lock().map_err(|_|error("state","Session unavailable"))?.contains_key(id){return Err(error("permission","Reconnect to Code Together before using the console."));}
        let operation=field(args,"operation")?;
        if !["info","open","send","poll","input","stop","connect","tests"].contains(&operation){return Err(error("permission","Only the host can configure debugger tools."));}
        return host.debugger.dispatch(operation,&args["args"],Some(root),&format!("guest:{id}")).map_err(|e|error("debugger",e));
    }
    let path = target(root, field(args, "path")?)?;
    if operation == "read_document" {
        let document=if args["forceOpen"].as_bool().unwrap_or(false){read_anyway(&path,Some(root))?}else{entry_document(&path,Some(root))?};
        return Ok(json!(remote_document(document,root)));
    }
    require(permissions.write)?;
    if operation == "save_document" {
        let expected = args["expectedVersion"].as_str().map(String::from);
        if expected.is_none() { require(permissions.create_delete)?; }
        return Ok(json!(remote_document(write_checked_with_override(state, &path, field(args,"content")?.into(), expected,args["forceOpen"].as_bool().unwrap_or(false))?, root)));
    }
    require(permissions.create_delete)?;
    let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
    match operation {
        "create_folder" => { fs::create_dir_all(path).map_err(io)?; Ok(Value::Null) }
        "trash_document" => {
            if !version_matches(&path,field(args,"expectedVersion")?)? { return Err(error("conflict","The file changed. Refresh before deleting.")); }
            trash::delete(path).map_err(|e| error("io",e))?;
            Ok(Value::Null)
        }
        "trash_folder" => {
            if path.exists() {
                if !path.is_dir() { return Err(error("path", "Not a folder")); }
                trash::delete(path).map_err(|e|error("io",e))?;
            }
            Ok(Value::Null)
        }
        "rename_document" => {
            let destination = target(root, field(args,"destination")?)?;
            if destination.exists() { return Err(error("exists","That path already exists.")); }
            if !version_matches(&path,field(args,"expectedVersion")?)? { return Err(error("conflict","The file changed. Refresh before renaming.")); }
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(io)?; }
            // Hard-link then unlink provides a no-clobber move on the same volume.
            fs::hard_link(&path,&destination).map_err(io)?;
            fs::remove_file(&path).map_err(io)?;
            Ok(json!(remote_document(renamed_document(&destination,Some(root),field(args,"expectedVersion")?)?,root)))
        }
        _ => Err(error("request","Unsupported Code Together operation")),
    }
}

fn update_presence(host: &Host, value: &Value) -> Result<Vec<Value>> {
    let mut members = host.members.lock().map_err(|_|error("state","Session unavailable"))?;
    members.retain(|_,(time,_)|time.elapsed() < Duration::from_secs(15));
    if let Some(id) = value["id"].as_str().filter(|s|s.len()<=64 && !s.is_empty()) {
        if members.len()>=32 && !members.contains_key(id) { return Err(error("session","This session already has 32 collaborators.")); }
        let name: String = value["name"].as_str().unwrap_or("Collaborator").chars().take(40).collect();
        let path = value["path"].as_str().unwrap_or("");
        let path = if target(&host.root,path).is_ok() {path} else {""};
        let number = |key: &str|value[key].as_u64().unwrap_or(1).clamp(1,2_000_000);
        let color = value["color"].as_u64().unwrap_or(0)%6;
        members.insert(id.into(),(Instant::now(),json!({"id":id,"name":name,"path":path,"line":number("line"),"column":number("column"),"color":color})));
    }
    Ok(members.values().map(|(_,v)|v.clone()).collect())
}

fn session_read_error(cause: std::io::Error) -> DiskError {
    use std::io::ErrorKind;
    match cause.kind() {
        ErrorKind::UnexpectedEof | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted =>
            error("disconnected","The Code Together connection closed before the message was complete. Ask the host for a fresh invite code and try again."),
        ErrorKind::TimedOut | ErrorKind::WouldBlock =>
            error("disconnected","The Code Together connection timed out. Check the host and network, then try again."),
        _ => io(cause),
    }
}
fn read_frame(stream: &mut TcpStream, limit: usize) -> Result<Value> {
    let mut size = [0;4]; stream.read_exact(&mut size).map_err(session_read_error)?;
    let size = u32::from_be_bytes(size) as usize;
    if size > limit { return Err(error("request","Session message exceeds the size limit.")); }
    let mut bytes = vec![0;size]; stream.read_exact(&mut bytes).map_err(session_read_error)?;
    serde_json::from_slice(&bytes).map_err(|_|error("request","Invalid session message"))
}
fn write_frame(stream: &mut TcpStream, value: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|e|error("request",e))?;
    if bytes.len() > RESPONSE_LIMIT { return Err(error("request","Project exceeds the session size limit.")); }
    stream.write_all(&(bytes.len() as u32).to_be_bytes()).map_err(io)?;
    stream.write_all(&bytes).map_err(io)
}
fn serve_connection(mut stream: TcpStream, state: &DiskState, host: &Host) -> Result<()> {
    // Windows accept inherits FIONBIO from our nonblocking listener. The
    // framed protocol uses read_exact/write_all with timeouts, so each accepted
    // connection must be blocking even though the accept loop is nonblocking.
    stream.set_nonblocking(false).map_err(io)?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(io)?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(io)?;
    // Authenticate before reading/allocating the JSON payload.
    let mut token = [0;64]; stream.read_exact(&mut token).map_err(io)?;
    let difference = token.iter().zip(host.token.as_bytes()).fold(0u8,|acc,(a,b)|acc | (a ^ b));
    if difference != 0 { return Err(error("permission","Invalid session code")); }
    let request = read_frame(&mut stream, REQUEST_LIMIT)?;
    let result = dispatch(state,host,field(&request,"operation")?,&request["args"]);
    let response = match result { Ok(data)=>json!({"data":data}), Err(e)=>json!({"error":e}) };
    write_frame(&mut stream,&response)
}

#[tauri::command]
pub fn together_start(app: tauri::AppHandle, state: State<'_, TogetherState>, disk: State<'_, DiskState>, root: String, address: String, permissions: Permissions) -> Result<Value> {
    let root = disk.authorize(&root)?;
    if !root.is_dir() { return Err(error("path","Open a project folder before hosting.")); }
    let mut current = state.host.lock().map_err(|_|error("state","Session unavailable"))?;
    if current.is_some() { return Err(error("state","Stop the current session first.")); }
    let address: Ipv4Addr = if address.trim().is_empty() {
        let socket = UdpSocket::bind("0.0.0.0:0").map_err(io)?;
        // UDP connect chooses the default interface without sending any packets.
        socket.connect("192.0.2.1:80").map_err(io)?;
        match socket.local_addr().map_err(io)?.ip() {std::net::IpAddr::V4(ip)=>ip,_=>Ipv4Addr::LOCALHOST}
    } else { address.trim().parse().map_err(|_|error("address","Enter this computer's LAN or VPN IPv4 address."))? };
    if address.is_unspecified() || address.is_multicast() || address.is_broadcast() { return Err(error("address","Choose a reachable LAN or VPN IPv4 address.")); }
    let listener = TcpListener::bind((address,0)).map_err(io)?;
    let port = listener.local_addr().map_err(io)?.port();
    listener.set_nonblocking(true).map_err(io)?;
    let mut bytes = [0;32]; getrandom::fill(&mut bytes).map_err(|e|error("state",e))?;
    let token: String = bytes.iter().map(|b|format!("{b:02x}")).collect();
    let code = format!("BG1-{address}-{port}-{token}");
    let host = Arc::new(Host {root, token, stopped:AtomicBool::new(false),permissions:Mutex::new(permissions),members:Mutex::new(Default::default()),debugger:app.state::<crate::debugger::DebuggerState>().inner().clone()});
    *current = Some(host.clone());
    thread::spawn(move || {
        while !host.stopped.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream,_)) => { let disk = app.state::<DiskState>(); let _ = serve_connection(stream,&disk,&host); }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(40)),
                Err(_) => break,
            }
        }
    });
    Ok(json!({"code":code,"permissions":permissions}))
}

#[tauri::command]
pub fn together_stop(state: State<'_, TogetherState>) -> Result<()> {
    let mut current = state.host.lock().map_err(|_|error("state","Session unavailable"))?;
    if let Some(host) = current.take() {
        let _permissions = host.permissions.lock().map_err(|_|error("state","Session unavailable"))?;
        host.stopped.store(true,Ordering::SeqCst);
        host.debugger.stop_guests(&host.root);
    }
    Ok(())
}
#[tauri::command]
pub fn together_permissions(state: State<'_, TogetherState>, permissions: Permissions) -> Result<()> {
    let current = state.host.lock().map_err(|_|error("state","Session unavailable"))?;
    let host = current.as_ref().ok_or_else(||error("state","No active session"))?;
    *host.permissions.lock().map_err(|_|error("state","Session unavailable"))? = permissions;
    if !permissions.console{host.debugger.stop_guests(&host.root);}
    Ok(())
}

#[tauri::command]
pub fn together_host_poll(state: State<'_, TogetherState>, disk: State<'_, DiskState>, presence: Value) -> Result<Value> {
    let current = state.host.lock().map_err(|_|error("state","Session unavailable"))?;
    let host = current.as_ref().ok_or_else(||error("state","No active session"))?;
    dispatch(&disk,host,"snapshot",&json!({"presence":presence}))
}

fn parse_code(code: &str) -> Result<(SocketAddr, &str)> {
    let parts: Vec<_> = code.trim().split('-').collect();
    if parts.len()!=4 || parts[0]!="BG1" || parts[3].len()!=64 || !parts[3].bytes().all(|b|b.is_ascii_hexdigit()) { return Err(error("code","Paste the complete Code Together invite code.")); }
    let ip: Ipv4Addr = parts[1].parse().map_err(|_|error("code","Invalid host address"))?;
    let port: u16 = parts[2].parse().map_err(|_|error("code","Invalid host port"))?;
    if port==0 || ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() { return Err(error("code","Invalid host address")); }
    Ok((SocketAddr::from((ip,port)),parts[3]))
}
fn request(code: &str, operation: &str, args: &Value) -> Result<Value> {
    let (address,token) = parse_code(code)?;
    let mut stream = TcpStream::connect_timeout(&address,Duration::from_secs(4)).map_err(|_|error("disconnected","Cannot reach the host. Check that the session is running, both computers share a network/VPN, and the host firewall permits BlueGay."))?;
    stream.set_read_timeout(Some(Duration::from_secs(8))).map_err(io)?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(io)?;
    stream.write_all(token.as_bytes()).map_err(io)?;
    write_frame(&mut stream,&json!({"operation":operation,"args":args}))?;
    let response = read_frame(&mut stream, RESPONSE_LIMIT)?;
    if let Some(failure) = response.get("error") {
        let code = match failure["code"].as_str() {Some("conflict")=>"conflict",Some("permission")=>"permission",Some("missing")=>"missing",Some("size")=>"size",Some("disconnected")=>"disconnected",_=>"remote"};
        return Err(error(code,failure["message"].as_str().unwrap_or("Host request failed")));
    }
    response.get("data").cloned().ok_or_else(||error("request","Invalid host response"))
}
#[tauri::command]
pub async fn together_request(code: String, operation: String, args: Value) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move ||request(&code,&operation,&args)).await.map_err(|e|error("state",e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn console_permission_is_independent_defaults_off_and_is_enforced_on_the_host(){
        let (_,state,host)=fixture();
        let permissions:Permissions=serde_json::from_value(json!({"write":true,"createDelete":true})).unwrap();assert!(!permissions.console);
        let args=json!({"id":"guest","operation":"open","args":{}});
        assert_eq!(dispatch(&state,&host,"debugger",&args).unwrap_err().code,"permission");
        assert_eq!(dispatch(&state,&host,"debugger",&json!({"id":"guest","operation":"tests","args":{}})).unwrap_err().code,"permission");
        host.permissions.lock().unwrap().console=true;
        assert_eq!(dispatch(&state,&host,"debugger",&args).unwrap_err().code,"permission");
        update_presence(&host,&json!({"id":"guest","name":"Guest"})).unwrap();
        assert_eq!(dispatch(&state,&host,"debugger",&json!({"id":"guest","operation":"install","args":{"language":"java"}})).unwrap_err().code,"permission");
        assert_eq!(dispatch(&state,&host,"debugger",&json!({"id":"guest","operation":"poll","args":{"session":"missing"}})).unwrap_err().code,"debugger");
    }
    fn fixture() -> (tempfile::TempDir, DiskState, Host) {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("index.html"),"original").unwrap();
        let state = DiskState::load(root.join("config"));
        let host = Host {root,token:"a".repeat(64),stopped:AtomicBool::new(false),permissions:Mutex::new(Permissions {write:false,create_delete:false,console:false}),members:Mutex::new(Default::default()),debugger:crate::debugger::DebuggerState::new(state.config.join("debugger"))};
        (temp,state,host)
    }
    #[test]
    fn permissions_and_conflicts_are_enforced_on_host() {
        let (_temp,state,host) = fixture();
        let doc = dispatch(&state,&host,"read_document",&json!({"path":"index.html"})).unwrap();
        let edit = json!({"path":"index.html","content":"edited","expectedVersion":doc["version"]});
        assert_eq!(dispatch(&state,&host,"save_document",&edit).unwrap_err().code,"permission");
        host.permissions.lock().unwrap().write=true;
        dispatch(&state,&host,"save_document",&edit).unwrap();
        assert_eq!(dispatch(&state,&host,"save_document",&edit).unwrap_err().code,"conflict");
        assert_eq!(dispatch(&state,&host,"save_document",&json!({"path":"new.txt","content":"new","expectedVersion":null})).unwrap_err().code,"permission");
        for operation in ["create_folder","trash_document","trash_folder","rename_document"] {
            assert_eq!(dispatch(&state,&host,operation,&json!({"path":"index.html"})).unwrap_err().code,"permission");
        }
        host.permissions.lock().unwrap().create_delete=true;
        assert!(dispatch(&state,&host,"save_document",&json!({"path":"nested/new.txt","content":"new","expectedVersion":null})).is_ok());
        host.stopped.store(true,Ordering::SeqCst);
        assert_eq!(dispatch(&state,&host,"snapshot",&json!({})).unwrap_err().code,"disconnected");
    }
    #[test]
    fn rejects_escape_paths_and_redacts_absolute_paths() {
        let (_temp,state,host) = fixture();
        for path in ["../outside","/outside","a/../../outside","a\\b","C:/secret","a:stream","./index.html","CON","a//b"] {
            assert!(target(&host.root,path).is_err(),"{path}");
        }
        let snapshot = dispatch(&state,&host,"snapshot",&json!({})).unwrap();
        assert_eq!(snapshot["workspace"]["root"],"together");
        assert_eq!(snapshot["workspace"]["files"][0]["absolutePath"],"together/index.html");
        assert!(!snapshot.to_string().contains(&host.root.to_string_lossy().to_string()));
    }
    #[test]
    fn two_clients_share_a_real_socket_and_stale_edits_cannot_clobber() {
        let (_temp,state,host) = fixture();
        host.permissions.lock().unwrap().write=true;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let code = format!("BG1-127.0.0.1-{}-{}",listener.local_addr().unwrap().port(),host.token);
        let server = thread::spawn(move||{for _ in 0..4 {let (stream,_) = listener.accept().unwrap();serve_connection(stream,&state,&host).unwrap();}});
        let first = request(&code,"read_document",&json!({"path":"index.html"})).unwrap();
        let second = request(&code,"read_document",&json!({"path":"index.html"})).unwrap();
        request(&code,"save_document",&json!({"path":"index.html","content":"first edit","expectedVersion":first["version"]})).unwrap();
        assert_eq!(request(&code,"save_document",&json!({"path":"index.html","content":"second edit","expectedVersion":second["version"]})).unwrap_err().code,"conflict");
        server.join().unwrap();
    }
    #[test]
    fn nonblocking_listener_accepts_delayed_join_request() {
        let (_temp,state,host) = fixture();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address=listener.local_addr().unwrap();
        let token=host.token.clone();
        let server=thread::spawn(move||{
            let stream=loop {
                match listener.accept() {
                    Ok((stream,_))=>break stream,
                    Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(5)),
                    Err(e)=>panic!("{e}"),
                }
            };
            // Windows accepts sockets in the listener's nonblocking mode.
            // Set it explicitly too so this regression runs on other platforms.
            stream.set_nonblocking(true).unwrap();
            serve_connection(stream,&state,&host)
        });
        let mut client=TcpStream::connect(address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        thread::sleep(Duration::from_millis(100));
        client.write_all(token.as_bytes()).unwrap();
        write_frame(&mut client,&json!({"operation":"snapshot","args":{}})).unwrap();
        let response=read_frame(&mut client,RESPONSE_LIMIT).unwrap();
        assert_eq!(response["data"]["workspace"]["files"][0]["content"],"original");
        server.join().unwrap().unwrap();
    }
    #[test]
    fn truncated_response_reports_actionable_disconnection() {
        for fragment in [vec![0,0],vec![0,0,0,5,b'{']] {
            let listener=TcpListener::bind("127.0.0.1:0").unwrap();
            let address=listener.local_addr().unwrap();
            let server=thread::spawn(move||{
                let (mut stream,_)=listener.accept().unwrap();
                stream.write_all(&fragment).unwrap();
            });
            let mut client=TcpStream::connect(address).unwrap();
            client.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let failure=read_frame(&mut client,RESPONSE_LIMIT).unwrap_err();
            assert_eq!(failure.code,"disconnected");
            assert!(failure.message.contains("fresh invite code"));
            assert!(!failure.message.contains("failed to fill"));
            server.join().unwrap();
        }
    }
    #[test]
    fn presence_tracks_files_positions_names_and_departures() {
        let (_temp,state,host) = fixture();
        let snapshot = dispatch(&state,&host,"snapshot",&json!({"presence":{"id":"one","name":"Alex","path":"index.html","line":7,"column":4,"color":2}})).unwrap();
        assert_eq!(snapshot["presence"][0]["name"],"Alex");
        assert_eq!(snapshot["presence"][0]["line"],7);
        let snapshot = dispatch(&state,&host,"snapshot",&json!({"presence":{"id":"two","name":"Sam","path":"../secret","line":0,"column":0,"color":99}})).unwrap();
        assert_eq!(snapshot["presence"].as_array().unwrap().len(),2);
        assert_eq!(snapshot["presence"][1]["path"],"");
        assert_eq!(snapshot["presence"][1]["line"],1);
        dispatch(&state,&host,"leave",&json!({"id":"one"})).unwrap();
        assert_eq!(update_presence(&host,&Value::Null).unwrap().len(),1);
        host.members.lock().unwrap().get_mut("two").unwrap().0=Instant::now()-Duration::from_secs(20);
        assert!(update_presence(&host,&Value::Null).unwrap().is_empty());
    }
    #[test]
    fn invalid_codes_and_oversize_frames_fail() {
        for code in ["anything","BG1-example.com-1234-abc","BG1-0.0.0.0-0-invalid"] {assert!(parse_code(code).is_err());}
        let (_temp,state,host) = fixture();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server=thread::spawn(move||{let (stream,_)=listener.accept().unwrap();assert!(serve_connection(stream,&state,&host).is_err());});
        let mut stream=TcpStream::connect(address).unwrap();
        stream.write_all(&[b'b';64]).unwrap();
        server.join().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server=thread::spawn(move||{let (mut stream,_)=listener.accept().unwrap();assert_eq!(read_frame(&mut stream,REQUEST_LIMIT).unwrap_err().code,"request");});
        let mut stream=TcpStream::connect(address).unwrap();
        stream.write_all(&((REQUEST_LIMIT+1) as u32).to_be_bytes()).unwrap();
        server.join().unwrap();
    }
}
