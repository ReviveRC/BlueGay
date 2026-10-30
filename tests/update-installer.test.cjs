const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const installer=path.resolve('scripts/install-update.ps1');
const compiler='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bluegay-installer-'));const stage=path.join(root,'.bluegay-update-test');fs.mkdirSync(stage);return {root,stage,target:path.join(root,'BlueGay.exe'),staged:path.join(stage,'BlueGay.exe'),job:path.join(stage,'job.json')};}
function cleanup(f){fs.rmSync(f.root,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
function job(f,extra={}){fs.writeFileSync(f.job,JSON.stringify({target:f.target,staged:f.staged,pid:2147483647,sha256:hash(fs.readFileSync(f.staged)),old_sha256:hash(fs.readFileSync(f.target)),...extra}));}
function run(f,...args){return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',installer,'-JobPath',f.job,...args],{encoding:'utf8',timeout:20000,windowsHide:true});}
function compile(f,destination,marker,exitCode=0){
  const file=path.join(f.root,marker+'.cs');
  fs.writeFileSync(file,`using System;using System.IO;class App{static void Main(){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"${marker}.txt"),"started");Environment.Exit(${exitCode});}}`);
  const result=spawnSync(compiler,['/nologo','/target:winexe','/out:'+destination,file],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr+result.stdout);
}
test('Windows updater validates paths and rejects changed staged bytes before touching the EXE',{skip:process.platform!=='win32'},()=>{
  const f=fixture();try{
    fs.writeFileSync(f.target,'original');fs.writeFileSync(f.staged,'MZnew');job(f);
    const result=run(f,'-VerifyOnly');assert.equal(result.status,0,result.stderr+(fs.existsSync(path.join(f.stage,'update.log'))?fs.readFileSync(path.join(f.stage,'update.log'),'utf8'):''));
    fs.writeFileSync(f.staged,'tampered');assert.equal(run(f,'-VerifyOnly').status,1);assert.equal(fs.readFileSync(f.target,'utf8'),'original');
    job(f,{staged:f.target});assert.equal(run(f,'-VerifyOnly').status,1);
  }finally{cleanup(f);}
});
test('Windows updater replaces the same EXE path, retains a backup, and starts the new app',{skip:process.platform!=='win32'||!fs.existsSync(compiler)},()=>{
  const f=fixture();try{
    fs.writeFileSync(f.target,'original');compile(f,f.staged,'updated');job(f);const expected=fs.readFileSync(f.staged);
    const result=run(f);assert.equal(result.status,0,result.stderr+result.stdout+(fs.existsSync(path.join(f.stage,'update.log'))?fs.readFileSync(path.join(f.stage,'update.log'),'utf8'):''));
    assert.deepEqual(fs.readFileSync(f.target),expected);assert.equal(fs.readFileSync(path.join(f.stage,'previous.exe'),'utf8'),'original');assert(fs.existsSync(path.join(f.root,'updated.txt')));
  }finally{cleanup(f);}
});
test('Windows updater restores and restarts the previous EXE when the new app fails',{skip:process.platform!=='win32'||!fs.existsSync(compiler)},()=>{
  const f=fixture();try{
    compile(f,f.target,'restored');compile(f,f.staged,'failed',42);job(f);const expected=fs.readFileSync(f.target);
    const result=run(f);assert.equal(result.status,1,result.stderr+result.stdout);assert.deepEqual(fs.readFileSync(f.target),expected);
    // The restored fixture exits immediately; wait for its marker, not a user app.
    const wait=spawnSync('powershell.exe',['-NoProfile','-Command',"Start-Sleep -Milliseconds 300"],{windowsHide:true});assert.equal(wait.status,0);
    assert(fs.existsSync(path.join(f.root,'restored.txt')));assert(fs.readFileSync(path.join(f.stage,'update.log'),'utf8').includes('Previous version restored.'));
  }finally{cleanup(f);}
});
