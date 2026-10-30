const {test}=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./ui-harness.cjs');
const doc={absolutePath:'C:/Users/example/Desktop/notes.txt',path:'notes.txt',content:'original',version:'v1'};

test('native OS drop retains the original path and Ctrl+S writes there without Save As',async()=>{
  const calls=[];
  const h=harness(async(command,args)=>{
    calls.push({command,args});
    if(command==='open_dropped_paths')return {kind:'files',data:[doc]};
    if(command==='save_document')return {...doc,content:args.content,version:'v2'};
  });
  await h.run('initializeDesktop()');
  h.run('files=[];tabs=[];prefs.trimWhitespace=false;prefs.insertFinalNewline=false');
  h.events['bluegay-files-dropped']({payload:'native-ticket'});
  await h.run('nativeDropQueue');
  assert.equal(h.run('files[0].disk.path'),doc.absolutePath);
  h.run('files[0].content="changed"');
  assert.equal(await h.run('saveFile(files[0],true)'),true);
  const saved=calls.find(c=>c.command==='save_document');
  assert.equal(saved.args.path,doc.absolutePath);
  assert.equal(saved.args.expectedVersion,'v1');
  assert.ok(!calls.some(c=>c.command==='save_document_as'));
});

test('dropping an already open file preserves unsaved edits and deduplicates paths',()=>{
  const h=harness(async()=>{});h.context.doc=doc;
  h.run('files=[];installNativeDocuments([doc]);files[0].content="unsaved";installNativeDocuments([{...doc,absolutePath:doc.absolutePath.toUpperCase()}])');
  assert.equal(h.run('files.length'),1);
  assert.equal(h.run('files[0].content'),'unsaved');
});

test('Open anyway bypasses the default cap and retains the override for saving and refresh',async()=>{
  const calls=[];
  const h=harness(async(command,args)=>{calls.push({command,args});return {...doc,content:args.content||'large text',version:command==='save_document'?'v2':'v1',forceOpen:true};});
  h.context.doc={...doc,content:'',unsupported:'This file exceeds 50 MB.'};
  h.run('files=[nativeFile(doc)];nativeReady=true;warnUnsupported(files[0])');
  assert.match(h.elements.get('#modal-content').innerHTML,/Open anyway/);
  await h.elements.get('#open-anyway').onclick();
  assert.equal(h.run('activeId'),h.run('files[0].id'));
  assert.equal(h.run('files[0].forceOpen'),true);
  assert.equal(h.run('files[0].baseline'),'large text');
  h.run('files[0].content="new large text"');
  assert.equal(await h.run('saveFile(files[0])'),true);
  await h.run('inspectNativeFiles()');
  assert.ok(calls.every(c=>c.args.forceOpen===true));
  assert.ok(calls.some(c=>c.command==='save_document'));
});

test('binary Open anyway creates a readonly preview and never saves its text representation',async()=>{
  const calls=[];
  const h=harness(async(command,args)=>{calls.push(command);return {...doc,content:'Read-only binary preview',unsupported:'Binary preview',forceOpen:true,previewOnly:true};});
  h.context.doc={...doc,unsupported:'Binary',content:''};
  h.run('files=[nativeFile(doc)];nativeReady=true');
  await h.run('openUnsupportedAnyway(files[0])');
  assert.equal(h.run('editorOptions().readOnly'),true);
  assert.equal(await h.run('saveFile(files[0])'),false);
  assert.deepEqual(calls,['read_document']);
});

test('browser imports accept 50 MB and retain oversized sources for an explicit override',async()=>{
  const h=harness();h.context.TextDecoder=TextDecoder;
  let reads=0;
  h.context.input={name:'large.txt',size:50*1024*1024,arrayBuffer:async()=>{reads++;return Buffer.from('hello');}};
  h.run('files=[]');
  await h.run('importBrowserFiles([input])');
  assert.equal(h.run('files[0].unsupported'),null);
  assert.equal(reads,1);
  h.context.input={name:'larger.txt',size:50*1024*1024+1,arrayBuffer:async()=>{reads++;return Buffer.from('oversized text');}};
  await h.run('importBrowserFiles([input])');
  assert.equal(reads,1);
  assert.ok(h.run('files[1].unsupported'));
  await h.run('openUnsupportedAnyway(files[1])');
  assert.equal(reads,2);
  assert.equal(h.run('files[1].content'),'oversized text');
  assert.equal(h.run('files[1].unsupported'),null);
});

test('a failed override leaves the existing document and disk version intact',async()=>{
  const h=harness(async()=>{throw {code:'permission',message:'No access'};});h.context.doc={...doc,unsupported:'Blocked',content:''};
  h.run('files=[nativeFile(doc)]');
  await h.run('openUnsupportedAnyway(files[0])');
  assert.equal(h.run('files[0].disk.version'),'v1');
  assert.equal(h.run('files[0].unsupported'),'Blocked');
});

test('growing a file past the cap offers an explicit save override',async()=>{
  const calls=[];
  const h=harness(async(command,args)=>{calls.push({command,args});if(!args.forceOpen)throw {code:'size',message:'Over 50 MB'};return {...doc,content:args.content,version:'v2',forceOpen:true};});
  h.context.doc=doc;
  h.run('files=[nativeFile(doc)];files[0].content="larger";nativeReady=true;chooseAction=async()=>"save"');
  assert.equal(await h.run('saveNativeFile(files[0])'),true);
  assert.equal(calls.length,2);
  assert.equal(calls[1].args.forceOpen,true);
  assert.equal(calls[1].args.path,doc.absolutePath);
});

test('browser binary override remains a bounded readonly hex preview',async()=>{
  const h=harness();h.context.TextDecoder=TextDecoder;
  h.context.bytes=new Uint8Array(100000).fill(255);
  h.run('files=[];mergeFiles([importedEntry("binary.exe",bytes)])');
  await h.run('openUnsupportedAnyway(files[0])');
  assert.match(h.run('files[0].content'),/65536 of 100000 bytes/);
  assert.equal(h.run('files[0].previewOnly'),true);
  assert.equal(h.run('editorOptions().readOnly'),true);
  assert.equal(await h.run('saveFile(files[0])'),false);
});

