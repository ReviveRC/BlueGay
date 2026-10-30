const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../dist/debugger-core.js'),harness=require('./ui-harness.cjs');
test('launch configuration and Java main class inference preserve real program arguments',()=>{
  assert.equal(core.mainClassFor('src/Main.java','/* package wrong; */ package demo; public class Main {}'),'demo.Main');
  assert.equal(core.relativeSource('C:\\project','C:\\project\\src\\Main.java'),'src/Main.java');
  const config={language:'python',path:'script.py',args:['a b','"quoted"'],env:{NAME:'été'}};assert.equal(core.validateConfig(config),config);
  assert.throws(()=>core.validateConfig({...config,args:'--flag'}),/array/);assert.throws(()=>core.validateConfig({...config,env:{BAD:123}}),/object/);
});
test('DAP responses correlate to their requests and adapter failures reject the correct promise',async()=>{
  const sent=[];const engine=new core.Engine({transport:async(operation,args)=>sent.push({operation,args})});engine.session={session:'one'};
  const scopes=engine.rpc('dap','scopes',{frameId:7}),variables=engine.rpc('dap','variables',{variablesReference:3});
  engine.consume('dap',{type:'response',request_seq:2,success:false,message:'No frame'});engine.consume('dap',{type:'response',request_seq:1,success:true,body:{scopes:[{name:'Locals'}]}});
  assert.equal((await scopes).scopes[0].name,'Locals');await assert.rejects(variables,/No frame/);assert.equal(sent[0].args.message.arguments.frameId,7);await engine.stop();
});
test('stopping rejects pending requests and delayed startup cannot revive the old session',async()=>{
  let finish;const calls=[];const engine=new core.Engine({transport:async(operation,args)=>{calls.push({operation,args});if(operation==='open')return new Promise(resolve=>finish=resolve);}});
  const starting=engine.start({root:'project',config:{language:'python',path:'test.py',args:[],env:{}}});await new Promise(resolve=>setImmediate(resolve));await engine.stop();finish({session:'old',language:'python'});await starting;
  assert.equal(engine.session,null);assert(calls.some(c=>c.operation==='stop'&&c.args.session==='old'));
});
test('Java ready event resolves independently of ordinary language server progress',async()=>{
  const engine=new core.Engine({transport:async()=>{}}),ready=engine.waitEvent('javaReady',1000);engine.consume('lsp',{method:'language/status',params:{type:'ServiceReady',message:'Ready'}});await ready;await engine.stop();
});
test('run-only adapters do not need an initialized event or breakpoint configuration',async()=>{
  for(const language of ['python','java']){
    const sent=[];let engine;
    engine=new core.Engine({transport:async(operation,args)=>{
      if(operation==='open')return {session:'run',language,programUri:'file:///project/Main.java'};
      if(operation==='poll')return {events:[]};
      if(operation==='send'){
        const m=args.message,name=m.command||m.method;sent.push(name);let result={};
        if(name==='initialize'&&args.peer==='lsp')engine.consume('lsp',{method:'language/status',params:{type:'ServiceReady'}});
        if(name==='java/buildWorkspace')result=1;
        if(m.params?.command==='vscode.java.resolveMainClass')result=[{mainClass:'Main'}];
        if(m.params?.command==='vscode.java.resolveClasspath')result=[[],['classes']];
        if(m.seq||m.id)engine.consume(args.peer,args.peer==='dap'?{type:'response',request_seq:m.seq,success:true,body:result}:{id:m.id,result});
      }
    }});
    try{await engine.start({root:'project',config:{language,path:language==='python'?'test.py':'Main.java',args:[],env:{},noDebug:true}});assert(sent.includes('launch'));assert(!sent.includes('configurationDone'));assert(!sent.includes('setBreakpoints'));}finally{await engine.stop();}
  }
});
test('repeated stop and restart wait for the same native process cleanup',async()=>{
  let finish;const engine=new core.Engine({transport:async(operation)=>{if(operation==='stop')await new Promise(resolve=>finish=resolve);}});engine.session={session:'one'};
  let done=false;const stopping=engine.stop(),second=engine.stop().then(()=>done=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);finish();await Promise.all([stopping,second]);assert.equal(done,true);
});
function ui(invoke=async()=>{}){const h=harness(invoke);h.context.window.BlueGayDebugCore=core;h.run(fs.readFileSync('dist/together.js','utf8'));h.run(fs.readFileSync('dist/debugger.js','utf8'));return h;}

test('breakpoints follow Monaco-tracked line changes and retain their condition',()=>{
  const h=ui();let changed,position=6;
  h.context.bpModel={getLineCount:()=>20,deltaDecorations:(_old,points)=>points.map((_p,index)=>'bp'+index),onDidChangeContent:callback=>changed=callback,getDecorationRange:()=>({startLineNumber:position})};
  h.context.monaco={Range:class{constructor(line){this.startLineNumber=line;}},editor:{TrackedRangeStickiness:{NeverGrowsWhenTypingAtEdges:1}}};
  h.run("monacoReady=true;files=[{id:'source',path:'sample.py'}];models.set('source',bpModel);window.BlueGayDebugger.state.breakpoints={'sample.py':[{line:6,condition:'value > 0'}]};document.querySelector=()=>null;window.BlueGayDebugger.refreshBreakpointDecorations();");
  position=7;changed();assert.equal(h.run("window.BlueGayDebugger.state.breakpoints['sample.py'][0].line"),7);assert.equal(h.run("window.BlueGayDebugger.state.breakpoints['sample.py'][0].condition"),'value > 0');
  assert.equal(JSON.parse(h.storage.get('bluegay.debug.breakpoints'))['sample.py'][0].line,7);
});

test('adapter diagnostics stay separate from program output and surface on startup failure',()=>{
  const h=ui();h.run("document.querySelector=()=>null;window.BlueGayDebugger.engine.emit('output',{category:'adapter',output:'Adapter startup detail'});");
  assert.equal(h.run('window.BlueGayDebugger.state.lines.length'),0);
  h.run("window.BlueGayDebugger.engine.emit('output',{category:'stdout',output:'Hello program'});window.BlueGayDebugger.engine.emit('error',{message:'Cannot start'});");
  assert.equal(h.run('window.BlueGayDebugger.state.lines[0].text'),'Hello program');assert(h.run("window.BlueGayDebugger.state.lines.some(line=>line.text==='Adapter startup detail')"));
});
test('Code Together console permission defaults off and blocks a guest before native execution',async()=>{
  const calls=[],h=ui(async(command,args)=>{calls.push({command,args});return {session:'remote'};});
  h.run("together.mode='guest';together.connected=true;together.code='invite';");assert.equal(h.run('window.BlueGayDebugger.canUse()'),false);
  await assert.rejects(h.run("window.BlueGayDebugger.engine.transport('open',{})"),/host has disabled/);assert.equal(calls.length,0);
  h.run('together.permissions.console=true');assert.equal(h.run('window.BlueGayDebugger.canUse()'),true);
  await h.run("window.BlueGayDebugger.engine.transport('open',{})");assert.equal(calls[0].command,'together_request');assert.equal(calls[0].args.operation,'debugger');assert.equal(calls[0].args.args.operation,'open');
});
test('a session retains its original transport when joining or leaving collaboration',async()=>{
  const calls=[],h=ui(async(command,args)=>{calls.push({command,args});return {session:'local-session'};});
  await h.run("window.BlueGayDebugger.engine.transport('open',{})");
  h.run("together.mode='guest';together.connected=true;together.permissions.console=false;");
  await h.run("window.BlueGayDebugger.engine.transport('stop',{session:'local-session'})");
  assert.equal(calls[1].command,'debugger_request');assert.equal(calls[1].args.operation,'stop');
});
test('Run menu, debugger panel and shortcuts are discoverable',()=>{
  const h=ui();const labels=Array.from(h.run("menuItems('Run').filter(item=>item!=='-').map(item=>item.label)"));
  assert(labels.includes('Start / continue debugging'));assert(labels.includes('Debugger settings…'));
  assert(h.run("shortcutRows.some(([label,key])=>label==='Open HTML in browser'&&key==='Ctrl Alt B')"));
  assert(fs.readFileSync('dist/index.html','utf8').includes('data-panel="debug"'));
});
