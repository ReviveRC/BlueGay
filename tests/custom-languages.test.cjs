const {test}=require('node:test');
const assert=require('node:assert/strict');
const languages=require('../dist/custom-languages.js');
const nomix=require('../dist/language-packs/nomix.json');
const core=require('../dist/agent-core.js');
const predictions=require('../dist/code-prediction.js');
const harness=require('./ui-harness.cjs');

function monacoFixture(){
  const entries=new Map(),providers=new Map(),tokenizers=new Map();let disposed=0;
  const registration=(map,id,value)=>{map.set(id,value);return {dispose(){disposed++;map.delete(id);}};};
  const monaco={languages:{getLanguages:()=>[...entries.values()],register:e=>registration(entries,e.id,e),setMonarchTokensProvider:(id,g)=>registration(tokenizers,id,g),setLanguageConfiguration:()=>({dispose(){disposed++;}}),registerCompletionItemProvider:(id,p)=>registration(providers,id,p),CompletionItemKind:{Snippet:27,Keyword:17},CompletionItemInsertTextRule:{InsertAsSnippet:4}}};
  return {monaco,entries,providers,tokenizers,get disposed(){return disposed;}};
}
test('packs validate bounded declarative data and reject executable or ambiguous definitions',()=>{
  assert.equal(languages.validatePack(nomix).name,'Nomix');
  assert.throws(()=>languages.validatePack({...nomix,script:'alert(1)'}),/fields/);
  assert.throws(()=>languages.validatePack({...nomix,extensions:['../file']}),/extensions/);
  assert.throws(()=>languages.validatePack({...nomix,blockComment:{}}),/blockComment/);
  assert.throws(()=>languages.validatePack({...nomix,keywords:false}),/keywords/);
  assert.throws(()=>languages.validatePack({...nomix,snippets:[{prefix:'x',body:'x',command:'run'}]}),/fields/);
  assert.throws(()=>languages.validatePack({...nomix,ai:{reference:'x'.repeat(24001)}}),/reference/);
  assert.throws(()=>languages.validatePacks([nomix,{...nomix,id:'another'}]),/already uses/);
});
test('file associations prefer exact filenames and the longest extension',()=>{
  const packs=[{...nomix,id:'short',extensions:['.nx']},{...nomix,id:'long',extensions:['.test.nx'],filenames:['Nomixfile']}];
  assert.equal(languages.detect(packs,'src/HELLO.NX').id,'short');
  assert.equal(languages.detect(packs,'src/example.test.nx').id,'long');
  assert.equal(languages.detect(packs,'folder/Nomixfile').id,'long');
});
test('registration provides snippet placeholders and replacing/removing a pack releases old providers',()=>{
  const f=monacoFixture(),registry=languages.install(f.monaco,[nomix]);
  const provider=f.providers.get('custom-nomix');
  const items=provider.provideCompletionItems({getWordUntilPosition:()=>({startColumn:3,endColumn:6})},{lineNumber:2,column:6}).suggestions;
  const fn=items.find(i=>i.label==='function'&&i.kind===27);assert.match(fn.insertText,/\$\{1:name\}/);assert.equal(fn.range.startColumn,3);
  registry.replace([{...nomix,name:'Nomix updated'}]);assert(f.disposed>=4);assert.equal(f.entries.get('custom-nomix').aliases[0],'Nomix updated');
  registry.replace([]);assert.equal(f.providers.size,0);assert.equal(registry.detect('a.nx'),undefined);
});
test('legacy Monaco void registration can be edited, removed and installed again',()=>{
  const f=monacoFixture(),register=f.monaco.languages.register;f.monaco.languages.register=entry=>{register(entry);};
  const registry=languages.install(f.monaco,[nomix]);
  registry.replace([{...nomix,name:'Updated',extensions:['.nmx']}]);
  assert.equal(registry.detect('a.nx'),undefined);assert.equal(registry.detect('a.nmx').name,'Updated');
  registry.replace([]);assert.equal(f.providers.size,0);assert.equal(registry.detect('a.nmx'),undefined);
  registry.replace([nomix]);assert.equal(registry.getByLanguage('custom-nomix').name,'Nomix');
});
test('unknown language references are attached only for matching code and respect opt-out and total budget',()=>{
  const f=monacoFixture(),registry=languages.install(f.monaco,[nomix]);
  const refs=registry.references(['custom-nomix']);assert.match(refs[0].reference,/from tools fetch/);
  const payload=core.buildRequest({prompt:'Explain this',model:'test',attachments:[{path:'hello.nx',content:'print(1)'}],languageReferences:refs});
  assert.equal(JSON.parse(payload.input[0].content).languageReferences[0].language,'Nomix');assert.match(payload.instructions,/untrusted technical data/);
  assert.deepEqual(registry.references(['java']),[]);
  registry.replace([{...nomix,ai:{...nomix.ai,enabled:false}}]);assert.deepEqual(registry.references(['custom-nomix']),[]);
  const large={...nomix,ai:{reference:'\t'.repeat(24000),examples:'\n'.repeat(10000)}};
  assert(JSON.stringify(languages.references([large],['custom-nomix'])).length<=36000);
});
test('custom associations apply to already open plain text and removed manual modes fall back automatically',()=>{
  const h=harness();h.context.pack=nomix;
  h.run(`customLanguages=window.BlueGayLanguages.install({languages:{getLanguages:()=>[],register:()=>({dispose(){}}),setMonarchTokensProvider:()=>({dispose(){}}),setLanguageConfiguration:()=>({dispose(){}}),registerCompletionItemProvider:()=>({dispose(){}})}},[pack]);`);
  assert.equal(h.run("languageFor({path:'hello.nx',content:''})"),'custom-nomix');
  h.run('customLanguages.replace([])');
  assert.equal(h.run("languageFor({path:'hello.nx',content:'',language:'custom-nomix'})"),'plaintext');
});
test('Java has offline keywords, expanded snippets and Tab completion independent of AI',()=>{
  const f=monacoFixture();require('../dist/basic-completions.js').install(f.monaco);
  const items=f.providers.get('java').provideCompletionItems({getWordUntilPosition:()=>({startColumn:1,endColumn:4})},{lineNumber:1,column:4}).suggestions;
  assert(items.some(i=>i.label==='public'));assert(items.some(i=>i.label==='return'));
  const h=harness();assert.equal(h.run('editorOptions().tabCompletion'),'on');
  const snippets=[];h.context.monaco={languages:{registerCompletionItemProvider:(_id,p)=>{if(_id==='java')snippets.push(p);},CompletionItemKind:{Snippet:27},CompletionItemInsertTextRule:{InsertAsSnippet:4}}};
  h.run('registerSnippets()');const result=snippets[0].provideCompletionItems({getWordUntilPosition:()=>({startColumn:1,endColumn:4})},{lineNumber:1,column:4});
  assert(result.suggestions.some(i=>i.label==='for'&&i.insertText.includes('${1:i}')));
});
test('Java prediction context includes explicitly imported project types',()=>{
  const file={path:'src/Main.java',content:'import demo.Helper;\nclass Main {\n  int result = '};
  const ctx=predictions.buildContext(file,file.content.length,[{path:'src/demo/Helper.java',content:'package demo; class Helper {}'},{path:'src/Other.java',content:'unrelated'}],()=>false,'java');
  assert.deepEqual(ctx.related.map(f=>f.path),['src/demo/Helper.java']);
});
test('documentation requests retain the custom language reference',()=>{
  const documentation=require('../dist/documentation-core.js');
  const payload=documentation.request({path:'hello.nx',content:'print(1)',language:'custom-nomix'},{model:'test',languageReferences:[languages.reference(nomix)]});
  assert.equal(JSON.parse(payload.input[0].content).languageReferences[0].language,'Nomix');
  assert.match(payload.instructions,/custom language reference/);
});
test('inline predictions can extend a selected Java keyword instead of being disabled by its menu',async()=>{
  let sent;
  const model={uri:{toString:()=> 'file:///Main.java'},getOffsetAt:()=>3,getLanguageId:()=> 'java',getVersionId:()=>1,isDisposed:()=>false,getValueInRange:()=> 'ret'};
  const controller=predictions.install({languages:{registerInlineCompletionsProvider:()=>({dispose(){}})}},{getSettings:()=>({enabled:true}),getFile:()=>({path:'Main.java',content:'ret'}),getFiles:()=>[],canPredict:()=>true,delay:0,request:async ctx=>{sent=ctx;return 'urn 42;';},getLanguageReference:()=>({language:'Java'})});
  const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})};
  const result=await controller.provider.provideInlineCompletions(model,{lineNumber:1,column:4},{selectedSuggestionInfo:{text:'return',isSnippetText:false,range:{startLineNumber:1,endLineNumber:1,startColumn:1,endColumn:4}}},token);
  assert.equal(sent.selectedSuggestion,'urn');assert.equal(result.items[0].insertText,'urn 42;');controller.dispose();
});
