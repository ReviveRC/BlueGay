const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const harness=require('./ui-harness.cjs');
function setup(invoke){
  const h=harness(invoke);const create=h.context.document.createElement;
  h.context.document.createElement=()=>({...create(),setAttribute(){}});
  h.run(fs.readFileSync('dist/updates.js','utf8'));
  return h;
}
test('update check downloads a verified candidate and never installs without restart',async()=>{
  const calls=[];const h=setup(async command=>{calls.push(command);if(command==='update_check')return {configured:true,currentVersion:'1.0.0',available:true,version:'1.0.1',notes:'Fixes'};});
  await h.run('window.BlueGayUpdates.check()');
  assert.deepEqual(calls,['update_check','update_prepare']);assert.equal(h.run('window.BlueGayUpdates.state.ready'),true);
});
test('no download occurs for current versions or an unconfigured source',async()=>{
  for(const configured of [true,false]){
    const calls=[];const h=setup(async command=>{calls.push(command);return {configured,currentVersion:'1.0.0',available:false};});
    await h.run('window.BlueGayUpdates.check()');assert.deepEqual(calls,['update_check']);assert.equal(h.run('window.BlueGayUpdates.state.ready'),false);
  }
});
test('failed verification keeps the installed app and never offers restart',async()=>{
  const h=setup(async command=>{if(command==='update_check')return {configured:true,available:true,currentVersion:'1.0.0',version:'1.0.1'};throw Error('Invalid signature');});
  await h.run('window.BlueGayUpdates.check()');assert.equal(h.run('window.BlueGayUpdates.state.ready'),false);assert.equal(h.run('window.BlueGayUpdates.state.error'),'Invalid signature');
});
test('canceling unsaved-work protection prevents update install',async()=>{
  const calls=[];const h=setup(async command=>calls.push(command));
  h.run('var chat={};guardUnsaved=async()=>false;window.BlueGayUpdates.state.ready=true;');
  await h.run('window.BlueGayUpdates.install()');assert.deepEqual(calls,[]);
});
test('restart waits for pending settings and recovery before native installation',async()=>{
  const calls=[];const h=setup(async command=>calls.push(command));h.context.calls=calls;
  h.run("var chat={};guardUnsaved=async()=>true;persist=()=>calls.push('persist');window.BlueGaySettings={settled:async()=>calls.push('settings')};window.BlueGayUpdates.state.ready=true;");
  await h.run('window.BlueGayUpdates.install()');assert.deepEqual(calls,['persist','settings','update_install']);
});
test('release signer emits metadata whose bytes and signature can be independently checked',async()=>{
  const {releaseToken}=await import('../scripts/create-release.mjs');const crypto=require('node:crypto');
  const os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'bluegay-release-'));
  try{
    const exe=path.join(dir,'BlueGay.exe');fs.writeFileSync(exe,'MZfixture');
    const token=releaseToken({exe,version:'1.0.0',url:'https://example.invalid/BlueGay.exe',key:'tests/fixtures/update-signing/test-private.pem',now:100});
    const parts=token.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
    assert.equal(claims.version,'1.0.0');assert.equal(claims.size,9);assert.equal(claims.sha256,crypto.createHash('sha256').update('MZfixture').digest('hex'));
    assert(crypto.verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),fs.readFileSync('tests/fixtures/update-signing/test-public.pem'),Buffer.from(parts[2],'base64url')));
    assert.throws(()=>releaseToken({exe,version:'0.1',url:'https://example.invalid/a',key:'unused'}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
