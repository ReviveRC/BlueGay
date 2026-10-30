// Runs the real JUnit engines without a language server or network access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve('test-artifacts/java-assertion-details');fs.mkdirSync(root,{recursive:true});
const jar=path.resolve('.build-tools/debuggers/java-tests/junit-platform-console-standalone-1.13.4.jar');
assert(fs.existsSync(jar),'Set up Java testing tools before running this integration test.');
fs.writeFileSync(path.join(root,'AssertionDetailsTest.java'),`
public class AssertionDetailsTest {
  @org.junit.jupiter.api.Test void numeric() { org.junit.jupiter.api.Assertions.assertEquals(6,5); }
  @org.junit.jupiter.api.Test void multiline() { org.junit.jupiter.api.Assertions.assertEquals("first\\n<expected>","first\\n<actual>"); }
  @org.junit.jupiter.api.Test void empty() { org.junit.jupiter.api.Assertions.assertEquals("","text"); }
  @org.junit.jupiter.api.Test void nullValue() { org.junit.jupiter.api.Assertions.assertEquals("present",null); }
  @org.junit.jupiter.api.Test void exception() { throw new IllegalStateException("a useful reason"); }
  @org.junit.jupiter.api.Test void wrapped() { try { org.junit.jupiter.api.Assertions.assertEquals(2,3); } catch (AssertionError error) { throw new RuntimeException("wrapper",error); } }
  @org.junit.jupiter.api.Test void passing() { org.junit.jupiter.api.Assertions.assertEquals(1,1); }
  @org.junit.jupiter.api.Disabled("later") @org.junit.jupiter.api.Test void skipped() {}
  @org.junit.Test public void legacyNumeric() { org.junit.Assert.assertEquals(4,9); }
  @org.junit.Test public void legacyString() { org.junit.Assert.assertEquals("long shared prefix expected shared suffix","long shared prefix actual shared suffix"); }
  @org.junit.Test public void legacy3String() { junit.framework.Assert.assertEquals("expected","actual"); }
}
`);
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',timeout:120000});assert.ifError(result.error);return result;}
const compilation=run('javac',['-encoding','UTF-8','-cp',jar,'-d',root,path.join(root,'AssertionDetailsTest.java')]);assert.equal(compilation.status,0,compilation.stderr);
const report=path.join(root,'results.jsonl');
const execution=run('java',['-cp',[jar,root].join(path.delimiter),path.resolve('src-tauri/java/BlueGayTestRunner.java'),report,'class','AssertionDetailsTest']);
assert.equal(execution.status,1,execution.stderr);
const events=fs.readFileSync(report,'utf8').trim().split('\n').map(JSON.parse),rows=new Map(events.filter(e=>e.status==='failed').map(e=>[e.methodName,e]));
for(const [name,expected,actual]of [['numeric','6','5'],['multiline','first\n<expected>','first\n<actual>'],['empty','','text'],['nullValue','present','null'],['wrapped','2','3'],['legacyNumeric','4','9'],['legacyString','long shared prefix expected shared suffix','long shared prefix actual shared suffix'],['legacy3String','expected','actual']]){
  const row=rows.get(name);assert(row,name);assert.equal(row.expected,expected,name);assert.equal(row.actual,actual,name);assert(row.line>0,name);assert(row.trace.includes(name),name);
}
assert.match(rows.get('exception').message,/a useful reason/);assert(!Object.hasOwn(rows.get('exception'),'expected'));
const summary=events.find(e=>e.event==='summary');assert.equal(summary.failed,9);assert.equal(summary.passed,1);assert.equal(summary.skipped,1);
console.log('Real JUnit 3/4/5 assertions verified: numeric, full strings, multiline, empty, null, wrapped errors, exceptions, pass and skip.');
