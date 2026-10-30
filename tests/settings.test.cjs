const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const defaults=require('../settings-defaults.json');

async function fixture(t,file){
  const {createSettingsHandler}=await import('../settings-server.mjs');
  if(!file){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bluegay-settings-'));file=path.join(dir,'settings.json');t.after(()=>fs.rm(dir,{recursive:true,force:true}));}
  const handle=createSettingsHandler({file});
  const server=http.createServer(async(req,res)=>{if(!await handle(req,res))res.writeHead(404).end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+server.address().port+'/api/settings';
  const initial=await fetch(url).then(r=>r.json());
  const put=(value,headers={})=>fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','X-BlueGay-Settings':initial.token,...headers},body:JSON.stringify(value)});
  return {file,url,initial,put};
}
test('all editor and AI settings round-trip through JSON across server restarts',async t=>{
  const f=await fixture(t);assert.equal(f.initial.settings,null);
  const value=structuredClone(defaults);value.preferences.fontSize=19;value.preferences.fixIndentationOnSave=true;value.preferences.theme='lavender';value.preferences.accent='#7750b5';value.chat.tone='quiet';
  assert.equal((await f.put(value)).status,200);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),value);
  const restarted=await fixture(t,f.file);assert.deepEqual(restarted.initial.settings,value);
});
test('cross-origin, tokenless, oversized and API-key-containing settings are rejected',async t=>{
  const f=await fixture(t);
  assert.equal((await f.put(defaults,{Origin:'https://other.example'})).status,403);
  assert.equal((await f.put(defaults,{'X-BlueGay-Settings':''})).status,403);
  assert.equal((await fetch(f.url,{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await f.put({...defaults,apiKey:'secret'})).status,400);
  assert.equal((await f.put({...defaults,chat:{...defaults.chat,key:'secret'}})).status,400);
  assert.equal((await f.put({...defaults,preferences:{...defaults.preferences,fontFamily:'x'.repeat(17000)}})).status,400);
  await assert.rejects(fs.readFile(f.file),{code:'ENOENT'});
});
test('invalid existing JSON is preserved rather than overwritten on load',async t=>{
  const f=await fixture(t);await fs.writeFile(f.file,'not json');
  assert.equal((await fetch(f.url)).status,400);
  assert.equal(await fs.readFile(f.file,'utf8'),'not json');
});
async function client(initial,load){
  const storage=new Map(Object.entries(initial));const calls=[];
  const window={__TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,args});if(command==='load_settings')return load;return {path:'settings.json'};}}}};
  const context=vm.createContext({window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}});
  vm.runInContext(await fs.readFile(path.join(__dirname,'../dist/settings-client.js'),'utf8'),context);
  await window.BlueGaySettings.ready;return {storage,calls,store:window.BlueGaySettings};
}
test('first launch migrates both preference groups and later launches load disk before app startup',async()=>{
  const f=await client({'bluegay.preferences':'{"theme":"light"}','bluegay.agent.settings':'{"tone":"quiet"}'},{settings:null,path:'settings.json'});
  assert.equal(f.calls[1].args.settings.preferences.theme,'light');assert.equal(f.calls[1].args.settings.chat.tone,'quiet');
  const loaded=await client({'bluegay.preferences':'{"theme":"dark"}'},{settings:defaults,path:'settings.json'});
  assert.deepEqual(JSON.parse(loaded.storage.get('bluegay.preferences')),defaults.preferences);
  assert.equal(loaded.calls.length,1);
  loaded.storage.set('bluegay.preferences','{"theme":"light"}');await loaded.store.save();
  assert.equal(loaded.calls[1].args.settings.preferences.theme,'light');
});
test('failed local settings initialization retains cached preferences and never writes defaults',async()=>{
  const f=await client({'bluegay.preferences':'{"theme":"light"}'},null);
  assert.equal(f.store.state.available,false);assert.equal(f.calls.length,1);
  assert.equal(JSON.parse(f.storage.get('bluegay.preferences')).theme,'light');
  await assert.rejects(f.store.save());assert.equal(f.calls.length,1);
});
test('settings schema includes every current editor preference',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../dist/app.js'),'utf8');
  const current=vm.runInNewContext('('+source.match(/const defaults=(\{[^\n]+\});/)[1]+')');
  assert.deepEqual(JSON.parse(JSON.stringify(current)),defaults.preferences);
});
