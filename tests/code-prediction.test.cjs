const {test}=require('node:test');
const assert=require('node:assert/strict');
const prediction=require('../dist/code-prediction.js');
const core=require('../dist/agent-core.js');
const harness=require('./ui-harness.cjs');

const file={path:'src/main.js',content:'import {value} from "./helper";\nconst result = '};
const context=()=>prediction.buildContext(file,file.content.length,[]);
function token(){let cancelled=false;const listeners=new Set();return {get isCancellationRequested(){return cancelled;},onCancellationRequested(fn){listeners.add(fn);return {dispose(){listeners.delete(fn);}};},cancel(){cancelled=true;listeners.forEach(fn=>fn());}};}
function fixture(request){
  const current={...file},settings={enabled:true,model:'test-model',provider:'api'};let version=1,allowed=true,calls=0;
  const model={uri:{toString:()=> 'file:///src/main.js'},getOffsetAt:()=>current.content.length,getVersionId:()=>version,isDisposed:()=>false,getLanguageId:()=> 'javascript'};
  const monaco={languages:{registerInlineCompletionsProvider:()=>({dispose(){}})}};
  const controller=prediction.install(monaco,{getSettings:()=>({...settings}),getFile:()=>current,getFiles:()=>[],canPredict:()=>allowed,delay:0,request:async(...args)=>{calls++;return request(...args);}});
  const run=(cancellation=token())=>controller.provider.provideInlineCompletions(model,{lineNumber:2,column:16},{},cancellation);
  return {controller,settings,current,run,get calls(){return calls;},edit(){version++;current.content+='x';},disallow(){allowed=false;}};
}

test('code prediction defaults on, persists off and has a separate model preference',()=>{
  const h=harness();assert.equal(h.run('prefs.codePrediction'),true);assert.equal(h.run('prefs.predictionModel'),'');
  h.run("prefs.codePrediction=false;prefs.predictionModel='gpt-6-luna';savePreferences()");
  const restored=harness(undefined,{'bluegay.preferences':h.storage.get('bluegay.preferences')});
  assert.equal(restored.run('prefs.codePrediction'),false);assert.equal(restored.run('prefs.predictionModel'),'gpt-6-luna');
});

test('context is bounded and includes only directly referenced, eligible project files',()=>{
  const current={path:'src/main.js',content:'import value from "./helper";\nimport secret from "../.env";\nconst text = '+ 'x'.repeat(30000)};
  const ctx=prediction.buildContext(current,20000,[{path:'src/helper.ts',content:'export default '+ 'a'.repeat(6000)},{path:'.env',content:'SECRET=private'},{path:'unrelated.js',content:'not referenced'}],core.sensitivePath);
  assert(ctx.before.length<=12000);assert(ctx.after.length<=6000);assert.deepEqual(ctx.related.map(f=>f.path),['src/helper.ts']);assert.equal(ctx.related[0].content.length,4000);
  assert.equal(prediction.buildContext({path:'.env',content:'secret'},3,[],core.sensitivePath),null);
  assert.equal(prediction.relativePath('main.js','../outside'),null);
});

test('normalization preserves indentation and removes echoed source and suffix punctuation',()=>{
  assert.equal(prediction.normalizeCompletion('console.log(value);',{before:'console.lo',after:''}),'g(value);');
  assert.equal(prediction.normalizeCompletion('value);',{before:'console.log(',after:');'}),'value');
  assert.equal(prediction.normalizeCompletion('  return value;',{before:'function run(){\n',after:'\n}'}),'  return value;');
  assert.equal(prediction.normalizeCompletion('```js\nvalue\n```',context()),'');
});

test('enabled predictions return an insertion range without editing the document and reuse identical context',async()=>{
  const f=fixture(async()=> 'value + 1;');const before=f.current.content;
  const result=await f.run();assert.equal(result.items[0].insertText,'value + 1;');assert.equal(result.items[0].range.startColumn,result.items[0].range.endColumn);assert.equal(f.current.content,before);
  assert.equal((await f.run()).items.length,1);assert.equal(f.calls,1);
  f.settings.enabled=false;assert.deepEqual((await f.run()).items,[]);assert.equal(f.calls,1);f.controller.dispose();
});

test('cancellation during debounce avoids requests and later edits reject stale responses',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));
  const cancellation=token(),cancelled=f.run(cancellation);cancellation.cancel();assert.deepEqual((await cancelled).items,[]);assert.equal(f.calls,0);
  const pending=f.run();await new Promise(resolve=>setTimeout(resolve,10));f.edit();finish('outdated');assert.deepEqual((await pending).items,[]);f.controller.dispose();
});

test('turning predictions off or changing connection aborts work; errors back off quietly',async()=>{
  let finish,signal;const f=fixture((_,s)=>{signal=s;return new Promise(resolve=>finish=resolve);});
  const pending=f.run();await new Promise(resolve=>setTimeout(resolve,10));f.settings.enabled=false;f.controller.invalidate();assert(signal.aborted);finish('old');assert.deepEqual((await pending).items,[]);f.controller.dispose();
  const failed=fixture(async()=>{throw Error('Usage limit reached.');});assert.deepEqual((await failed.run()).items,[]);assert.match(failed.controller.status(),/Usage limit/);await failed.run();assert.equal(failed.calls,1);failed.controller.dispose();
});

function nativeTransport(events,connection={provider:'api',model:'test-model'}){
  let subscriber,unlistened=false;const calls=[];
  const request=prediction.createTransport({getConnection:()=>connection,createSSE:core.createSSE,uid:()=> 'prediction-test',listen:async(_name,fn)=>{subscriber=fn;return ()=>{unlistened=true;};},disk:{available:true,async call(command,args){calls.push({command,args});if(command==='agent_status')return {configured:true};if(command==='agent_respond')for(const event of events)subscriber({payload:{id:'prediction-test',chunk:[...new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n')]}});}}});
  return {request,calls,get unlistened(){return unlistened;}};
}

test('native predictions use a separate request purpose, short output and no chat history',async()=>{
  const f=nativeTransport([{type:'response.output_text.delta',delta:'value;'},{type:'response.completed'}]);
  assert.equal(await f.request(context(),new AbortController().signal),'value;');
  const {payload}=f.calls.find(c=>c.command==='agent_respond').args;
  assert.equal(payload.purpose,'code_prediction');assert.equal(payload.max_output_tokens,1024);assert.equal(payload.input.length,1);assert(!payload.tools);assert(f.unlistened);
});

test('failed or truncated model output is discarded and ChatGPT never falls back to an API key',async()=>{
  const f=nativeTransport([{type:'response.output_text.delta',delta:'partial'},{type:'response.incomplete'}]);
  await assert.rejects(f.request(context(),new AbortController().signal),/could not finish/);assert(f.unlistened);
  const disconnected=nativeTransport([],{provider:'chatgpt',model:'test-model',accountId:'account',planEnabled:false});
  await assert.rejects(disconnected.request(context(),new AbortController().signal),/Enable ChatGPT plan/);assert.equal(disconnected.calls.length,0);
});

test('preview predictions use the token-protected prediction route and never expose a key',async()=>{
  const calls=[];
  const request=prediction.createTransport({disk:{available:false},getConnection:()=>({provider:'api',model:'test-model'}),createSSE:core.createSSE,fetchImpl:async(url,options)=>{calls.push({url,options});return url.endsWith('/status')?Response.json({configured:true,token:'local-token'}):new Response('data: {"type":"response.output_text.delta","delta":"value;"}\n\ndata: {"type":"response.completed"}\n\n');}});
  assert.equal(await request(context(),new AbortController().signal),'value;');assert.equal(calls[1].url,'/api/chatlgbt/predict');assert.equal(calls[1].options.headers['X-BlueGay-Agent'],'local-token');assert(!calls[1].options.headers.Authorization);
});
