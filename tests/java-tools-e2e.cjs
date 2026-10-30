// Explicit integration test against serve_debugger_fixture; uses disposable projects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Engine}=require('../dist/debugger-core.js');
async function transport(operation,args){const value=await fetch('http://127.0.0.1:4177/debug',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,args})}).then(r=>r.json());if(value.error)throw Error(value.error);return value.data;}
const base=path.resolve('test-artifacts/java-test-projects');
function write(root,file,content){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
function fixture(kind){
  const root=path.join(base,kind),prefix=kind==='maven'?'package demo;\n':'',main=kind==='maven'?'src/main/java/demo/':'',test=kind==='maven'?'src/test/java/demo/':'';
  write(root,main+'Calculator.java',prefix+'public class Calculator { public static int add(int a, int b) { return a + b; } }\n');
  write(root,test+'TEST.java',prefix+`import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;
public class TEST {
  @Test void adds() { assertEquals(5, Calculator.add(2, 3)); }
  @Test void redThenGreen() { assertEquals(6, Calculator.add(2, 3)); }
  @Disabled("later") @Test void skipped() { fail("skip"); }
  @ParameterizedTest @ValueSource(ints={1,2}) void positive(int n) { assertTrue(n > 0); }
}
`);
  write(root,test+'LegacyTest.java',prefix+'import org.junit.Test;\nimport static org.junit.Assert.*;\npublic class LegacyTest { @Test public void legacyPass() { assertEquals(3, Calculator.add(1,2)); } }\n');
  if(kind==='maven')write(root,'pom.xml',`<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>java-tests</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.13.4</version><scope>test</scope></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies></project>`);
  return {root,main,test};
}
async function check(kind){
  const project=fixture(kind),events=[],rows=new Map();let summary,output='',diagnostics=[];
  const engine=new Engine({transport,pollDelay:30,onEvent(type,body){events.push({type,body});if(type==='javaTest')rows.set(body.id,body);if(type==='javaTestSummary')summary=body;if(type==='output'&&body.category!=='adapter')output+=body.output;if(type==='diagnostics')diagnostics.push(body);if(type==='status')console.log(kind,body.text);}});
  const sources=()=>[project.main+'Calculator.java',project.test+'TEST.java',project.test+'LegacyTest.java'].map(file=>({path:file,content:fs.readFileSync(path.join(project.root,file),'utf8')}));
  async function task(mode,file=project.test+'TEST.java',ids=[]){rows.clear();summary=null;diagnostics=[];output='';return engine.javaTask({root:project.root,mode,ids,config:{language:'java',path:file,args:[],env:{},noDebug:true},content:fs.readFileSync(path.join(project.root,file),'utf8'),sources:sources()});}
  try{
    assert.equal((await task('compile',project.main+'Calculator.java')).compiled,true);
    await task('project');assert.equal(summary.total,6);assert.equal(summary.passed,4);assert.equal(summary.failed,1);assert.equal(summary.skipped,1);assert([...rows.values()].some(row=>row.id.includes('junit-vintage')&&row.status==='passed'));assert([...rows.values()].some(row=>row.name.includes('[1]')||row.name.includes('[2]')));
    const failure=[...rows.values()].find(row=>row.status==='failed');assert.match(failure.message,/expected: <6> but was: <5>/);assert(failure.line>0);assert.match(failure.trace,/TEST.redThenGreen/);
    await task('class');assert.equal(summary.total,5);assert.equal(summary.failed,1);
    const file=project.test+'TEST.java';write(project.root,file,fs.readFileSync(path.join(project.root,file),'utf8').replace('assertEquals(6,','assertEquals(5,'));
    await task('failed',file,[failure.id]);assert.equal(summary.total,1);assert.equal(summary.passed,1);assert.equal(summary.failed,0);
    await task('project');assert.equal(summary.total,6);assert.equal(summary.passed,5);assert.equal(summary.failed,0);
    const original=fs.readFileSync(path.join(project.root,project.main+'Calculator.java'),'utf8');write(project.root,project.main+'Calculator.java',original.replace('return a + b;','return a + ;'));
    await assert.rejects(task('compile',project.main+'Calculator.java'),/build failed/);assert(diagnostics.some(body=>body.diagnostics.some(d=>d.severity===1)));
    write(project.root,project.main+'Calculator.java',original);
    fs.writeFileSync('test-artifacts/java-tests-'+kind+'-verification.json',JSON.stringify({passed:true,compilation:true,junit4:true,junit5:true,parameterized:true,skipped:true,uppercaseClass:true,redGreen:true,rerunFailed:true,compileErrors:true,events},null,2));
    console.log(JSON.stringify({kind,passed:true,compilation:true,junit4:true,junit5:true,parameterized:true,redGreen:true,rerunFailed:true,compileErrors:true}));
  }catch(error){fs.writeFileSync('test-artifacts/java-tests-'+kind+'-failure.json',JSON.stringify({error:error.stack,events,output,diagnostics},null,2));throw error;}finally{await engine.stop();}
}
(async()=>{for(const kind of process.argv.slice(2).length?process.argv.slice(2):['plain','maven'])await check(kind);})().catch(error=>{console.error(error.stack);process.exitCode=1;});
