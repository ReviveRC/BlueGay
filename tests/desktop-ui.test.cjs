const {test}=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./ui-harness.cjs');
test('desktop startup opens an empty workspace and arms close handling after the listener',async()=>{
  const calls=[];const h=harness(async(command)=>{calls.push(command);});
  await h.run('initializeDesktop()');
  assert.equal(h.run('files.length'),0);assert.equal(h.run('nativeReady'),true);
  assert.equal(typeof h.events['bluegay-close-requested'],'function');
  assert(calls.includes('enable_close_guard'));
});
test('new file in an open native folder saves to its real path through the UI save action',async()=>{
  const calls=[];const h=harness(async(command,args)=>{calls.push({command,args});return {absolutePath:args?.path,content:args?.content,version:'v1'};});
  await h.run('initializeDesktop()');h.run("nativeRoot='C:/project';newFile('src/example.js','const x = 1;')");
  assert.equal(h.run('fileDirty(currentFile())'),true);
  await h.run('saveFile(currentFile(),true)');
  const save=calls.find(call=>call.command==='save_document');
  assert.equal(save.args.path,'C:/project/src/example.js');assert.equal(save.args.expectedVersion,null);assert.equal(save.args.content,'const x = 1;\n');
  assert.equal(h.run('fileDirty(currentFile())'),false);
});
test('cancelled tab close preserves a dirty file and its tab',async()=>{
  const h=harness(async()=>{});await h.run('initializeDesktop()');h.run("newFile('draft.py','print(1)');chooseAction=async()=> 'cancel'");
  await h.run('closeTab(activeId)');assert.equal(h.run('files.length'),1);assert.equal(h.run('tabs.length'),1);
});
test('discarding a draft removes recovery data and does not write to disk',async()=>{
  const calls=[];const h=harness(async(command)=>{calls.push(command);});await h.run('initializeDesktop()');
  h.run("newFile('draft.py','print(1)');chooseAction=async()=> 'discard'");
  await h.run('closeTab(activeId)');assert.equal(h.run('files.length'),0);assert(!calls.includes('save_document_as'));
  assert.equal(JSON.parse(h.storage.get('bluegay.workspace')).files.length,0);
});
test('failed save blocks closing rather than discarding edits',async()=>{
  const h=harness(async command=>{if(command==='save_document')throw {code:'io',message:'Disk full'};});await h.run('initializeDesktop()');
  h.run("nativeRoot='C:/project';newFile('draft.py','print(1)');chooseAction=async()=> 'save'");
  await h.run('closeTab(activeId)');assert.equal(h.run('files.length'),1);assert.equal(h.run('tabs.length'),1);assert.equal(h.run('fileDirty(currentFile())'),true);
});
test('save all waits for disk writes before reporting success',async()=>{
  const calls=[];const h=harness(async(command,args)=>{calls.push(command);if(command==='save_document')return {absolutePath:args.path,content:args.content,version:'v1'};});
  await h.run('initializeDesktop()');h.run("nativeRoot='C:/project';newFile('a.js','a');newFile('b.py','b')");
  assert.equal(await h.run('saveAllFiles()'),true);assert.equal(calls.filter(c=>c==='save_document').length,2);assert.equal(h.run('files.some(fileDirty)'),false);
});
test('window close cancellation does not invoke native close',async()=>{
  const calls=[];const h=harness(async(command)=>{calls.push(command);});await h.run('initializeDesktop()');
  h.run("newFile('draft.py','print(1)');chooseAction=async()=> 'cancel'");
  await h.events['bluegay-close-requested']();assert(!calls.includes('finish_close'));
});

test('discarding a new file in an open folder removes the draft without creating it',async()=>{
  const calls=[];const h=harness(async(command)=>{calls.push(command);});await h.run('initializeDesktop()');
  h.run("nativeRoot='C:/project';newFile('not-created.py','draft');chooseAction=async()=> 'discard'");
  await h.run('closeTab(activeId)');assert.equal(h.run('files.length'),0);
  assert(!calls.includes('save_document'));assert(!calls.includes('trash_document'));
});

test('deleting a new unsaved file does not send a null version to the native trash command',async()=>{
  const calls=[];const h=harness(async(command)=>{calls.push(command);});await h.run('initializeDesktop()');
  h.run("nativeRoot='C:/project';newFile('not-created.py','draft');chooseAction=async()=> 'delete'");
  await h.run('nativeDeleteFile(currentFile())');assert.equal(h.run('files.length'),0);assert(!calls.includes('trash_document'));
});

test('Close Project cancellation preserves the native root, files and tabs',async()=>{
  const h=harness(async()=>{});await h.run('initializeDesktop()');
  h.run("nativeRoot='C:/project';newFile('draft.py','draft');chooseAction=async()=> 'cancel'");
  assert.equal(await h.run('closeProject()'),false);
  assert.equal(h.run('nativeRoot'),'C:/project');assert.equal(h.run('files.length'),1);assert.equal(h.run('tabs.length'),1);
});

test('Close Project stops when a requested disk save fails',async()=>{
  const h=harness(async command=>{if(command==='save_document')throw {code:'io',message:'Disk full'};});await h.run('initializeDesktop()');
  h.run("nativeRoot='C:/project';newFile('draft.py','draft');chooseAction=async()=> 'save'");
  assert.equal(await h.run('closeProject()'),false);assert.equal(h.run('files.length'),1);
  assert.equal(h.run('fileDirty(currentFile())'),true);
});

test('Close Project saves then releases the workspace without deleting disk files',async()=>{
  const calls=[];const h=harness(async(command,args)=>{calls.push(command);if(command==='save_document')return {absolutePath:args.path,content:args.content,version:'v1'};});
  await h.run('initializeDesktop()');
  h.run("nativeRoot='C:/project';newFile('a.py','draft');explicitFolders=['src'];scratchpad='notes';splitVisible=true;chooseAction=async()=> 'save'");
  assert.equal(await h.run('closeProject()'),true);
  assert(calls.includes('save_document'));assert(!calls.includes('trash_document'));
  assert.equal(h.run('nativeRoot'),null);assert.equal(h.run('files.length'),0);assert.equal(h.run('tabs.length'),0);
  assert.equal(h.run('explicitFolders.length'),0);assert.equal(h.run('scratchpad'),'');assert.equal(h.run('splitVisible'),false);
  assert.equal(JSON.parse(h.storage.get('bluegay.workspace')).files.length,0);
});

test('browser Close Project retains edits and scratchpad, stays closed after reload and can reopen',async()=>{
  const h=harness();h.run("currentFile().content='unsaved work';scratchpad='keep these notes'");
  assert.equal(await h.run('closeProject()'),true);
  const closed=JSON.parse(h.storage.get('bluegay.closedWorkspace'));
  assert.equal(closed.files.find(f=>f.id===closed.activeId).content,'unsaved work');
  const reloaded=harness(undefined,Object.fromEntries(h.storage));
  assert.equal(reloaded.run('files.length'),0);
  reloaded.run('reopenClosedProject()');
  assert.equal(reloaded.run('currentFile().content'),'unsaved work');assert.equal(reloaded.run('scratchpad'),'keep these notes');
});

test('browser Close Project preserves the workspace if recovery storage is full',async()=>{
  const h=harness();h.run("localStorage.setItem=()=>{throw Error('quota');}");
  assert.equal(await h.run('closeProject()'),false);assert(h.run('files.length')>0);
});
