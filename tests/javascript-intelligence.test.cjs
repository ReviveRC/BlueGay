const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=require('../dist/javascript-intelligence.js');
let workerApi;
vm.runInNewContext(fs.readFileSync('dist/vendor/vs/language/typescript/tsWorker.js','utf8'),{console,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,define(_name,_deps,factory){workerApi=factory(()=>{});}});

function fixture(){
  const models=new Map(),providers={},libs={},options={};
  const defaults=name=>({setCompilerOptions(value){options[name]=value;},setEagerModelSync(){},addExtraLib(content,path){libs[name]??={};const entry={content,version:(libs[name][path]?.version||0)+1};libs[name][path]=entry;return {dispose(){if(libs[name][path]===entry)delete libs[name][path];}};}});
  const uri=path=>({path,scheme:'file',toString(){return 'file://'+path;},with(value){return uri(value.path);}});
  function model(text,language,path){
    const listeners={change:[],dispose:[]};let disposed=false,version=1;
    const subscribe=(kind,fn)=>{listeners[kind].push(fn);return {dispose(){listeners[kind]=listeners[kind].filter(f=>f!==fn);}};};
    const value={uri:typeof path==='string'?uri(path):path,get version(){return version;},getValue:()=>text,getValueLength:()=>text.length,getVersionId:()=>version,getLanguageId:()=>language,isDisposed:()=>disposed,
      getOffsetAt:pos=>text.split('\n').slice(0,pos.lineNumber-1).reduce((n,line)=>n+line.length+1,0)+pos.column-1,
      getPositionAt:offset=>{const lines=text.slice(0,offset).split('\n');return {lineNumber:lines.length,column:lines.at(-1).length+1};},
      getWordUntilPosition:pos=>{const offset=value.getOffsetAt(pos),match=/[\w$]*$/.exec(text.slice(0,offset))[0];return {startColumn:pos.column-match.length,endColumn:pos.column,word:match};},
      setValue(next){text=next;version++;listeners.change.forEach(fn=>fn());},onDidChangeContent:fn=>subscribe('change',fn),onWillDispose:fn=>subscribe('dispose',fn),
      dispose(){listeners.dispose.forEach(fn=>fn());disposed=true;models.delete(value.uri.toString());}
    };models.set(value.uri.toString(),value);return value;
  }
  const worker=()=>workerApi.create({getMirrorModels:()=>[...models.values()].filter(m=>m.getLanguageId()==='javascript')},{compilerOptions:options.js,extraLibs:libs.js||{},inlayHintsOptions:{}});
  const languages={CompletionItemKind:new Proxy({},{get:(_,key)=>key}),typescript:{ScriptTarget:{ES2020:7},ModuleResolutionKind:{NodeJs:2},ModuleKind:{ESNext:99},JsxEmit:{ReactJSX:4},javascriptDefaults:defaults('js'),typescriptDefaults:defaults('ts'),getJavaScriptWorker:async()=>async()=>worker()}};
  for(const [method,name]of [['registerCompletionItemProvider','completion'],['registerHoverProvider','hover'],['registerSignatureHelpProvider','signature'],['registerDefinitionProvider','definition']])languages[method]=(_language,provider)=>{providers[name]=provider;return {dispose(){}};};
  const monaco={languages,Uri:{parse:text=>uri(new URL(text).pathname)},editor:{createModel:model,getModel:uri=>models.get(uri.toString()),onDidChangeModelLanguage:()=>({dispose(){}})}};
  const intelligence=js.install(monaco);
  async function complete(marked,path='/pages/index.html'){
    const offset=marked.indexOf('|'),text=marked.replace('|',''),html=model(text,'html',path);intelligence.track(html);
    const result=await providers.completion.provideCompletionItems(html,html.getPositionAt(offset),{},{});
    return {html,result,offset};
  }
  return {complete,model,intelligence,models,providers,libs,worker};
}

test('embedded JS extraction excludes comments, attributes, raw text, data scripts and external scripts',()=>{
  for(const text of ['<!-- <script>x.</script> -->','<div title="<script>x.</script>">','<textarea><script>x.</script></textarea>','<style>/* <script>x.</script> */</style>','<script type="application/json">{"x":1}</script>','<script type="importmap">{}</script>','<script src="app.js">x.</script>'])assert.deepEqual(js.scriptRegions(text),[],text);
  const quoted='<SCRIPT title="a > b" TYPE="text/javascript">x.</SCRIPT>';
  assert.equal(js.scriptRegions(quoted)[0].start,quoted.indexOf('x.'));
  assert.equal(js.scriptRegions('<script type="module">x.')[0].module,true);
});

test('masking preserves UTF-16 offsets and CRLF and separates independent classic scripts',()=>{
  const text='<p>💅</p>\r\n<script>const word="hi"</script><script>word.</script>';
  const [source]=js.embeddedSources(text);
  assert.equal(source.text.length,text.length);assert.equal(source.text.indexOf('const word'),text.indexOf('const word'));
  assert.equal(source.text.slice(text.indexOf('\r\n'),text.indexOf('\r\n')+2),'\r\n');
  assert(!source.text.includes('<p>'));assert.match(source.text,/"hi"\n;/);
});

test('real bundled worker completes all reported properties inside HTML',async()=>{
  for(const [marked,name]of [
    ['<script>const items=[1,2]; items.le|</script>','length'],
    ['<script>const items=[1,2]; items.|</script>','toSorted'],
    ['<script>const text="hello"; text.|</script>','length'],
    ['<script>document.querySelector("button").cla|</script>','classList'],
    ['<script>document.addEventListener("click", event=>{event.cur|});</script>','currentTarget'],
    ['<script>const word="hi"</script><script>word.|</script>','length'],
    ['<script>const word="hi" // comment</script><script>word.|</script>','length'],
    ['<script>/** @param {MouseEvent} event */ function handler(event){event.|}</script>','currentTarget'],
    ['<script>document.addEventListener("click",event=>{if(event.currentTarget instanceof Element)event.currentTarget.|});</script>','classList']
  ]){
    const f=fixture(),{result,html}=await f.complete(marked);
    assert(result.suggestions.some(item=>item.label===name),name+': '+marked);
    const item=result.suggestions.find(item=>item.label===name),start=html.getOffsetAt({lineNumber:item.range.startLineNumber,column:item.range.startColumn}),end=html.getOffsetAt({lineNumber:item.range.endLineNumber,column:item.range.endColumn});
    const expanded=html.getValue().slice(0,start)+item.insertText+html.getValue().slice(end);
    assert(expanded.includes('.'+name));assert(expanded.endsWith('</script>'));
    f.intelligence.dispose();
  }
});

test('HTML module imports and workspace declarations resolve across JavaScript and TypeScript',async()=>{
  const f=fixture();
  f.intelligence.track(f.model('export const words = ["hello"];','typescript','/pages/helpers.ts'));
  f.intelligence.track(f.model('declare const customElement: HTMLButtonElement;','typescript','/types.d.ts'));
  const a=await f.complete('<script type="module">import {words} from "./helpers"; words.|</script>');
  assert(a.result.suggestions.some(s=>s.label==='length'));
  const b=await f.complete('<script>customElement.|</script>','/pages/other.html');
  assert(b.result.suggestions.some(s=>s.label==='classList'));
  f.intelligence.dispose();
});

test('HTML completions respect module boundaries, cancellation and model lifetime',async()=>{
  const f=fixture(),a=await f.complete('<script type="module">const isolated=[1];</script><script>isolated.|</script>');
  assert(!a.result.suggestions.some(s=>s.label==='length'));
  assert.equal(f.intelligence.contextAt(a.html,{lineNumber:1,column:1}),null);
  const cancelled=await f.providers.completion.provideCompletionItems(a.html,a.html.getPositionAt(a.offset),{},{isCancellationRequested:true});assert.deepEqual(cancelled.suggestions,[]);
  a.html.setValue('<p>HTML only</p>');assert.equal(f.models.size,1);
  a.html.dispose();assert.equal(f.models.size,0);f.intelligence.dispose();
});

test('related workspace declarations update and disappear when their files close',async()=>{
  const f=fixture(),types=f.model('declare const projectValue: string;','typescript','/types.d.ts');f.intelligence.track(types);
  const a=await f.complete('<script>projectValue.|</script>');assert(a.result.suggestions.some(s=>s.label==='length'));
  types.setValue('declare const projectValue: HTMLButtonElement;');
  const b=await f.complete('<script>projectValue.|</script>','/second.html');assert(b.result.suggestions.some(s=>s.label==='classList'));
  types.dispose();assert(!f.libs.js['file:///types.d.ts']);f.intelligence.dispose();
});
