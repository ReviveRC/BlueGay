// Explicit regression for JDT LS's asynchronous referenced-library update.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Engine,normalize}=require('../dist/debugger-core.js');
async function verify(root,sources,testFile){
  const events=[];let expected,ready=false,summary;
  const engine=new Engine({pollDelay:30,transport:async(operation,args)=>{
    if(operation==='send'&&args.message.method==='java/buildWorkspace')assert(ready,'compile must wait until JUnit appears in the resolved classpath');
    const result=await fetch('http://127.0.0.1:4177/debug',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,args})}).then(r=>r.json());
    if(result.error)throw Error(result.error);if(operation==='open')expected=result.data.javaClasspathLibrary;return result.data;
  },onEvent(type,body){events.push({type,body});if(type==='status')console.log(body.text);if(type==='javaTestSummary')summary=body;}});
  const rpc=engine.rpc.bind(engine);engine.rpc=async(...args)=>{const result=await rpc(...args);if(args[1]==='workspace/executeCommand'&&args[2]?.command==='vscode.java.resolveClasspath'&&expected&&Array.isArray(result))ready=result.flat().some(p=>normalize(p).toLowerCase()===normalize(expected).toLowerCase());return result;};
  try{
    await engine.javaTask({root,mode:'project',config:{language:'java',path:testFile,args:[],env:{},noDebug:true},content:fs.readFileSync(path.join(root,testFile),'utf8'),sources});
    assert(expected);assert(ready);assert(summary?.total>0);assert(events.some(e=>e.type==='status'&&e.body.text==='Waiting for Java test libraries…'));
    return {root,passed:true,summary,events};
  }finally{await engine.stop();}
}
(async()=>{
  const base=path.resolve('test-artifacts/java-classpath/école-'+Date.now());fs.mkdirSync(base,{recursive:true});
  const content='import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\npublic class TEST { @Test void firstRun() { assertEquals(2, 1 + 1); } }\n';
  fs.writeFileSync(path.join(base,'TEST.java'),content);fs.writeFileSync(path.join(base,'package.bluej'),'#BlueJ package file\n');
  const fresh=await verify(base,[{path:'TEST.java',content}],'TEST.java');assert.equal(fresh.summary.passed,1);assert.equal(fresh.summary.failed,0);
  const reported=path.resolve('test-artifacts/java-test-projects/6_ChaineCaractèresSuite');let exercise=null;
  if(fs.existsSync(reported)){const sources=fs.readdirSync(reported).filter(p=>p.endsWith('.java')).map(p=>({path:p,content:fs.readFileSync(path.join(reported,p),'utf8')}));exercise=await verify(reported,sources,'ChaineCaracteresTest.java');assert.equal(exercise.summary.total,9);}
  fs.writeFileSync('test-artifacts/java-classpath-verification.json',JSON.stringify({passed:true,fresh,exercise},null,2));console.log(JSON.stringify({classpathReadiness:true,freshProject:fresh.summary,reportedExercise:exercise?.summary}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
