const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../dist/documentation-core.js');
const harness=require('./ui-harness.cjs');
const doc={language:'Java',summary:'A Java class.',sections:[],members:[{name:'add',signature:'public int add(int n)',description:'Adds a number.',sections:[{title:'Parameters',content:'',items:['n: The number.']},{title:'Returns',content:'The sum.',items:[]},{title:'Exceptions',content:'',items:['IllegalArgumentException for negative values.']}]}],notes:[],comments:[]};
function setup(invoke){
  const h=harness(invoke);h.context.window.ChatLGBTCore=require('../dist/agent-core.js');h.context.window.BlueGayDocumentationCore=core;h.context.AbortController=AbortController;
  for(const file of ['agent.js','documentation.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../dist',file),'utf8'),h.context);
  h.run(`files=[{id:'a',path:'src/Main.java',content:'class Main {}',saved:'class Main {}',history:[]}];explicitFolders=[];projectName='Sample';nativeReady=true;nativeRoot=disk.available?'C:/sample':null;refreshChatStatus=async()=>({configured:true,token:'test'});persist=()=>{};refreshFileUI=()=>{};setDocumentText=(file,text)=>{file.content=text;};`);
  return h;
}
function stream(h,data=doc,terminal={type:'response.completed'}){
  h.context.fetch=async()=>new Response([{type:'response.output_text.delta',delta:JSON.stringify(data)},...(terminal?[terminal]:[])].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
}
test('plans all eligible files, preserves nested duplicate names, and reports skipped paths',()=>{
  const paths=['src/Main.java','other/Main.java','README.md','Documentation/index.html','.env','node_modules/a.js','empty.txt','large.java','image.png'];
  const result=core.plan(paths.map((path,i)=>({id:i,path,content:i===6?'':i===7?'x'.repeat(90000):'text',unsupported:i===8?'binary':null})));
  assert.deepEqual(result.sources.map(f=>f.path),paths.slice(0,3));assert.equal(result.skipped.length,5);
  assert.notEqual(core.outputPath(paths[0]),core.outputPath(paths[1]));
});

test('planning accepts arbitrary languages, captures editor overrides and excludes old and new output',()=>{
  const files=[{id:'a',path:'task.custom',content:'custom source',language:'custom-language'}, {id:'b',path:'tool',content:'#!/usr/bin/python\nprint(1)'}, {id:'c',path:'unknown.xyz',content:'unfamiliar syntax'}, {id:'d',path:'Documentation/index.html',content:'generated'}, {id:'e',path:'Javadoc/files/Old.java.html',content:'legacy'}];
  const plan=core.plan(files,file=>file.language||(file.content.startsWith('#!')?'python':'plaintext'));
  assert.deepEqual(plan.sources.map(s=>s.language),['custom-language','python','auto']);
  assert.equal(plan.sources.length,3);assert.equal(plan.skipped.length,0);
  const request=core.request(plan.sources[0],{model:'gpt-6.1-sol'});
  assert.equal(JSON.parse(request.input[0].content).language,'custom-language');
  assert.match(request.instructions,/Support any programming language/);assert.match(request.instructions,/sections dynamically/);
});

test('mixed-language projects render sections specific to code, stylesheets, markup, SQL and configuration',async()=>{
  const h=setup();
  const samples=[['src/math.py','def add(a, b):\n    return a + b','Python','Functions'],['src/math.ts','export const add = (a: number, b: number) => a + b','TypeScript','Types'],['src/lib.rs','pub fn add(a: i32, b: i32) -> i32 { a + b }','Rust','Ownership'],['style.css','.card { color: red; }','CSS','Selectors'],['index.html','<script>function add(a, b) { return a + b; }</script>','HTML / JavaScript','Elements and scripts'],['query.sql','SELECT name FROM users;','SQL','Queries'],['settings.toml','enabled = true','TOML','Configuration'],['README.md','# Sample','Markdown','Topics'],['custom.xyz','an unfamiliar format','Custom','Contents']];
  h.run('files='+JSON.stringify(samples.map(([path,content],id)=>({id:String(id),path,content,saved:content,history:[]}))));
  const requests=[];
  h.context.fetch=async(url,args)=>{
    const payload=JSON.parse(args.body),input=JSON.parse(payload.input[0].content);requests.push(input);
    const sample=samples.find(s=>s[0]===input.path),data={...doc,language:sample[2],summary:sample[2]+' file',sections:[{title:sample[3],content:'Purpose',items:['Details']}],members:[]};
    return new Response([{type:'response.output_text.delta',delta:JSON.stringify(data)},{type:'response.completed'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  };
  const result=await h.run('generateDocumentation(documentationCore.plan(files,languageFor),()=>{})');
  assert.equal(result.completed.length,samples.length);assert.equal(result.skipped.length,0);
  assert.deepEqual(requests.map(r=>r.language),['python','typescript','rust','css','html','sql','toml','markdown','auto']);
  for(const [path,source,language,heading] of samples){
    const html=h.run(`files.find(f=>f.path===${JSON.stringify(core.outputPath(path))}).content`);
    assert(html.includes('<h2>'+heading+'</h2>'));assert(html.includes('<p>'+language+'</p>'));assert.doesNotMatch(html,/Javadoc|<h3>Parameters/);
    assert.equal(h.run(`files.find(f=>f.path===${JSON.stringify(path)}).content`),source);
  }
});

test('Tools and command palette open the documentation dialog with an explicit source-comments choice',()=>{
  const h=setup();h.run("files.push({id:'b',path:'custom.xyz',content:'text',saved:'text'});runAction('documentation')");
  const html=h.elements.get('#modal-content').innerHTML;
  assert.match(html,/Generate Project Documentation/);assert.match(html,/Also add documentation comments inside source files\?/);
  assert.match(html,/option value="no"/);assert.match(html,/option value="yes"/);assert.match(html,/Auto detect from source/);
  assert.equal(h.run("commands.some(c=>c[0]==='Generate Project Documentation'&&c[1]==='documentation')"),true);
});

test('source comments preserve code, indentation and line endings across comment syntaxes',()=>{
  for(const [style,before,lines,expected] of [
    ['#','    def add(a, b):\r\n        return a + b',['Calcule la somme de a et b.'],'    # Calcule la somme de a et b.\r\n'],
    ['/** */','export function add(a, b) { return a + b; }',['Returns the sum.','a and b: input numbers.'],'/**\n * Returns the sum.\n * a and b: input numbers.\n */\n'],
    ['--','CREATE FUNCTION add_numbers(a INT, b INT)',['Returns the sum.'],'-- Returns the sum.\n'],
    ['(* *)','let add a b = a + b',['Adds two values.'],'(*\n Adds two values.\n*)\n'],
    ['<!-- -->','<template>',['Main template.'],'<!--\n Main template.\n-->\n']
  ]){
    const result=core.addComments(before,[{before,style,lines}]);
    assert.equal(result.content,expected+before);assert.equal(result.added,1);
    assert.equal(core.addComments(result.content,[{before,style,lines}]).added,0);
  }
  const source='function first() {}\n\nfunction second() {}',comments=source.split('\n\n').map(before=>({before,style:'//',lines:['Describes this function.']}));
  assert.equal(core.addComments(source,comments).content,'// Describes this function.\nfunction first() {}\n\n// Describes this function.\nfunction second() {}');
});

test('unsafe, ambiguous and overlapping comment insertions are rejected without changing source',()=>{
  const before='function add() {}',comment={before,style:'/** */',lines:['Returns a value.']};
  for(const source of ['',before+'\n'+before,'prefix '+before])assert.throws(()=>core.addComments(source,[comment]),/anchor/);
  assert.throws(()=>core.addComments(before,[comment,comment]),/overlap/);
  for(const lines of [['Escapes */ code'],['Nested /* comment'],['Continues \\']])assert.throws(()=>core.addComments(before,[{...comment,lines}]),/delimiter|continuation/);
  for(const change of [{style:'executable code'},{lines:['text\nfunction injected() {}']},{lines:['text\u2028injected()']},{lines:[]}])assert.throws(()=>core.parse(JSON.stringify({...doc,comments:[{...comment,...change}]})),/invalid documentation comments/);
  assert.equal(core.addComments('/** Existing documentation. */\n'+before,[comment]).added,0);
});

test('choosing No keeps source unchanged even when a response includes comment suggestions',async()=>{
  const h=setup();stream(h,{...doc,comments:[{before:'class Main {}',style:'//',lines:['A comment.']}]});
  const result=await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  assert.equal(h.run('files[0].content'),'class Main {}');assert.equal(result.commentsAdded,0);
});

test('choosing Yes requests localized comments and inserts them as one undoable source edit',async()=>{
  const h=setup(),before='def add(a, b):\n    return a + b';
  h.run(`files[0].path='math.py';files[0].content=${JSON.stringify(before)};files[0].saved=files[0].content;prefs.locale='fr-CA';var edits=0,undoBoundaries=0;models.set('a',{getValue:()=>files[0].content,isDisposed:()=>false,getFullModelRange:()=>({}),pushStackElement:()=>undoBoundaries++,pushEditOperations:(_,operations)=>{edits++;files[0].content=operations[0].text;}});showProjectDocumentation();$('#documentation-comments').value='yes'`);
  const comment={before,style:'#',lines:['Calcule la somme de a et b.']},requests=[];
  stream(h,{...doc,language:'Python',comments:[comment]});const fetch=h.context.fetch;
  h.context.fetch=async(url,args)=>{requests.push(JSON.parse(args.body));h.run("prefs.locale='en'");return fetch();};
  await h.run("$('#documentation-start').onclick()");
  assert.match(requests[0].instructions,/Add documentation comments above functions/);assert.match(requests[0].instructions,/French \(Canada\)/);
  assert.equal(JSON.parse(requests[0].input[0].content).language,'python');
  assert.equal(h.run('files[0].content'),'# Calcule la somme de a et b.\n'+before);
  assert.equal(h.run('files[0].saved'),before);assert.equal(h.run('files[0].aiPendingSave'),true);
  assert.equal(h.run('edits'),1);assert.equal(h.run('undoBoundaries'),2);
  assert.match(h.elements.get('#documentation-status').textContent,/Added 1 documentation comments/);
  assert.equal(h.elements.get('#documentation-comments').disabled,false);
});

test('a bad comment anchor or source disk conflict preserves source and still produces HTML with an explanation',async()=>{
  for(const conflict of [false,true]){
    const h=setup();if(conflict)h.run('files[0].diskConflict={message:"Changed on disk"}');
    stream(h,{...doc,comments:[{before:conflict?'class Main {}':'missing declaration',style:'//',lines:['Description.']}]});
    const result=await h.run('generateDocumentation(documentationCore.plan(files),()=>{},chat.epoch,{includeComments:true})');
    assert.equal(result.completed.length,1);assert.equal(result.commentsAdded,0);assert.equal(result.skipped.length,1);
    assert.equal(h.run('files[0].content'),'class Main {}');
    assert.match(h.run("files.find(f=>f.path==='Documentation/index.html').content"),/Documentation comments were not added/);
  }
});

test('source edits during an HTML disk write cannot be overwritten by generated comments',async()=>{
  const h=setup(async(command,args)=>{
    if(command==='agent_respond')for(const event of [{type:'response.output_text.delta',delta:JSON.stringify({...doc,comments:[{before:'class Main {}',style:'//',lines:['Description.']}]})},{type:'response.completed'}])listener({payload:{id:args.id,chunk:Array.from(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'))}});
    if(command==='save_document'){
      if(args.path.endsWith('Main.java.html'))h.run("files[0].content='newer source'");
      return {absolutePath:args.path,content:args.content,version:'v1'};
    }
  });
  let listener;h.context.window.__TAURI__.event.listen=async(name,callback)=>{listener=callback;return ()=>{};};
  const result=await h.run('generateDocumentation(documentationCore.plan(files),()=>{},chat.epoch,{includeComments:true})');
  assert.equal(h.run('files[0].content'),'newer source');assert.equal(result.commentsAdded,0);
  assert.equal(result.completed.length,1);assert.match(result.skipped[0].reason,/Source changed/);
});

test('new dialog text, completion messages and comment failures follow French language settings',()=>{
  const h=setup();h.run(fs.readFileSync('dist/i18n.js','utf8'));h.run("window.BlueGayI18n.setLocale('fr-CA')");
  for(const label of ['Generate Project Documentation','Also add documentation comments inside source files?','No — generate HTML only','Yes — add comments above functions','Comments follow your interface language and each file’s comment syntax. They are added as undoable source edits. Save source files to write them to disk.'])assert.notEqual(h.run(`window.BlueGayI18n.translate(${JSON.stringify(label)})`),label);
  assert.match(h.run("window.BlueGayI18n.translate('Generated 2/2 HTML pages in Documentation. 0 skipped or failed; see Documentation/index.html for details. Added 3 documentation comments. Save source files to write them to disk.',true)"),/3 commentaires de documentation ajoutés/);
  assert.match(core.indexPage('Projet',[],[{path:'math.py',reason:'Documentation comments were not added: Source changed during the request; generate again.'}],'fr-CA'),/Les commentaires de documentation n’ont pas été ajoutés : Le code source a changé/);
});
test('HTML escapes all model content, renders dynamic sections and valid relative links',()=>{
  const malicious={...doc,language:'<img src=x>',summary:'<script>alert(1)</script>',sections:[{title:'<script>heading</script>',content:'<svg onload=alert(1)>',items:['<img src=x>']}],notes:['<img src=x onerror=alert(1)>']};
  const html=core.documentPage({path:'src/Main.java'},malicious);
  assert.match(html,/href="\.\.\/\.\.\/index.html"/);assert.match(html,/Parameters/);assert.match(html,/Returns/);assert.match(html,/Exceptions/);
  assert.doesNotMatch(html,/<script|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Content-Security-Policy/);
  assert.match(core.indexPage('Sample',[{path:'src/A #.java'}],[]),/href="files\/src\/A%20%23.java.html"/);
});
test('invalid and truncated documentation never becomes a page',()=>{
  for(const raw of ['{}','{"summary":','null',JSON.stringify({...doc,members:[{name:'bad'}]}),JSON.stringify({...doc,sections:[{title:'Invalid',items:[]}]}),JSON.stringify({...doc,members:[{...doc.members[0],sections:[{title:4}]}]})])assert.throws(()=>core.parse(raw),/invalid|incomplete/);
  assert.deepEqual(core.parse(JSON.stringify(doc)),doc);
});
test('French requests translate prose while preserving code; rendered pages and index use French',()=>{
  const request=core.request({path:'Main.java',content:'class Main {}'},{model:'gpt-6.1-sol',locale:'fr-CA'});
  assert.match(request.instructions,/French \(Canada\)/);assert.match(request.instructions,/Preserve source identifiers/);
  const frenchDoc={...doc,members:[{...doc.members[0],sections:doc.members[0].sections.map((s,i)=>({...s,title:['Paramètres','Valeur de retour','Exceptions'][i]}))}]};
  const html=core.documentPage({path:'src/Main.java'},frenchDoc,'fr-CA');
  for(const text of ['lang="fr-CA"','Paramètres','Valeur de retour','Exceptions','Index de la documentation','public int add(int n)'])assert(html.includes(text),text);
  const index=core.indexPage('Projet',[{path:'Main.java'}],[{path:'empty.txt',reason:'Empty file'}],'fr-CA');
  for(const text of ['lang="fr-CA"','Fichiers','fichiers documentés','Fichier vide'])assert(index.includes(text),text);
  assert.match(core.request({path:'a',content:'text'},{model:'gpt-6.1-sol',locale:'en'}).instructions,/in English/);
});
test('generation captures the interface language for requests and all HTML output',async()=>{
  const h=setup();stream(h);h.run("prefs.locale='fr-CA'");const requests=[],fetch=h.context.fetch;
  h.context.fetch=async(url,args)=>{requests.push(JSON.parse(args.body));h.run("prefs.locale='en'");return fetch();};
  await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  assert.match(requests[0].instructions,/French \(Canada\)/);
  assert.equal(h.run(`files.filter(f=>f.path.startsWith('Documentation/')).every(f=>f.content.includes('lang="fr-CA"'))`),true);
});
test('browser generation uses current source and selected model, saves HTML and index without editing source',async()=>{
  const h=setup();const requests=[];stream(h);const fetch=h.context.fetch;
  h.context.fetch=async(url,args)=>{requests.push(JSON.parse(args.body));return fetch();};
  await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  assert.equal(requests.length,1);assert.equal(requests[0].model,'gpt-6.1-sol');assert.match(requests[0].input[0].content,/class Main/);
  assert.equal(h.run('files[0].content'),'class Main {}');assert.equal(h.run('files.length'),3);
  assert.match(h.run("files.find(f=>f.path==='Documentation/index.html').content"),/src\/Main.java.html/);
  assert.equal(h.run('chat.request'),null);assert.equal(h.run('documentationJob'),null);
});
test('native generation creates folder and writes with conflict protection through existing transport',async()=>{
  const calls=[];let listener;const h=setup(async(command,args)=>{
    calls.push({command,args});
    if(command==='agent_respond')for(const e of [{type:'response.output_text.delta',delta:JSON.stringify(doc)},{type:'response.completed'}])listener({payload:{id:args.id,chunk:Array.from(new TextEncoder().encode('data: '+JSON.stringify(e)+'\n\n'))}});
    if(command==='save_document')return {absolutePath:args.path,content:args.content,version:'v1'};
  });
  h.context.window.__TAURI__.event.listen=async(name,cb)=>{listener=cb;return ()=>{};};
  h.run(`chatSettings.provider='chatgpt';window.BlueGayAccount={state:{activeId:'account'}};validateChatModel=()=>{};`);
  await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  assert.equal(calls[0].command,'create_folder');
  assert.equal(calls.find(c=>c.command==='agent_respond').args.payload.auth_provider,'chatgpt');
  assert.equal(calls.find(c=>c.command==='agent_respond').args.payload.account_id,'account');
  const writes=calls.filter(c=>c.command==='save_document');assert.equal(writes.length,2);
  assert.equal(writes[0].args.path,'C:/sample/Documentation/files/src/Main.java.html');assert.equal(writes[0].args.expectedVersion,null);
});
test('regeneration replaces clean generated pages but refuses user files and dirty pages',async()=>{
  const h=setup();stream(h);await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');assert.equal(h.run('files.length'),3);
  h.run("files[1].content='user edit'");await assert.rejects(h.run('generateDocumentation(documentationCore.plan(files),()=>{})'),/will not be overwritten/);
  assert.equal(h.run('files[1].content'),'user edit');
});
test('case-insensitive collisions are rejected before any AI request',async()=>{
  const h=setup();h.run("files.push({id:'b',path:'documentation',content:'mine',saved:'mine'})");
  h.context.fetch=()=>{throw Error('Must not send');};
  await assert.rejects(h.run('generateDocumentation(documentationCore.plan(files),()=>{})'),/conflicts/);
});
test('incomplete stream reports failure in index and never saves an incomplete page',async()=>{
  const h=setup();stream(h,doc,null);const result=await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  assert.equal(result.completed.length,0);assert.equal(result.skipped.length,1);assert.equal(h.run('files.length'),2);
  assert.match(h.run('files[1].content'),/connection ended/);
});
test('source edits during streaming are preserved and reported',async()=>{
  const h=setup();stream(h);const fetch=h.context.fetch;
  h.context.fetch=async()=>{h.run("files[0].content='class Changed {}'");return fetch();};
  const result=await h.run('generateDocumentation(documentationCore.plan(files),()=>{})');
  assert.equal(result.completed.length,0);assert.match(result.skipped[0].reason,/changed/);assert.equal(h.run('files[0].content'),'class Changed {}');
});
test('cancellation and workspace switches prevent output from entering another workspace',async()=>{
  for(const change of ['chat.request.stopped=true','chat.epoch++;files=[];nativeRoot=null']){
    const h=setup();stream(h);const fetch=h.context.fetch;h.context.fetch=async()=>{h.run(change);return fetch();};
    await assert.rejects(h.run('generateDocumentation(documentationCore.plan(files),()=>{})'),/stopped/);
    assert.equal(h.run("files.some(f=>f.path.endsWith('.html'))"),false);assert.equal(h.run('chat.request'),null);
  }
});
test('concurrent chats and disconnected accounts do not start generation',async()=>{
  const h=setup();h.run('chat.request={}');await assert.rejects(h.run('generateDocumentation(documentationCore.plan(files),()=>{})'),/running/);
  h.run('chat.request=null;refreshChatStatus=async()=>({configured:false})');await assert.rejects(h.run('generateDocumentation(documentationCore.plan(files),()=>{})'),/Connect ChatLGBT/);
  assert.equal(h.run('files.length'),1);assert.equal(h.run('chat.request'),null);
});
