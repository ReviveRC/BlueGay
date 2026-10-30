const {test}=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./ui-harness.cjs');
const createDisk=require('../dist/desktop-io.js');
const core=require('../dist/agent-core.js');
const nativeFile={id:'file',path:'img/photo.png',content:'',saved:'',baseline:'',history:[],unsupported:'Image files cannot be edited.',disk:{path:'C:/project/img/photo.png',version:'v1'}};
const textFile={...nativeFile,path:'src/a.js',unsupported:null,content:'original',saved:'original',baseline:'original',disk:{path:'C:/project/src/a.js',version:'v1'}};

test('reload drops missing clean files from recovery, tabs and folders while discovering images',async()=>{
  const saved={name:'project',nativeRoot:'C:/project',files:[textFile],folders:['src'],tabs:['file'],activeId:'file'};
  const invoke=async command=>{
    if(command==='refresh_workspace')return {files:[{absolutePath:nativeFile.disk.path,path:nativeFile.path,version:'v1',content:'',unsupported:nativeFile.unsupported}],folders:['img'],skipped:0};
    if(command==='read_document')throw {code:'missing',message:'Deleted'};
  };
  // Only a.js is missing; the newly discovered image is still present.
  const h=harness(async(command,args)=>command==='read_document'&&args.path===nativeFile.disk.path?{...nativeFile,absolutePath:args.path,version:'v1'}:invoke(command),{'bluegay.workspace':JSON.stringify(saved)});
  await h.run('initializeDesktop()');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(files.map(f=>f.path))')),['img/photo.png']);
  assert.equal(h.run('tabs.includes("file")'),false);
  assert.equal(h.run('explicitFolders.includes("src")'),false);
  assert.equal(JSON.parse(h.storage.get('bluegay.workspace')).files.some(f=>f.path==='src/a.js'),false);
});

test('a deleted dirty file keeps recovery text and a disk conflict, and cannot autosave',async()=>{
  const h=harness(async()=>{throw {code:'missing',message:'Deleted'};});
  h.context.target={...textFile,content:'unsaved edit'};
  h.run('files=[target];nativeReady=true');
  await h.run('inspectNativeFiles()');
  assert.equal(h.run('files[0].content'),'unsaved edit');
  assert.equal(h.run('files[0].diskConflict.code'),'missing');
  assert.equal(await h.run('saveFile(files[0],false,{automatic:true})'),false);
});

test('stale missing result cannot remove a file saved during inspection',async()=>{
  let rejectRead;
  const disk=createDisk(async command=>command==='read_document'?new Promise((_,reject)=>{rejectRead=reject;}):{absolutePath:textFile.disk.path,version:'v2',content:'edited'});
  const file={...textFile,content:'edited'};
  const pending=disk.inspect(file);
  await disk.save(file);
  rejectRead({code:'missing'});
  assert.equal((await pending).kind,'unchanged');
});

test('folder deletion removes descendants, tabs and empty folders but preserves similarly named siblings',async()=>{
  const calls=[];const h=harness(async(command,args)=>{calls.push({command,args});});
  h.run(`nativeReady=true;nativeRoot='C:/project';files=[];tabs=[];newFile('img/new.js','draft');newFile('images/keep.js','keep');explicitFolders=['img','img/empty','images'];collapsed.add('img/empty');chooseAction=async()=> 'delete'`);
  await h.run("deleteFolder('img')");
  assert.equal(calls[0].command,'trash_folder');assert.equal(calls[0].args.path,'C:/project/img');
  assert.equal(h.run('files.length'),1);assert.equal(h.run('files[0].path'),'images/keep.js');
  assert.equal(h.run('tabs.length'),1);assert.equal(h.run('explicitFolders.join(",")'),'images');
  assert.equal(h.run('collapsed.has("img/empty")'),false);
  assert.equal(JSON.parse(h.storage.get('bluegay.workspace')).files.length,1);
});

test('cancelled or failed folder deletion preserves all workspace data',async()=>{
  let calls=0;const h=harness(async()=>{calls++;throw {message:'Locked folder'};});
  h.run("nativeReady=true;nativeRoot='C:/project';newFile('src/a.js','draft');explicitFolders=['src'];chooseAction=async()=> 'cancel'");
  await h.run("deleteFolder('src')");assert.equal(calls,0);assert.equal(h.run('files.length'),1);
  h.run("chooseAction=async()=> 'delete'");await h.run("deleteFolder('src')");
  assert.equal(calls,1);assert.equal(h.run('files.length'),1);assert.equal(h.run('nativePaused'),false);
});

test('unsupported file deletion uses its disk version and only removes it after success',async()=>{
  const calls=[];const h=harness(async(command,args)=>{calls.push({command,args});});h.context.target=structuredClone(nativeFile);
  h.run("files=[target];nativeReady=true;chooseAction=async()=> 'delete'");
  await h.run('nativeDeleteFile(files[0])');
  assert.equal(calls[0].command,'trash_document');assert.equal(calls[0].args.expectedVersion,'v1');assert.equal(h.run('files.length'),0);
});

test('Delete targets the selected Explorer file or folder, never editor text or a dialog',()=>{
  const h=harness();h.run("window.removed=[];deleteFile=f=>window.removed.push(f.path);deleteFolder=p=>window.removed.push(p)");
  const path=h.run('files[0].path'),id=h.run('files[0].id');
  const event=(row,extra={})=>({key:'Delete',target:{closest:()=>row},preventDefault(){},stopPropagation(){},...extra});
  h.events.keydown(event({dataset:{file:id}}));h.events.keydown(event({dataset:{folder:'img'}}));
  h.events.keydown(event(null));h.events.keydown(event({dataset:{file:id}},{ctrlKey:true}));
  h.elements.get('#modal').open=true;h.events.keydown(event({dataset:{file:id}}));
  assert.deepEqual(Array.from(h.context.window.removed),[path,'img']);
});

test('unsupported entries are visible, warn on open, and cannot become text models or be saved',async()=>{
  const h=harness();h.context.target=structuredClone(nativeFile);
  h.run('files.push(target);window.previous=activeId;switchTab(target.id)');
  assert.equal(h.run('activeId'),h.context.window.previous);
  assert.equal(h.elements.get('#modal').open,true);
  assert.match(h.elements.get('#sidebar-content').innerHTML,/photo.png/);
  assert.equal(h.run('modelFor(target)'),null);
  assert.equal(await h.run('saveFile(target)'),false);
  const disk=createDisk(()=>{throw Error('Must not write binary data');});
  assert.equal(await disk.save(nativeFile,{saveAs:true}),false);
  assert.throws(()=>core.snapshot(nativeFile),/cannot be edited/);
  assert.throws(()=>core.validateCurrent([{id:'file',path:nativeFile.path,before:'',after:'oops'}],[nativeFile]),/cannot be edited/);
});

test('browser imports retain binary, GIF, large and dependency entries as appropriate',async()=>{
  const h=harness();h.context.TextDecoder=TextDecoder;
  h.context.imports=[
    {name:'photo.png',size:4,arrayBuffer:async()=>Uint8Array.of(137,80,0,71).buffer},
    {name:'animation.gif',size:6,arrayBuffer:async()=>Buffer.from('GIF89a')},
    {name:'huge.log',size:51*1024*1024,arrayBuffer:async()=>{throw Error('Should not read huge file');}},
    {name:'hello.py',size:8,arrayBuffer:async()=>Buffer.from('print(1)')}
  ];
  await h.run('files=[];tabs=[];activeId=null;importBrowserFiles(imports)');
  assert.equal(h.run('files.length'),4);assert.equal(h.run('files.filter(f=>f.unsupported).length'),3);
  assert.equal(h.run('files.find(f=>f.path==="hello.py").content'),'print(1)');
  assert.equal(h.run('files.some(fileDirty)'),false);
});

test('binary entries block incomplete ZIP exports and never enter text write-back',async()=>{
  const h=harness();h.context.target=structuredClone(nativeFile);h.run('files=[target];window.notice="";toast=text=>window.notice=text');
  await h.run('exportZip()');assert.match(h.context.window.notice,/non-text files/);
  h.context.window.showDirectoryPicker=async()=>({name:'folder',getFileHandle(){throw Error('Must not overwrite binary');}});
  h.run('confirmAction=(title,body,action)=>{window.written=action()}');await h.run('writeBack()');await h.context.window.written;
  assert.match(h.context.window.notice,/Wrote 0 files/);
});

test('browser deletion remains deleted after reloading persisted workspace',()=>{
  const h=harness();h.run('prefs.confirmDelete=false;deleteFile(files[0])');
  const reloaded=harness(undefined,Object.fromEntries(h.storage));
  assert.equal(reloaded.run('files.some(f=>f.path==="src/index.ts")'),false);
});

test('renaming an unsupported file does not create a text model or access an absent split editor',()=>{
  const h=harness();h.context.target=structuredClone(nativeFile);
  h.context.monaco={languages:{getLanguages:()=>[]},editor:{createModel(){throw Error('Unexpected text model');}}};
  h.run('files.push(target);monacoReady=true;promptValue=(title,help,path,done)=>done("img/renamed.png");renameFile(target)');
  assert.equal(h.run('target.path'),'img/renamed.png');
  assert.equal(h.run('models.has(target.id)'),false);
});
