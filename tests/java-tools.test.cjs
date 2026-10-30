const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const harness=require('./ui-harness.cjs'),core=require('../dist/debugger-core.js');
test('folder context menu creates a real file inside the clicked folder and expands it',async()=>{
  const calls=[],h=harness(async(command,args)=>{calls.push({command,args});return {absolutePath:args.path,content:args.content,version:'created'};});
  h.run("nativeReady=true;nativeRoot='C:/project';files=[];tabs=[];explicitFolders=['src','src/test'];collapsed.add('src');collapsed.add('src/test');prefs.formatOnSave=false;prefs.fixIndentationOnSave=false;showPopup=items=>window.folderMenu=items;promptValue=(title,help,name,done)=>{window.creation=done('TEST.java')};");
  const row={dataset:{folder:'src/test'},focus(){}};
  h.events.contextmenu({target:{closest:selector=>selector==='#sidebar-content [data-folder]'?row:null},clientX:20,clientY:30,preventDefault(){}});
  assert.equal(h.context.window.folderMenu[0].label,'New file…');h.context.window.folderMenu[0].run();await h.context.window.creation;
  assert.equal(h.run('currentFile().path'),'src/test/TEST.java');assert.equal(calls[0].command,'save_document');assert.equal(calls[0].args.path,'C:/project/src/test/TEST.java');assert.equal(calls[0].args.expectedVersion,null);assert.equal(h.run('collapsed.size'),0);assert.equal(h.run('fileDirty(currentFile())'),false);
});
test('new file in folder rejects escape paths and honors collaboration create permission',async()=>{
  const h=harness(async()=>{});h.run("files=[];tabs=[];promptValue=(title,help,name,done)=>{window.creation=done('../outside.java')};newFileInFolder('tests')");await h.context.window.creation;assert.equal(h.run('files.length'),0);
  h.context.window.BlueGayTogether={allowed:()=>false};h.run("promptValue=()=>{throw Error('should not prompt')};newFileInFolder('tests')");assert.equal(h.run('files.length'),0);
});
function javaEngine({build=1,summary=true}={}){
  const sent=[],events=[];let engine;
  engine=new core.Engine({pollDelay:1,onEvent:(type,body)=>events.push({type,body}),transport:async(operation,args)=>{
    sent.push({operation,args});
    if(operation==='info')return {javaTestsReady:true};
    if(operation==='open')return {session:'java',language:'java',programUri:'file:///project/TEST.java'};
    if(operation==='poll')return {events:[]};
    if(operation==='tests'){engine.consume('system',{type:'event',event:'javaTaskFinished',body:{exitCode:summary?1:2,summary}});}
    if(operation==='send'){
      const m=args.message;let result={};
      if(m.method==='initialize')engine.consume('lsp',{method:'language/status',params:{type:'ServiceReady'}});
      if(m.method==='java/buildWorkspace')result=build;
      if(m.params?.command==='vscode.java.resolveClasspath')result=[[],['C:/project/bin','C:/project/lib/junit.jar']];
      if(m.id)engine.consume('lsp',{id:m.id,result});
    }
  }});return {engine,sent,events};
}
const request={root:'C:/project',config:{language:'java',path:'TEST.java',args:[],env:{}},content:'public class TEST { @Test void works() {} }',sources:[{path:'TEST.java',content:'@Test void works() {}'}]};
test('Java compilation does not resolve or launch a main class and always cleans up',async()=>{
  const {engine,sent}=javaEngine();const result=await engine.javaTask({...request,mode:'compile'});assert.equal(result.compiled,true);assert(!sent.some(c=>c.operation==='tests'));assert(!sent.some(c=>c.args.message?.params?.command==='vscode.java.resolveMainClass'));assert(sent.some(c=>c.operation==='stop'));assert.equal(engine.session,null);
});
test('Java waits for the managed JUnit classpath before starting compilation',async()=>{
  const {engine,sent}=javaEngine();const base=engine.transport;let resolved=0,compiling=false;
  engine.transport=async(operation,args)=>{
    if(operation==='open')return {...await base(operation,args),javaClasspathLibrary:'C:/tools/junit.jar'};
    if(operation==='send'&&args.message.params?.command==='vscode.java.resolveClasspath'){
      resolved++;engine.consume('lsp',{id:args.message.id,result:[[],resolved<2?['C:/project/bin']:['C:/project/bin','c:\\tools\\junit.jar']]});return;
    }
    if(operation==='send'&&args.message.method==='java/buildWorkspace'){assert.equal(resolved,2);compiling=true;}
    return base(operation,args);
  };
  await engine.javaTask({...request,mode:'compile'});assert(compiling);assert.equal(resolved,2);assert.equal(sent.filter(call=>call.args.message?.method==='java/buildWorkspace').length,1);
});
test('JUnit tasks resolve test-scope dependencies and retain failure results without treating them as runner errors',async()=>{
  const {engine,sent}=javaEngine();const result=await engine.javaTask({...request,mode:'failed',ids:['[engine:junit-jupiter]/[class:TEST]/[method:works()]']});assert.equal(result.exitCode,1);
  const classpath=sent.find(c=>c.args.message?.params?.command==='vscode.java.resolveClasspath');assert.deepEqual(classpath.args.message.params.arguments,['TEST','','test']);
  const run=sent.find(c=>c.operation==='tests');assert.deepEqual(run.args.ids,['[engine:junit-jupiter]/[class:TEST]/[method:works()]']);assert.equal(run.args.mode,'failed');assert(sent.some(c=>c.operation==='stop'));
});
test('compile errors prevent test execution and runner infrastructure errors cannot appear as passing tests',async()=>{
  const failed=javaEngine({build:2});await assert.rejects(failed.engine.javaTask({...request,mode:'project'}),/build failed/);assert(!failed.sent.some(c=>c.operation==='tests'));assert.equal(failed.engine.session,null);
  const runner=javaEngine({summary:false});await assert.rejects(runner.engine.javaTask({...request,mode:'class'}),/could not finish/);assert.equal(runner.engine.session,null);
});
test('Java tests interface distinguishes results, diagnostics, output and stale source state',()=>{
  const h=harness(async()=>{});h.context.window.BlueGayDebugCore=core;h.context.window.BlueGayDebugger={canUse:()=>true,engine:{session:{root:'C:/project'}}};h.run(fs.readFileSync('dist/java-tools.js','utf8'));
  h.run("document.querySelector=()=>null;window.BlueGayJavaTools.state.busy=true;window.BlueGayJavaTools.handleEvent('javaTest',{id:'test',name:'adds',status:'failed',message:'expected 6 but was 5'});window.BlueGayJavaTools.handleEvent('javaTestSummary',{total:1,passed:0,failed:1,skipped:0});window.BlueGayJavaTools.handleEvent('output',{category:'adapter',output:'internal log'});window.BlueGayJavaTools.handleEvent('output',{category:'stdout',output:'program output'});");
  assert.equal(h.run("window.BlueGayJavaTools.state.rows.get('test').status"),'failed');assert.equal(h.run('window.BlueGayJavaTools.state.summary.failed'),1);assert.equal(h.run('window.BlueGayJavaTools.state.output'),'program output');
  h.run("window.BlueGayJavaTools.handleEvent('diagnostics',{uri:'file:///C:/project/TEST.java',diagnostics:[{severity:1,message:'Syntax error',range:{start:{line:2,character:1}}}]})");assert.equal(h.run('window.BlueGayJavaTools.state.diagnostics.length'),1);
  h.run("window.BlueGayJavaTools.handleEvent('diagnostics',{uri:'file:///C:/project/TEST.java',diagnostics:[]})");assert.equal(h.run('window.BlueGayJavaTools.state.diagnostics.length'),0);
  h.run("files=[{id:'java',path:'TEST.java'}];activeId='java';window.BlueGayJavaTools.markChanged()");assert.equal(h.run('window.BlueGayJavaTools.state.stale'),true);
});

test('failed test rows and details show assertion values as text, including empty and multiline values',()=>{
  const h=harness(async()=>{});
  const node=tag=>({tag,textContent:'',childNodes:[],append(...children){this.childNodes.push(...children);},prepend(...children){this.childNodes.unshift(...children);},replaceChildren(...children){this.childNodes=children;},setAttribute(){}});
  h.context.document.createElement=node;
  for(const id of ['java-task-toolbar','java-test-summary','java-test-list','java-test-details'])Object.assign(h.context.document.querySelector('#'+id),node('div'));
  h.context.window.BlueGayDebugger={canUse:()=>true};h.run(fs.readFileSync('dist/java-tools.js','utf8'));
  const state=h.context.window.BlueGayJavaTools.state;
  state.rows.set('assertion',{id:'assertion',name:'compares',status:'failed',expected:'',actual:'<script>\nsecond line',message:'Assertion failed',trace:'at TEST.compares(TEST.java:5)'});
  h.context.window.BlueGayJavaTools.refresh();
  const list=h.elements.get('#java-test-list'),details=h.elements.get('#java-test-details');
  assert.equal(list.childNodes[0].childNodes[0].textContent,'Expected: "" · Received: <script>\nsecond line');
  const values=details.childNodes.filter(n=>n.className==='java-test-value');
  assert.deepEqual(values.map(n=>n.childNodes.map(c=>c.textContent)),[['Expected','""'],['Received','<script>\nsecond line']]);
  assert.equal(details.childNodes.at(-1).tag,'details');assert.equal(details.childNodes.at(-1).childNodes[0].textContent,'Stack trace');
  state.rows.clear();state.rows.set('error',{id:'error',name:'throws',status:'failed',message:'java.lang.IllegalStateException: broken'});
  h.context.window.BlueGayJavaTools.refresh();
  assert.equal(list.childNodes[0].childNodes[0].textContent,'java.lang.IllegalStateException: broken');
  assert.equal(details.childNodes.filter(n=>n.className==='java-test-value').length,0);
});
