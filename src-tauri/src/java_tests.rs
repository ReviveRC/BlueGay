//! Launch the pinned JUnit engines in a tracked process. Result events have a
//! dedicated file channel so output from the program cannot corrupt the report.
use super::*;

fn paths(args:&Value,key:&str)->Result<Vec<PathBuf>>{
    let values=args[key].as_array().ok_or("Missing Java classpath")?;
    if values.len()>4096{return Err("Java classpath is too large.".into());}
    values.iter().map(|value|{let value=value.as_str().ok_or("Invalid Java classpath")?;if value.len()>8000||value.contains(['\0','\n','\r']){return Err("Invalid Java classpath".into());}let path=PathBuf::from(value);if !path.is_absolute(){return Err("Java classpaths must be absolute.".into());}Ok(path)}).collect()
}
fn emit(session:&Session,event:&str,body:Value){session.event("system",json!({"type":"event","event":event,"body":body}));}
pub(super) fn start(session:Arc<Session>,args:&Value)->Result<Value>{
    if session.launch.language!="java"||session.stopped.load(Ordering::SeqCst){return Err("Start a Java project session first.".into());}
    let jar=setup::junit_jar(&session.home);if !jar.is_file(){return Err("Set up Java testing tools first.".into());}
    let classpaths=paths(args,"classPaths")?;let modules=paths(args,"modulePaths")?;
    let mode=args["mode"].as_str().unwrap_or("project");if !["project","class","failed"].contains(&mode){return Err("Invalid test selection.".into());}
    let class=args["className"].as_str().unwrap_or("");if class.len()>2000||class.contains(['\0','\n','\r']){return Err("Invalid Java test class.".into());}
    let ids:Vec<String>=serde_json::from_value(args["ids"].clone()).map_err(|_|"Invalid failed-test selection")?;
    if ids.len()>10000||ids.iter().any(|id|id.len()>8000||id.contains(['\0','\n','\r'])){return Err("Invalid failed-test selection.".into());}
    let roots=classpaths.iter().filter(|path|path.is_dir()).filter_map(|path|fs::canonicalize(path).ok()).filter(|path|path.starts_with(&session.root)||fs::canonicalize(session.home.join("workspaces")).map(|home|path.starts_with(home)).unwrap_or(false)).collect::<BTreeSet<_>>();
    if mode=="project"&&roots.is_empty(){return Err("No compiled Java test folders were found.".into());}
    let directory=session.home.join("java-tests");fs::create_dir_all(directory.join("reports")).map_err(err)?;
    let runner=directory.join("BlueGayTestRunner.java");let source=include_bytes!("../java/BlueGayTestRunner.java");if fs::read(&runner).ok().as_deref()!=Some(source){fs::write(&runner,source).map_err(err)?;}
    let report=directory.join("reports").join(format!("{}.jsonl",session.id));fs::write(&report,[]).map_err(err)?;
    let mut cp=vec![jar];cp.extend(classpaths.into_iter().filter(|path|path.exists()));cp.extend(modules.into_iter().filter(|path|path.exists()));
    let classpath=std::env::join_paths(cp).map_err(err)?;
    let mut command=hidden(&session.settings.java);
    command.args(["-Dfile.encoding=UTF-8","-Dstdout.encoding=UTF-8","-Dstderr.encoding=UTF-8","-cp"]).arg(classpath).arg(runner).arg(&report).arg(mode).arg(class);
    if mode=="failed"{command.args(ids);}else if mode=="project"{command.args(roots);}
    command.current_dir(&session.root).envs(&session.launch.env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut children=session.children.lock().map_err(|_|"Debugger unavailable")?;
    if session.stopped.load(Ordering::SeqCst)||session.test_started.swap(true,Ordering::SeqCst){return Err("This session has already started its test run.".into());}
    let mut child=command.spawn().map_err(|e|format!("Cannot start JUnit: {e}"))?;let pid=child.id();
    *session.input.lock().map_err(|_|"Console unavailable")?=child.stdin.take();
    if let Some(stdout)=child.stdout.take(){session.capture(stdout,"stdout");}if let Some(stderr)=child.stderr.take(){session.capture(stderr,"stderr");}
    children.push(child);drop(children);
    thread::spawn(move||{
        let result=(||->Result<()>{
            let mut reader=BufReader::new(fs::File::open(&report).map_err(err)?);let mut pending=String::new();let mut bytes=0;let mut summary=false;
            loop{
                if session.stopped.load(Ordering::SeqCst){return Ok(());}
                loop{
                    let count=reader.read_line(&mut pending).map_err(err)?;bytes+=count;
                    if bytes>64*1024*1024||pending.len()>1024*1024{return Err("JUnit report exceeds the size limit.".into());}
                    if count==0{break;}
                    if pending.ends_with('\n'){
                        let record:Value=serde_json::from_str(pending.trim()).map_err(err)?;
                        match record["event"].as_str(){Some("test")=>emit(&session,"javaTest",record),Some("summary")=>{summary=true;emit(&session,"javaTestSummary",record);},Some("error")=>emit(&session,"javaTestError",record),_=>return Err("Invalid JUnit report event.".into())}
                        pending.clear();
                    }
                }
                let exit=session.children.lock().map_err(|_|"Debugger unavailable")?.iter_mut().find(|child|child.id()==pid).and_then(|child|child.try_wait().ok().flatten());
                if let Some(status)=exit{
                    // The report writer closes before the process exits. Drain
                    // data written between the last EOF and try_wait once more.
                    let mut rest=String::new();reader.read_to_string(&mut rest).map_err(err)?;pending.push_str(&rest);
                    for line in pending.lines(){if line.trim().is_empty(){continue;}let record:Value=serde_json::from_str(line).map_err(err)?;match record["event"].as_str(){Some("test")=>emit(&session,"javaTest",record),Some("summary")=>{summary=true;emit(&session,"javaTestSummary",record);},Some("error")=>emit(&session,"javaTestError",record),_=>{}}}
                    emit(&session,"javaTaskFinished",json!({"exitCode":status.code(),"summary":summary}));return Ok(());
                }
                thread::sleep(Duration::from_millis(40));
            }
        })();
        let _=fs::remove_file(report);
        if let Err(error)=result{emit(&session,"javaTestError",json!({"message":error}));emit(&session,"javaTaskFinished",json!({"exitCode":2,"summary":false}));}
    });
    Ok(json!({"pid":pid}))
}

#[cfg(test)]mod tests{use super::*;#[test]fn classpaths_cannot_smuggle_relative_paths_or_invalid_strings(){assert!(paths(&json!({"classPaths":["../outside"]}),"classPaths").is_err());assert!(paths(&json!({"classPaths":[42]}),"classPaths").is_err());assert!(paths(&json!({"classPaths":[]}),"classPaths").unwrap().is_empty());}}
