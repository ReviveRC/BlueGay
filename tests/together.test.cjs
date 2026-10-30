const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const harness=require('./ui-harness.cjs');
function setup(invoke=async()=>{}){
  const h=harness(invoke);
  h.run(fs.readFileSync('dist/together.js','utf8'));
  h.run(`nativeReady=true;nativeRoot='together';together.mode='guest';together.connected=true;together.permissions={write:true,createDelete:true};files=[{id:'one',path:'a.js',content:'old',saved:'old',baseline:'old',history:[],disk:{path:'together/a.js',version:'v1'}}];tabs=['one'];activeId='one';`);
  return h;
}
const snapshot=(content='remote',version='v2')=>({workspace:{root:'together',name:'Shared',files:[{path:'a.js',absolutePath:'together/a.js',content,version}],folders:[],skipped:0},permissions:{write:true,createDelete:true},presence:[]});

test('collaboration refresh preserves Open anyway and binary previews remain readonly',async()=>{
  const calls=[];
  const h=setup(async(command,args)=>{
    calls.push({command,args});
    if(command==='together_request')return snapshot('', 'metadata:large');
    if(command==='read_document')return {path:'a.js',absolutePath:'together/a.js',content:'opened text',version:'v2',forceOpen:true};
  });
  h.run('files[0].forceOpen=true');
  await h.run('pollTogether()');
  assert.equal(h.run('files[0].content'),'opened text');
  assert.equal(h.run('files[0].forceOpen'),true);
  assert.ok(calls.some(c=>c.command==='read_document'&&c.args.forceOpen));
  h.run('files[0].previewOnly=true;editor={updateOptions:o=>window.options=o};togetherOptions()');
  assert.equal(h.context.window.options.readOnly,true);
});

test('live snapshots reload clean files but retain overlapping local edits',()=>{
  const h=setup();
  h.context.next=snapshot();h.run('mergeTogetherSnapshot(next)');
  assert.equal(h.run('files[0].content'),'remote');
  h.run("files[0].content='my edit'");h.context.next=snapshot('their edit','v3');h.run('mergeTogetherSnapshot(next)');
  assert.equal(h.run('files[0].content'),'my edit');assert.equal(h.run('files[0].diskConflict.code'),'conflict');
});
test('remote file deletion preserves dirty text and removes clean files',()=>{
  const h=setup();h.context.next={...snapshot(),workspace:{...snapshot().workspace,files:[]}};
  h.run("files[0].content='unsaved';mergeTogetherSnapshot(next)");assert.equal(h.run('files.length'),1);assert.equal(h.run('files[0].diskConflict.code'),'missing');
  h.run("files[0].content=files[0].saved;mergeTogetherSnapshot(next)");assert.equal(h.run('files.length'),0);
});
test('remote persistence does not replace the local project recovery snapshot or store the invite code',()=>{
  const h=setup();h.storage.set('bluegay.workspace','local project');h.run("together.code='secret-invite';persist()");
  assert.equal(h.storage.get('bluegay.workspace'),'local project');assert.ok(h.storage.get('bluegay.togetherRecovery').includes('a.js'));assert.ok(!h.storage.get('bluegay.togetherRecovery').includes('secret-invite'));
});
test('read only and create/delete restrictions block UI and disk mutations',async()=>{
  const calls=[];const h=setup(async(c,a)=>{calls.push([c,a]);});h.run('disk.setTransport(togetherTransport);together.permissions={write:false,createDelete:false}');
  assert.equal(await h.run('saveFile(files[0])'),false);h.run("newFile('new.txt')");assert.equal(h.run('files.length'),1);
  await assert.rejects(h.run("disk.call('save_document',{path:'together/a.js',content:'x',expectedVersion:'v1'})"));assert.equal(calls.length,0);
  h.run('together.permissions.write=true');await h.run("createNewFolder('new')");assert.equal(calls.length,0);
  await h.run("disk.call('save_document',{path:'together/a.js',content:'x',expectedVersion:'v1'})");assert.equal(calls[0][0],'together_request');assert.equal(calls[0][1].args.path,'a.js');
});
test('a snapshot in flight cannot revert a newer completed save',async()=>{
  let finish;const h=setup(()=>new Promise(resolve=>{finish=resolve;}));
  const polling=h.run('pollTogether()');h.run("files[0].content=files[0].saved='new save';files[0].disk.version='v3'");finish(snapshot('stale','v2'));await polling;
  assert.equal(h.run('files[0].content'),'new save');assert.equal(h.run('files[0].disk.version'),'v3');
});
test('connection failure locks the guest editor and keeps edits for recovery',async()=>{
  const h=setup(async()=>{throw {message:'Host unavailable'};});h.run("files[0].content='unsaved'");await h.run('pollTogether()');assert.equal(h.run('togetherReadOnly()'),true);assert.equal(h.run('files[0].content'),'unsaved');
});
test('leaving restores the previous local workspace and removes the remote transport',async()=>{
  const h=setup();
  h.run(`together.previous=JSON.stringify({name:'Local project',files:[{id:'local',path:'local.txt',content:'local work',saved:'local work',history:[]}],folders:[],tabs:['local'],activeId:'local',nativeRoot:null});disk.setTransport(togetherTransport);`);
  assert.equal(await h.run('leaveTogether()'),true);
  assert.equal(h.run('together.mode'),null);assert.equal(h.run('currentFile().content'),'local work');assert.equal(h.run('projectName'),'Local project');
});
test('recovery opens remote edits as local drafts without remote disk credentials',async()=>{
  const h=setup();h.run("persist();together.mode=null;files=[]");await h.run('recoverTogether()');
  assert.equal(h.run('files[0].content'),'old');assert.equal(h.run('files[0].disk'),null);assert.equal(h.run('files[0].isDraft'),true);assert.equal(h.run('nativeRoot'),null);
});
test('revoking write permission immediately locks both editor panes',()=>{
  const h=setup();h.context.options=[];h.run('editor={updateOptions:o=>options.push(o)};splitEditor={updateOptions:o=>options.push(o)};together.permissions.write=false;togetherOptions()');
  assert.equal(h.context.options.length,2);assert.ok(h.context.options.every(o=>o.readOnly));
});
test('collaborator icons and cursor decorations point at the collaborator file and position',()=>{
  const h=setup();const decorations=[];
  h.context.decorationResults=decorations;
  h.run(`monacoReady=true;monaco={Range:class {constructor(a,b,c,d){Object.assign(this,{startLineNumber:a,startColumn:b,endLineNumber:c,endColumn:d});}},editor:{TrackedRangeStickiness:{NeverGrowsWhenTypingAtEdges:1}}};models.set('one',{validatePosition:p=>p,deltaDecorations:(old,next)=>{decorationResults.push(next);return ['cursor'];}});together.members=[{id:'peer',name:'Alex',path:'a.js',line:3,column:7,color:2}];renderTogetherPresence();`);
  assert.equal(decorations[0][0].range.startLineNumber,3);assert.equal(decorations[0][0].range.startColumn,7);assert.equal(decorations[0][0].options.before.content,' Alex ');assert.match(h.elements.get('#together-presence').innerHTML,/Follow Alex in a.js/);
});
