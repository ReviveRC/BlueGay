// Explicit native integration check; requires serve_debugger_fixture and pinned tools.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Engine}=require('../dist/debugger-core.js');
const project=path.resolve('test-artifacts/debugger-project');
async function transport(operation,args,owner='local'){const result=await fetch('http://127.0.0.1:4177/debug',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,args,owner})}).then(r=>r.json());if(result.error)throw Error(result.error);return result.data;}
async function check(language){
  let stops=0,output='',ended=false;const events=[];
  const file=language==='python'?'sample.py':'src/main/java/demo/Main.java';
  const line=language==='python'?6:9;
  const engine=new Engine({transport,pollDelay:30,getBreakpoints:()=>[{path:path.join(project,file),breakpoints:[{line}]}],onEvent(type,body){events.push({type,body});if(type==='stopped')stops++;if(type==='output')output+=body.output||'';if(type==='ended')ended=true;if(type==='error')console.error(language,body.message);if(type==='status'||type==='progress')console.log(language,type,body.text);}});
  async function until(predicate,label,timeout=30000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw Error(language+' timeout: '+label+'\n'+output.slice(-3000));await new Promise(resolve=>setTimeout(resolve,40));}}
  try{
    // Windows' Java launcher converts argv through its native code page.
    // Python preserves full Unicode; exercise supported accented Java argv.
    const args=['a b','"quoted"','C:\\tail\\','','slash\\"quote',language==='python'?'été 💅':'été'];
    await engine.start({root:project,config:{language,path:file,args,env:{BLUEGAY_VERIFY_ARGS:'1'},stopOnEntry:false,noDebug:false},content:fs.readFileSync(path.join(project,file),'utf8'),exceptions:'uncaught'});
    ended=false;
    await until(()=>output.includes('Name?'),'input prompt');await engine.native('input',{text:'ada\n'});await until(()=>stops>=1,'breakpoint');
    let stack=await engine.rpc('dap','stackTrace',{threadId:engine.threadId,startFrame:0,levels:20});engine.frameId=stack.stackFrames[0].id;assert.equal(stack.stackFrames[0].line,line);
    assert.equal((await engine.evaluate('value')).result,'2');
    const scopes=await engine.rpc('dap','scopes',{frameId:engine.frameId});const local=scopes.scopes.find(s=>/local/i.test(s.name))||scopes.scopes[0];const variables=await engine.rpc('dap','variables',{variablesReference:local.variablesReference});assert(variables.variables.some(v=>v.name==='value'&&v.value==='2'));
    let count=stops;await engine.control('stepIn');await until(()=>stops>count,'step into');stack=await engine.rpc('dap','stackTrace',{threadId:engine.threadId,startFrame:0,levels:20});assert(/twice/.test(stack.stackFrames[0].name));engine.frameId=stack.stackFrames[0].id;
    count=stops;await engine.control('next');await until(()=>stops>count,'step over');stack=await engine.rpc('dap','stackTrace',{threadId:engine.threadId,startFrame:0,levels:20});engine.frameId=stack.stackFrames[0].id;assert.equal((await engine.evaluate('result')).result,'4');
    count=stops;await engine.control('stepOut');await until(()=>stops>count,'step out');stack=await engine.rpc('dap','stackTrace',{threadId:engine.threadId,startFrame:0,levels:20});assert(!/twice/.test(stack.stackFrames[0].name));engine.frameId=stack.stackFrames[0].id;
    if((await engine.evaluate('value')).result==='2'){count=stops;await engine.control('next');await until(()=>stops>count,'complete return assignment');stack=await engine.rpc('dap','stackTrace',{threadId:engine.threadId,startFrame:0,levels:20});engine.frameId=stack.stackFrames[0].id;}
    assert.equal((await engine.evaluate('value * 2')).result,'8');
    await engine.control('continue');await until(()=>output.includes(language==='python'?'ada: 4':'Ada: 4'),'program output');await until(()=>!engine.session,'process termination');
    const received=output.split(/\r?\n/).filter(line=>line.startsWith('ARG:')).map(line=>Buffer.from(line.slice(4),'base64').toString('utf8'));assert.deepEqual(received,args);
    console.log(JSON.stringify({language,breakpoints:true,stdin:true,variables:true,evaluation:true,stepIn:true,stepOver:true,stepOut:true,output:true,projectDependencies:language==='java'}));
    fs.writeFileSync('test-artifacts/debugger-'+language+'-verification.json',JSON.stringify({language,passed:true,events,output},null,2));
  }catch(error){fs.writeFileSync('test-artifacts/debugger-'+language+'-failure.json',JSON.stringify({events,output,error:error.stack},null,2));throw error;}finally{await engine.stop();}
}
async function revocation(){
  const source='import subprocess, sys, time, os, json\nchild = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])\nprint("READY:" + json.dumps([os.getpid(), child.pid]), flush=True)\ntime.sleep(120)\n';
  fs.writeFileSync(path.join(project,'revoke.py'),source);
  const output={local:'',guest:''},engines={};
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  const wait=async(predicate,label)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>15000)throw Error(label);await new Promise(r=>setTimeout(r,50));}};
  try{
    for(const who of ['local','guest']){
      const engine=engines[who]=new Engine({transport:(op,args)=>transport(op,args,who==='guest'?'guest:verification':'local'),pollDelay:30,onEvent(type,body){if(type==='output')output[who]+=body.output;}});
      await engine.start({root:project,config:{language:'python',path:'revoke.py',args:[],env:{},noDebug:true},content:source,exceptions:'none'});
      await wait(()=>/READY:\[[\d, ]+\]/.test(output[who]),who+' process ready');
    }
    const ids=who=>JSON.parse(/READY:(\[[\d, ]+\])/.exec(output[who])[1]),guest=ids('guest'),local=ids('local');
    assert(guest.every(alive));assert(local.every(alive));
    await fetch('http://127.0.0.1:4177/revoke',{method:'POST'});
    await wait(()=>guest.every(pid=>!alive(pid)),'guest process tree must stop after revocation');
    assert(local.every(alive),'local debug session must survive guest permission revocation');
    console.log(JSON.stringify({guestRevocation:true,childProcessesStopped:true,localSessionUnaffected:true}));
    fs.writeFileSync('test-artifacts/debugger-permissions-verification.json',JSON.stringify({passed:true,guestPids:guest,localPids:local}));
  }finally{for(const engine of Object.values(engines))await engine.stop();}
}
async function runOnly(language){
  let output='';const file=language==='python'?'sample.py':'src/main/java/demo/Main.java';
  const engine=new Engine({transport,pollDelay:30,onEvent(type,body){if(type==='output')output+=body.output;}});
  const wait=async(predicate,label)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>30000)throw Error(language+' '+label+' '+output);await new Promise(r=>setTimeout(r,40));}};
  try{
    await engine.start({root:project,config:{language,path:file,args:[],env:{},noDebug:true},content:fs.readFileSync(path.join(project,file),'utf8'),exceptions:'none'});
    await wait(()=>output.includes('Name?'),'run input prompt');await engine.native('input',{text:'ada\n'});await wait(()=>!engine.session,'run termination');
    assert(output.includes(language==='python'?'ada: 4':'Ada: 4'));console.log(JSON.stringify({language,runWithoutDebugging:true,stdin:true,termination:true}));
  }finally{await engine.stop();}
}
(async()=>{for(const language of process.argv.slice(2).length?process.argv.slice(2):['python','java','permissions','python-run','java-run']){if(language==='permissions')await revocation();else if(language.endsWith('-run'))await runOnly(language.slice(0,-4));else await check(language);}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
