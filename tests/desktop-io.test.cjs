const {test}=require('node:test');
const assert=require('node:assert/strict');
const createDisk=require('../dist/desktop-io.js');
const file=()=>({id:'1',path:'src/main.js',content:'new text',saved:'old text',history:[],disk:{path:'C:/project/src/main.js',version:'v1'}});
const document=(content='new text',version='v2')=>({absolutePath:'C:/project/src/main.js',content,version,path:'main.js'});

test('Ctrl+S transport writes the original path with the expected disk version',async()=>{
  const calls=[];
  const disk=createDisk(async(command,args)=>{calls.push({command,args});return document();});
  const f=file();assert.equal(await disk.save(f),true);
  assert.deepEqual(calls,[{command:'save_document',args:{path:'C:/project/src/main.js',content:'new text',expectedVersion:'v1'}}]);
  assert.equal(f.saved,'new text');assert.equal(f.disk.version,'v2');assert.equal(f.history[0].content,'old text');
});

test('failed disk write keeps the file dirty and never reports it as saved',async()=>{
  const disk=createDisk(async()=>{throw {code:'io',message:'Disk full'};});const f=file();
  await assert.rejects(disk.save(f));
  assert.equal(f.saved,'old text');assert.equal(f.disk.version,'v1');assert.equal(disk.dirty(f),true);assert.equal(f.saving,false);
});

test('external conflict never silently retries or overwrites',async()=>{
  let calls=0;const disk=createDisk(async()=>{calls++;throw {code:'conflict',message:'Changed on disk'};});const f=file();
  await assert.rejects(disk.save(f));assert.equal(f.diskConflict.code,'conflict');
  assert.equal(await disk.save(f,{automatic:true}),false);assert.equal(calls,1);
});

test('cancelling Save As preserves the original path and unsaved text',async()=>{
  const disk=createDisk(async()=>null);const f=file();
  assert.equal(await disk.save(f,{saveAs:true}),false);
  assert.equal(f.saved,'old text');assert.equal(f.disk.path,'C:/project/src/main.js');assert.equal(disk.dirty(f),true);
});

test('new drafts need Save As and automatic saves do not open dialogs',async()=>{
  let calls=0;const f={id:'new',path:'untitled.py',content:'',saved:'',isDraft:true};
  const disk=createDisk(async command=>{calls++;assert.equal(command,'save_document_as');return {absolutePath:'C:/new.py',content:'',version:'empty'};});
  assert.equal(disk.dirty(f),true);assert.equal(await disk.save(f,{automatic:true}),false);assert.equal(calls,0);
  assert.equal(await disk.save(f),true);assert.equal(f.isDraft,false);assert.equal(f.disk.path,'C:/new.py');
});

test('keystrokes arriving during a slow save remain unsaved',async()=>{
  let release;const disk=createDisk(()=>new Promise(resolve=>{release=resolve;}));const f=file();
  const pending=disk.save(f);await new Promise(resolve=>setImmediate(resolve));
  f.content='newer keystrokes';release(document());await pending;
  assert.equal(f.saved,'new text');assert.equal(f.content,'newer keystrokes');assert.equal(disk.dirty(f),true);
});

test('queued saves serialize and use the latest successful version',async()=>{
  const calls=[];let release;
  const disk=createDisk(async(command,args)=>{calls.push(args);if(calls.length===1)return new Promise(resolve=>{release=resolve;});return document(args.content,'v3');});
  const f=file();const first=disk.save(f);await new Promise(resolve=>setImmediate(resolve));
  f.content='last edit';const second=disk.save(f);release(document());await Promise.all([first,second]);
  assert.equal(calls[1].expectedVersion,'v2');assert.equal(calls[1].content,'last edit');assert.equal(f.saved,'last edit');
});

test('a failed save does not poison the queue for a manual retry',async()=>{
  let calls=0;const disk=createDisk(async()=>{if(++calls===1)throw {code:'io',message:'Locked'};return document();});const f=file();
  await assert.rejects(disk.save(f));await disk.save(f);assert.equal(f.saveError,null);assert.equal(f.saved,'new text');
});

test('external changes reload clean files but preserve dirty buffers',async()=>{
  const disk=createDisk(async()=>document('external','v3'));const f=file();
  assert.equal((await disk.inspect(f)).kind,'conflict');f.content=f.saved;
  assert.equal((await disk.inspect(f)).kind,'reload');assert.equal(f.content,'old text');
});

test('polling skips drafts not yet created on disk',async()=>{
  const disk=createDisk(async()=>{throw new Error('Must not read a new path');});const f=file();f.disk.version=null;f.isDraft=true;
  assert.equal((await disk.inspect(f)).kind,'unchanged');
});

test('stale polling results cannot overwrite a save that completed meanwhile',async()=>{
  let resolveRead;const disk=createDisk(async(command)=>command==='read_document'?new Promise(resolve=>{resolveRead=resolve;}):document());
  const f=file();const polling=disk.inspect(f);await disk.save(f);resolveRead(document('stale','v0'));
  assert.equal((await polling).kind,'unchanged');assert.equal(f.saved,'new text');
});

test('browser preview has no native transport',async()=>{
  const disk=createDisk();assert.equal(disk.available,false);await assert.rejects(disk.call('open_folder'));
});
