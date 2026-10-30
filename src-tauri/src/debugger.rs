//! Native debug adapter/process boundary. Guests enter through the host's
//! permission-checked Code Together dispatcher, never through local IPC grants.
use serde::{Deserialize, Serialize};
use serde_json::{json,Value};
use std::{collections::{BTreeMap,BTreeSet,VecDeque},fs,io::{BufRead,BufReader,Read,Write},net::TcpStream,path::{Path,PathBuf},process::{Child,ChildStdin,Command,Stdio},sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering}},thread,time::Duration};
use tauri::Manager;
#[path="debugger_setup.rs"] mod setup;
#[path="java_tests.rs"] mod java_tests;
type Result<T> = std::result::Result<T,String>;
type Writer = Arc<Mutex<Box<dyn Write+Send>>>;
#[derive(Clone,Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Settings { pub python:String,pub java:String }
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
struct Launch {
    language:String,path:String,
    #[serde(default)] args:Vec<String>,#[serde(default)] env:BTreeMap<String,String>,
    #[serde(default)] stop_on_entry:bool,#[serde(default)] no_debug:bool,
}
struct Session {
    id:String,owner:String,root:PathBuf,home:PathBuf,launch:Launch,settings:Settings,
    peers:Mutex<BTreeMap<String,Writer>>,children:Mutex<Vec<Child>>,input:Mutex<Option<ChildStdin>>,
    events:Mutex<VecDeque<Value>>,serial:AtomicU64,bytes:Mutex<usize>,stopped:AtomicBool,
    port_requests:Mutex<BTreeSet<String>>,dap_port:Mutex<Option<u16>>,
    test_started:AtomicBool,
}
struct Inner { home:PathBuf,sessions:Mutex<BTreeMap<String,Arc<Session>>> }
#[derive(Clone)] pub struct DebuggerState { inner:Arc<Inner> }
impl DebuggerState {
    pub fn new(home:PathBuf)->Self {Self{inner:Arc::new(Inner{home,sessions:Mutex::new(BTreeMap::new())})}}
    pub fn shutdown(&self){if let Ok(sessions)=self.inner.sessions.lock(){for session in sessions.values(){session.stop();}}}
    pub fn stop_guests(&self,root:&Path){if let Ok(sessions)=self.inner.sessions.lock(){for session in sessions.values(){if session.root==root&&session.owner.starts_with("guest:"){session.stop();}}}}
    pub fn stop_owner(&self,owner:&str){if let Ok(sessions)=self.inner.sessions.lock(){for session in sessions.values(){if session.owner==owner{session.stop();}}}}
    fn settings(&self)->Settings{fs::read(self.inner.home.join("settings.json")).ok().and_then(|bytes|serde_json::from_slice(&bytes).ok()).unwrap_or_default()}
    fn session(&self,args:&Value,owner:&str)->Result<Arc<Session>>{
        let sessions=self.inner.sessions.lock().map_err(|_|"Debugger unavailable")?;
        let session=sessions.get(text(args,"session")?).ok_or("Debug session has ended.")?;
        if session.owner!=owner{return Err("This debug session belongs to another participant.".into());}Ok(session.clone())
    }
    pub fn dispatch(&self,operation:&str,args:&Value,root:Option<&Path>,owner:&str)->Result<Value>{
        match operation {
            "info"=>setup::info(&self.inner.home,&self.settings()),
            "settings"=>{
                if owner!="local"{return Err("Only the host can change debugger runtimes.".into());}
                let settings:Settings=serde_json::from_value(args["settings"].clone()).map_err(|_|"Invalid debugger settings")?;
                for path in [&settings.python,&settings.java]{if path.len()>2000||path.chars().any(char::is_control){return Err("Invalid runtime path.".into());}if !path.is_empty()&&(!Path::new(path).is_absolute()||!Path::new(path).is_file()){return Err("Select an existing Python or Java executable.".into());}}
                fs::create_dir_all(&self.inner.home).map_err(err)?;fs::write(self.inner.home.join("settings.json"),serde_json::to_vec_pretty(&settings).map_err(err)?).map_err(err)?;
                setup::info(&self.inner.home,&settings)
            }
            "install"=>{if owner!="local"{return Err("Ask the host to set up the debugging tools.".into());}if self.inner.sessions.lock().map_err(|_|"Debugger unavailable")?.values().any(|s|!s.stopped.load(Ordering::SeqCst)){return Err("Stop running programs before reinstalling debugger tools.".into());}setup::install(&self.inner.home,&self.settings(),text(args,"language")?)},
            "open"=>self.open(args,root.ok_or("Open a project folder first.")?,owner),
            "poll"=>{
                let session=self.session(args,owner)?;let after=args["after"].as_u64().unwrap_or(0);
                let events=session.events.lock().map_err(|_|"Debugger unavailable")?;
                Ok(json!({"events":events.iter().filter(|event|event["id"].as_u64().unwrap_or(0)>after).take(256).cloned().collect::<Vec<_>>(),"stopped":session.stopped.load(Ordering::SeqCst),"first":events.front().map(|e|e["id"].clone())}))
            }
            "send"=>{let session=self.session(args,owner)?;if session.stopped.load(Ordering::SeqCst){return Err("Debug session has ended.".into());}let peer=text(args,"peer")?;let mut message=args["message"].clone();session.validate_message(peer,&mut message)?;session.send(peer,&message)?;Ok(Value::Null)},
            "connect"=>{
                let session=self.session(args,owner)?;
                let port=session.dap_port.lock().map_err(|_|"Debugger unavailable")?.take().ok_or("The Java debug adapter has not returned a port.")?;
                let stream=TcpStream::connect_timeout(&std::net::SocketAddr::from(([127,0,0,1],port)),Duration::from_secs(5)).map_err(err)?;
                stream.set_nodelay(true).map_err(err)?;session.peer("dap",stream.try_clone().map_err(err)?,stream)?;Ok(Value::Null)
            }
            "input"=>{let session=self.session(args,owner)?;let input=text(args,"text")?;if input.len()>65536{return Err("Console input is too large.".into());}let mut stdin=session.input.lock().map_err(|_|"Console unavailable")?;let stdin=stdin.as_mut().ok_or("This program has no input stream.")?;stdin.write_all(input.as_bytes()).map_err(err)?;stdin.flush().map_err(err)?;Ok(Value::Null)},
            "tests"=>java_tests::start(self.session(args,owner)?,args),
            "stop"=>{let session=self.session(args,owner)?;session.stop();self.inner.sessions.lock().map_err(|_|"Debugger unavailable")?.remove(&session.id);Ok(Value::Null)},
            _=>Err("Unknown debugger operation.".into())
        }
    }
    fn open(&self,args:&Value,root:&Path,owner:&str)->Result<Value>{
        let launch:Launch=serde_json::from_value(args["config"].clone()).map_err(|_|"Invalid launch configuration")?;
        if !["python","java"].contains(&launch.language.as_str())||launch.args.len()>128||launch.args.iter().any(|s|s.len()>8000||s.contains('\0'))||launch.env.len()>128||launch.env.iter().any(|(k,v)|k.is_empty()||k.contains(['=','\0'])||v.contains('\0')||k.len()+v.len()>16000){return Err("Invalid debug arguments or environment.".into());}
        let root=fs::canonicalize(root).map_err(err)?;let program=safe_source(&root,&launch.path)?;
        let extension=program.extension().and_then(|s|s.to_str()).unwrap_or("");
        if (launch.language=="python"&&extension!="py")||(launch.language=="java"&&extension!="java"){return Err("Choose a Python or Java source file.".into());}
        let settings=setup::resolve(&self.settings());let info=setup::info(&self.inner.home,&settings)?;
        if !info[if launch.language=="python"{"pythonReady"}else{"javaReady"}].as_bool().unwrap_or(false){return Err("Set up the selected language in Run → Debugger settings first.".into());}
        let mut sessions=self.inner.sessions.lock().map_err(|_|"Debugger unavailable")?;
        if sessions.values().any(|s|s.owner==owner&&!s.stopped.load(Ordering::SeqCst)){return Err("Stop the current debug session first.".into());}
        sessions.retain(|_,s|!s.stopped.load(Ordering::SeqCst));
        if sessions.len()>=33{return Err("Too many active debug sessions. Stop a session before launching another.".into());}
        let mut bytes=[0;16];getrandom::fill(&mut bytes).map_err(err)?;let id=bytes.iter().map(|b|format!("{b:02x}")).collect::<String>();
        let session=Arc::new(Session{id:id.clone(),owner:owner.into(),root:root.clone(),home:self.inner.home.clone(),launch:launch.clone(),settings:settings.clone(),peers:Mutex::new(BTreeMap::new()),children:Mutex::new(vec![]),input:Mutex::new(None),events:Mutex::new(VecDeque::new()),serial:AtomicU64::new(0),bytes:Mutex::new(0),stopped:AtomicBool::new(false),port_requests:Mutex::new(BTreeSet::new()),dap_port:Mutex::new(None),test_started:AtomicBool::new(false)});
        let paths=setup::java_paths(&self.inner.home);
        // Each participant needs a separate JDT workspace: Eclipse locks its
        // project cache for the lifetime of the language server.
        let workspace=self.inner.home.join("workspaces").join(setup::hash(&format!("{}\n{owner}",root.to_string_lossy())));
        let mut command=if launch.language=="python"{
            let mut c=hidden(&settings.python);c.args(["-m","debugpy.adapter"]);setup::python_env(&mut c,&self.inner.home,&settings);c
        }else{
            let launcher=paths.launcher.clone().ok_or("Java language server is missing.")?;
            let mut c=hidden(&settings.java);c.args(["-Declipse.application=org.eclipse.jdt.ls.core.id1","-Dosgi.bundles.defaultStartLevel=4","-Declipse.product=org.eclipse.jdt.ls.core.product","-Dlog.protocol=false","-Dlog.level=ERROR","-Xms128m","-Xmx1G","--add-modules=ALL-SYSTEM","--add-opens","java.base/java.util=ALL-UNNAMED","--add-opens","java.base/java.lang=ALL-UNNAMED","-jar"]);c.arg(launcher).arg("-configuration").arg(paths.config.clone()).arg("-data").arg(workspace);c
        };
        command.current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child=command.spawn().map_err(|e|format!("Cannot start debug adapter: {e}"))?;
        let stdin=child.stdin.take().ok_or("Missing adapter input")?;let stdout=child.stdout.take().ok_or("Missing adapter output")?;let stderr=child.stderr.take().ok_or("Missing adapter errors")?;
        session.children.lock().map_err(|_|"Debugger unavailable")?.push(child);
        session.capture(stderr,"adapter");session.peer(if launch.language=="python"{"dap"}else{"lsp"},stdout,stdin)?;
        sessions.insert(id.clone(),session);
        Ok(json!({"session":id,"language":launch.language,"root":root,"rootUri":file_uri(&root)?,"program":program,"programUri":file_uri(&program)?,"javaBundle":paths.bundle,"javaClasspathLibrary":java_classpath_library(&self.inner.home,&root,&program),"javaVersion":info["javaVersion"],"javaExecutable":settings.java,"stopOnEntry":launch.stop_on_entry,"noDebug":launch.no_debug}))
    }
}
impl Session {
    fn event(&self,peer:&str,message:Value){
        let id=self.serial.fetch_add(1,Ordering::SeqCst)+1;
        let event=json!({"id":id,"peer":peer,"message":message});let length=event.to_string().len();
        if let (Ok(mut events),Ok(mut bytes))=(self.events.lock(),self.bytes.lock()){
            *bytes+=length;events.push_back(event);
            while events.len()>4000||(*bytes>4*1024*1024&&events.len()>1){let index=events.iter().position(|event|event["message"]["event"]=="output").unwrap_or(0);if let Some(old)=events.remove(index){*bytes=bytes.saturating_sub(old.to_string().len());}else{break;}}
        }
    }
    fn output(&self,category:&str,text:impl AsRef<str>){self.event("system",json!({"type":"event","event":"output","body":{"category":category,"output":text.as_ref()}}));}
    fn capture<R:Read+Send+'static>(self:&Arc<Self>,mut reader:R,category:&'static str){
        let session=self.clone();thread::spawn(move||{let mut bytes=[0;4096];let mut pending=Vec::new();while !session.stopped.load(Ordering::SeqCst){match reader.read(&mut bytes){Ok(0)|Err(_)=>break,Ok(n)=>{pending.extend_from_slice(&bytes[..n]);match std::str::from_utf8(&pending){Ok(text)=>{session.output(category,text);pending.clear();},Err(e)=>{let end=e.valid_up_to();if end>0{session.output(category,String::from_utf8_lossy(&pending[..end]));pending.drain(..end);}if e.error_len().is_some(){session.output(category,String::from_utf8_lossy(&pending));pending.clear();}}}}}}if !pending.is_empty(){session.output(category,String::from_utf8_lossy(&pending));}});
    }
    fn peer<R:Read+Send+'static,W:Write+Send+'static>(self:&Arc<Self>,name:&str,reader:R,writer:W)->Result<()>{
        self.peers.lock().map_err(|_|"Debugger unavailable")?.insert(name.into(),Arc::new(Mutex::new(Box::new(writer))));
        let session=self.clone();let name=name.to_string();
        thread::spawn(move||{
            let mut reader=BufReader::new(reader);
            while !session.stopped.load(Ordering::SeqCst){
                match read_message(&mut reader){
                    Ok(message)=>{
                        if name=="dap"&&message["type"]=="request"&&message["command"]=="runInTerminal"{
                            let result=session.terminal(&message["arguments"]);
                            let reply=match result{Ok(pid)=>json!({"type":"response","seq":1000000+session.serial.load(Ordering::SeqCst),"request_seq":message["seq"],"command":"runInTerminal","success":true,"body":{"processId":pid}}),Err(e)=>json!({"type":"response","seq":1000000+session.serial.load(Ordering::SeqCst),"request_seq":message["seq"],"command":"runInTerminal","success":false,"message":e})};
                            let _=session.send("dap",&reply);continue;
                        }
                        if name=="lsp" {if let Some(id)=message.get("id"){if session.port_requests.lock().map(|mut ids|ids.remove(&id.to_string())).unwrap_or(false){if let Some(port)=message["result"].as_u64().filter(|p|*p>0&&*p<=65535){if let Ok(mut target)=session.dap_port.lock(){*target=Some(port as u16);}}}}}
                        session.event(&name,message);
                    }
                    Err(error)=>{if !session.stopped.load(Ordering::SeqCst){session.event("system",json!({"type":"event","event":"adapterClosed","body":{"peer":name,"message":error}}));}break;}
                }
            }
        });Ok(())
    }
    fn send(&self,peer:&str,message:&Value)->Result<()>{
        let writer=self.peers.lock().map_err(|_|"Debugger unavailable")?.get(peer).cloned().ok_or("Debug adapter is not connected.")?;
        let mut writer=writer.lock().map_err(|_|"Debugger unavailable")?;write_message(&mut *writer,message)
    }
    fn terminal(self:&Arc<Self>,args:&Value)->Result<u32>{
        if self.stopped.load(Ordering::SeqCst){return Err("Debug session stopped.".into());}
        let argv=args["args"].as_array().ok_or("Invalid debug terminal command")?;
        if argv.is_empty()||argv.len()>512||argv.iter().any(|a|a.as_str().map(|s|s.contains('\0')||s.len()>128000).unwrap_or(true)){return Err("Invalid debug terminal arguments.".into());}
        let executable=PathBuf::from(argv[0].as_str().unwrap());
        // Only the selected interpreter/JDK can launch a program; never cmd.exe,
        // PowerShell, or an arbitrary executable supplied by a remote peer.
        let allowed=if self.launch.language=="python"{&self.settings.python}else{&self.settings.java};
        if !same_executable(&executable,Path::new(allowed)){return Err("The adapter requested an unexpected runtime.".into());}
        let cwd=args["cwd"].as_str().map(PathBuf::from).unwrap_or_else(||self.root.clone());let cwd=fs::canonicalize(cwd).map_err(err)?;
        if !cwd.starts_with(&self.root){return Err("The console working directory must stay in the project.".into());}
        let mut command=hidden(&executable);
        let count=if self.launch.language=="java"{self.launch.args.len()}else{0};
        if argv.len()<=count{return Err("Invalid runtime command.".into());}
        command.args(argv.iter().skip(1).take(argv.len()-1-count).map(|v|v.as_str().unwrap()));
        if count>0{command.args(&self.launch.args);}
        command.current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(env)=args["env"].as_object(){for (key,value) in env{if let Some(value)=value.as_str(){command.env(key,value);}else if value.is_null(){command.env_remove(key);}}}
        command.envs(&self.launch.env).env("PYTHONUNBUFFERED","1").env("PYTHONIOENCODING","utf-8");
        let mut children=self.children.lock().map_err(|_|"Debugger unavailable")?;
        if self.stopped.load(Ordering::SeqCst){return Err("Debug session stopped.".into());}
        let mut child=command.spawn().map_err(|e|format!("Cannot launch program: {e}"))?;let pid=child.id();
        *self.input.lock().map_err(|_|"Console unavailable")?=child.stdin.take();
        if let Some(stdout)=child.stdout.take(){self.capture(stdout,"stdout");}if let Some(stderr)=child.stderr.take(){self.capture(stderr,"stderr");}
        children.push(child);Ok(pid)
    }
    fn validate_message(&self,peer:&str,message:&mut Value)->Result<()>{
        if message.to_string().len()>1024*1024{return Err("Debugger message is too large.".into());}
        if peer=="lsp"{
            let Some(method)=message["method"].as_str().map(String::from) else {return if message.get("id").is_some(){Ok(())}else{Err("Invalid language server response".into())};};
            if !["initialize","initialized","textDocument/didOpen","textDocument/didChange","workspace/executeCommand","java/buildWorkspace","shutdown","exit"].contains(&method.as_str()){return Err("Unsupported Java language server operation.".into());}
            if method=="initialize"{
                let paths=setup::java_paths(&self.home).bundle;
                let mut libraries=vec![json!("lib/**/*.jar")];let junit=setup::junit_jar(&self.home);if junit.is_file(){libraries.push(json!(junit));}
                message["params"]=json!({"processId":std::process::id(),"rootUri":file_uri(&self.root)?,"workspaceFolders":[{"uri":file_uri(&self.root)?,"name":self.root.file_name().unwrap_or_default().to_string_lossy()}],"capabilities":{"workspace":{"configuration":true,"workspaceFolders":true},"window":{"workDoneProgress":true}},"initializationOptions":{"bundles":[paths],"workspaceFolders":[file_uri(&self.root)?],"settings":{"java":{"project":{"referencedLibraries":libraries},"autobuild":{"enabled":true},"configuration":{"updateBuildConfiguration":"automatic"},"import":{"maven":{"enabled":true},"gradle":{"enabled":true}},"compile":{"nullAnalysis":{"mode":"disabled"}}}}}});
            }
            if method=="workspace/executeCommand"{
                let command=message["params"]["command"].as_str().unwrap_or("");
                if !["vscode.java.startDebugSession","vscode.java.resolveMainClass","vscode.java.resolveClasspath","vscode.java.resolveJavaExecutable"].contains(&command){return Err("Unsupported Java project operation.".into());}
                if command=="vscode.java.startDebugSession"{self.port_requests.lock().map_err(|_|"Debugger unavailable")?.insert(message["id"].to_string());}
            }
            if method.starts_with("textDocument/"){let uri=message["params"]["textDocument"]["uri"].as_str().ok_or("Missing Java source URI")?;let path=reqwest::Url::parse(uri).map_err(err)?.to_file_path().map_err(|_|"Invalid Java file URI")?;safe_source(&self.root,&path.to_string_lossy())?;}
        }else if peer=="dap"{
            let command=message["command"].as_str().unwrap_or("").to_string();
            if !["initialize","launch","setBreakpoints","setExceptionBreakpoints","configurationDone","threads","stackTrace","scopes","variables","evaluate","setVariable","setExpression","continue","next","stepIn","stepOut","pause","disconnect","terminate","source","exceptionInfo","completions"].contains(&command.as_str()){return Err("Unsupported debugger operation.".into());}
            if command=="initialize"{message["arguments"]=json!({"clientID":"bluegay","clientName":"BlueGay","adapterID":self.launch.language,"pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsRunInTerminalRequest":true,"supportsVariableType":true,"supportsVariablePaging":true});}
            if command=="launch"{
                let mut launch=if self.launch.language=="python"{json!({"type":"python","program":safe_source(&self.root,&self.launch.path)?,"python":[self.settings.python],"justMyCode":false})}else{
                    let supplied=&message["arguments"];
                    json!({"type":"java","mainClass":supplied["mainClass"],"projectName":supplied["projectName"],"classPaths":supplied["classPaths"],"modulePaths":supplied["modulePaths"],"sourcePaths":[self.root],"javaExec":self.settings.java})
                };
                let fields=launch.as_object_mut().unwrap();fields.insert("cwd".into(),json!(self.root));fields.insert("args".into(),if self.launch.language=="java"{json!(self.launch.args.iter().map(|arg|quote_java_argument(arg)).collect::<Vec<_>>().join(" "))}else{json!(self.launch.args)});fields.insert("env".into(),json!(self.launch.env));fields.insert("console".into(),json!("integratedTerminal"));fields.insert("encoding".into(),json!("UTF-8"));fields.insert("stopOnEntry".into(),json!(self.launch.stop_on_entry));fields.insert("noDebug".into(),json!(self.launch.no_debug));message["arguments"]=launch;
            }
            if command=="setBreakpoints"{let path=text(&message["arguments"]["source"],"path")?;message["arguments"]["source"]["path"]=json!(safe_source(&self.root,path)?);}
            if command=="source"{if let Some(path)=message["arguments"]["source"]["path"].as_str(){safe_source(&self.root,path)?;}}
        }else{return Err("Unknown debugger connection.".into());}Ok(())
    }
    fn stop(&self){
        if self.stopped.swap(true,Ordering::SeqCst){return;}
        if let Ok(mut children)=self.children.lock(){for child in children.iter_mut().rev(){kill_tree(child);}}
        if let Ok(mut peers)=self.peers.lock(){peers.clear();}if let Ok(mut input)=self.input.lock(){input.take();}
        self.event("system",json!({"type":"event","event":"terminated","body":{}}));
    }
}
fn err(e:impl std::fmt::Display)->String{e.to_string()}
impl Drop for Inner {fn drop(&mut self){if let Ok(sessions)=self.sessions.lock(){for session in sessions.values(){session.stop();}}}}
fn text<'a>(value:&'a Value,key:&str)->Result<&'a str>{value[key].as_str().ok_or_else(||format!("Missing {key}"))}
pub fn hidden(program:impl AsRef<std::ffi::OsStr>)->Command{let mut command=Command::new(program);#[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}command}
fn kill_tree(child:&mut Child){
    if child.try_wait().ok().flatten().is_some(){return;}
    #[cfg(windows)]{let system=std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(||PathBuf::from("C:\\Windows"));let _=hidden(system.join("System32/taskkill.exe")).args(["/PID",&child.id().to_string(),"/T","/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();}
    let _=child.kill();let _=child.wait();
}
fn same_executable(a:&Path,b:&Path)->bool{match (fs::canonicalize(a),fs::canonicalize(b)){(Ok(a),Ok(b))=>a==b,_=>a==b}}
fn java_classpath_library(home:&Path,root:&Path,program:&Path)->Option<PathBuf>{
    let library=setup::junit_jar(home);if !library.is_file(){return None;}
    // Only unmanaged source folders use our referencedLibraries setting.
    // Build-tool/Eclipse projects own their dependencies and classpath.
    for folder in program.parent()?.ancestors().take_while(|folder|folder.starts_with(root)){
        if ["pom.xml","build.gradle","build.gradle.kts",".project"].iter().any(|name|folder.join(name).is_file()){return None;}
    }
    Some(library)
}
fn quote_java_argument(value:&str)->String{
    let mut result=String::from("\"");let mut slashes=0;
    for ch in value.chars(){if ch=='\\'{slashes+=1;continue;}if ch=='"'{result.push_str(&"\\".repeat(slashes*2+1));result.push(ch);}else{result.push_str(&"\\".repeat(slashes));result.push(ch);}slashes=0;}
    result.push_str(&"\\".repeat(slashes*2));result.push('"');result
}
fn safe_source(root:&Path,input:&str)->Result<PathBuf>{
    if input.is_empty()||input.contains('\0'){return Err("Choose a source file in this project.".into());}
    let path=Path::new(input);let path=if path.is_absolute(){path.to_path_buf()}else{root.join(path)};
    let path=fs::canonicalize(path).map_err(err)?;
    if !path.starts_with(root)||!path.is_file(){return Err("The source file must be inside the project.".into());}Ok(path)
}
fn file_uri(path:&Path)->Result<String>{reqwest::Url::from_file_path(path).map(|u|u.to_string()).map_err(|_|"Invalid file path".into())}
fn read_message(reader:&mut impl BufRead)->Result<Value>{
    let mut length=None;let mut total=0;
    loop{let mut line=String::new();let n=reader.read_line(&mut line).map_err(err)?;if n==0{return Err("Debug adapter closed.".into());}total+=n;if total>8192{return Err("Invalid debug adapter headers.".into());}if line.trim().is_empty(){break;}if let Some((key,value))=line.split_once(':'){if key.eq_ignore_ascii_case("Content-Length"){length=Some(value.trim().parse::<usize>().map_err(err)?);}}}
    let length=length.filter(|n|*n<=4*1024*1024).ok_or("Invalid debug adapter message size")?;let mut bytes=vec![0;length];reader.read_exact(&mut bytes).map_err(err)?;serde_json::from_slice(&bytes).map_err(err)
}
fn write_message(writer:&mut impl Write,message:&Value)->Result<()>{let bytes=serde_json::to_vec(message).map_err(err)?;write!(writer,"Content-Length: {}\r\n\r\n",bytes.len()).map_err(err)?;writer.write_all(&bytes).map_err(err)?;writer.flush().map_err(err)}
#[tauri::command]
pub async fn debugger_request(app:tauri::AppHandle,operation:String,args:Value)->Result<Value>{
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<DebuggerState>();
        let root=if operation=="open"{let disk=app.state::<crate::disk::DiskState>();let input=args["root"].as_str().unwrap_or("");let selected=disk.authorize(input).map_err(|e|e.message)?;if selected.is_file(){if Path::new(args["config"]["path"].as_str().unwrap_or("")).components().count()!=1||Path::new(args["config"]["path"].as_str().unwrap_or("")).file_name()!=selected.file_name(){return Err("Choose the opened source file.".into());}Some(selected.parent().ok_or("Missing source folder")?.to_path_buf())}else{Some(selected)}}else{None};
        state.dispatch(&operation,&args,root.as_deref(),"local")
    }).await.map_err(err)?
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn framed_protocol_handles_utf8_and_rejects_truncation(){
        let value=json!({"type":"event","body":{"output":"été 💅"}});let mut bytes=vec![];write_message(&mut bytes,&value).unwrap();assert_eq!(read_message(&mut BufReader::new(bytes.as_slice())).unwrap(),value);
        assert!(read_message(&mut BufReader::new(&b"Content-Length: 10\r\n\r\n{}"[..])).is_err());
        assert!(read_message(&mut BufReader::new(&b"Content-Length: 9000000\r\n\r\n"[..])).is_err());
    }
    #[test] fn source_paths_cannot_escape_the_selected_project(){
        let temp=tempfile::tempdir().unwrap();let root=temp.path().join("project");fs::create_dir(&root).unwrap();fs::write(root.join("a.py"),"pass").unwrap();fs::write(temp.path().join("outside.py"),"pass").unwrap();let root=fs::canonicalize(root).unwrap();
        assert!(safe_source(&root,"a.py").is_ok());assert!(safe_source(&root,"../outside.py").is_err());
    }
    #[test] fn java_arguments_quote_windows_spaces_empty_values_and_backslashes(){
        assert_eq!(quote_java_argument(""),"\"\"");
        assert_eq!(quote_java_argument("a b"),"\"a b\"");
        assert_eq!(quote_java_argument("a\"b"),"\"a\\\"b\"");
        assert_eq!(quote_java_argument("a\\"),"\"a\\\\\"");
    }
    #[test] fn junit_readiness_only_applies_to_unmanaged_source_folders(){
        let temp=tempfile::tempdir().unwrap();let home=temp.path().join("home");let root=temp.path().join("project");fs::create_dir_all(home.join("java-tests")).unwrap();fs::create_dir_all(root.join("module")).unwrap();
        let source=root.join("module/TEST.java");fs::write(&source,"class TEST {}").unwrap();
        assert!(java_classpath_library(&home,&root,&source).is_none());
        let jar=setup::junit_jar(&home);fs::write(&jar,[]).unwrap();assert_eq!(java_classpath_library(&home,&root,&source),Some(jar));
        fs::write(root.join("module/pom.xml"),"<project/>").unwrap();assert!(java_classpath_library(&home,&root,&source).is_none());
    }
    #[test] fn session_ownership_and_remote_setup_are_enforced(){
        let temp=tempfile::tempdir().unwrap();let state=DebuggerState::new(temp.path().into());
        assert!(state.dispatch("settings",&json!({"settings":{"python":"","java":""}}),None,"guest:one").is_err());
        assert!(state.dispatch("install",&json!({"language":"java"}),None,"guest:one").is_err());
        assert!(state.dispatch("poll",&json!({"session":"missing"}),None,"guest:one").is_err());
    }
    // A local-only integration harness exercises the exact native process and
    // adapter boundary with debugger-core.js. Run explicitly, never in normal tests.
    #[test] #[ignore] fn serve_debugger_fixture(){
        let home=PathBuf::from(std::env::var("BLUEGAY_DEBUG_HOME").expect("BLUEGAY_DEBUG_HOME"));
        let root=PathBuf::from(std::env::var("BLUEGAY_DEBUG_PROJECT").expect("BLUEGAY_DEBUG_PROJECT"));
        let state=DebuggerState::new(home);let listener=std::net::TcpListener::bind("127.0.0.1:4177").unwrap();println!("Debug adapter fixture ready at 127.0.0.1:4177");
        for stream in listener.incoming(){let state=state.clone();let root=root.clone();thread::spawn(move||{
            let mut stream=stream.unwrap();stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();let mut reader=BufReader::new(stream.try_clone().unwrap());let mut line=String::new();reader.read_line(&mut line).unwrap();let route=line.split_whitespace().nth(1).unwrap_or("").to_string();let mut length=0;loop{line.clear();reader.read_line(&mut line).unwrap();if line.trim().is_empty(){break;}if let Some(value)=line.to_ascii_lowercase().strip_prefix("content-length:"){length=value.trim().parse::<usize>().unwrap_or(0);}}
            if length>1024*1024{return;}let mut body=vec![0;length];reader.read_exact(&mut body).unwrap();
            let result=if route=="/health"{json!({"ready":true})}else if route=="/revoke"{state.stop_guests(&fs::canonicalize(&root).unwrap());json!({"data":true})}else{
                let request:Value=serde_json::from_slice(&body).unwrap();
                let requested=request["args"]["root"].as_str().map(PathBuf::from).unwrap_or(root.clone());
                let allowed=fs::canonicalize(&requested).ok().zip(fs::canonicalize(&root).ok()).map(|(path,root)|path.starts_with(root)).unwrap_or(false);
                if !allowed{json!({"error":"Outside the disposable fixture root"})}else{match state.dispatch(request["operation"].as_str().unwrap_or(""),&request["args"],Some(&requested),request["owner"].as_str().unwrap_or("local")){Ok(data)=>json!({"data":data}),Err(error)=>json!({"error":error})}}
            };
            let bytes=serde_json::to_vec(&result).unwrap();write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len()).unwrap();stream.write_all(&bytes).unwrap();
        });}
    }
}
