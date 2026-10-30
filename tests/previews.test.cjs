const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const core=require('../dist/preview-core.js'),harness=require('./ui-harness.cjs');
test('preview paths, MIME types and encoded URLs preserve spaces and block secrets/traversal',()=>{
  for(const path of ['../index.html','/index.html','a/../../x','C:/x.html','a\\b.html','.env','a/credentials.json','a/.git/config','.vscode/settings.json','a/private.key'])assert.equal(core.safePath(path),false,path);
  assert.equal(core.safePath('pages/été #1.html'),true);assert.equal(core.url('http://localhost/token/','pages/été #1.html'),'http://localhost/token/pages/%C3%A9t%C3%A9%20%231.html');
  assert.equal(core.kind('file.PDF'),'pdf');assert.equal(core.kind('image.SVG'),'image');assert.equal(core.kind('README.md'),'markdown');assert.equal(core.mime('module.mjs'),'text/javascript');
});
test('error help prepares nearby source and test values without sending or overwriting drafts',()=>{
  const h=harness();h.context.window.BlueGayPreviewCore=core;h.context.window.ChatLGBTCore=require('../dist/agent-core.js');h.run("var chatCore=window.ChatLGBTCore,chat={request:null,attachments:[]};var sent=0;toggleChatLGBT=()=>{};renderChatAttachments=()=>{};updateChatEstimate=()=>{};chatNotice=()=>{};var notice;toast=m=>notice=m;");
  h.run(fs.readFileSync('dist/error-help.js','utf8'));h.run("files=[{id:'code',path:'Main.java',content:Array.from({length:70},(_,i)=>'line '+(i+1)).join('\\n')}];");
  h.run("explainError({file:files[0],line:35,test:'adds',message:'comparison failed',expected:'hello',actual:'world',trace:'Main.java:35'});");
  assert.equal(h.run('chat.attachments.length'),1);assert.match(h.run('chat.attachments[0].content'),/line 35/);assert.doesNotMatch(h.run('chat.attachments[0].content'),/line 1\n/);assert.equal(h.run('chat.attachments[0].selection'),true);
  const prompt=h.elements.get('#chat-prompt').value;assert.match(prompt,/"expected":"hello"/);assert.match(prompt,/"received":"world"/);assert.equal(h.run('sent'),0);
  h.run("explainError({file:files[0],line:1,message:'another'});");assert.equal(h.elements.get('#chat-prompt').value,prompt);assert.match(h.run('notice'),/draft/);
  h.elements.get('#chat-prompt').value='';h.run("files[0].path='.env';explainError({file:files[0],message:'secret'});");assert.equal(h.elements.get('#chat-prompt').value,'');assert.match(h.run('notice'),/credential/);
});
test('launch requests use original native drop tickets and preserve the existing unsaved guard',async()=>{
  const calls=[];const h=harness(async(name,args)=>{calls.push({name,args});if(name==='take_launch_requests')return ['ticket'];if(name==='open_dropped_paths')return {kind:'files',data:[{absolutePath:'C:/my project/été.py',path:'été.py',content:'print(1)',version:'v1'}]};});
  h.run('nativeReady=true');await h.run('drainLaunchRequests()');assert.equal(h.run('files[0].disk.path'),'C:/my project/été.py');assert.equal(h.run('activeId'),h.run('files[0].id'));assert.equal(calls[1].args.id,'ticket');
});
test('local preview serves real relative assets, rejects untrusted writes and atomically replaces snapshots',async()=>{
  const {createPreviewHandler}=await import('../preview-server.mjs');const handler=createPreviewHandler();const server=http.createServer((req,res)=>handler(req,res).catch(error=>res.writeHead(500).end(error.message)));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const {token}=await fetch(base+'/api/preview').then(r=>r.json());assert.equal((await fetch(base+'/api/preview',{method:'POST',body:'{}'})).status,403);
    const write=files=>fetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Preview':token},body:JSON.stringify({files})});
    const response=await write([{path:'pages/été #1.html',content:'<script type="module" src="../main.mjs"></script>'},{path:'main.mjs',content:'document.title="loaded"'},{path:'image.png',base64:Buffer.from([1,2,3]).toString('base64')}]);assert.equal(response.status,200);const {baseUrl}=await response.json();
    const html=await fetch(core.url(baseUrl,'pages/été #1.html'));assert.equal(html.status,200);assert.match(html.headers.get('Content-Security-Policy'),/form-action 'none'/);assert.equal(html.headers.get('Access-Control-Allow-Origin'),'*');assert.match(await html.text(),/main.mjs/);
    const js=await fetch(baseUrl+'main.mjs');assert.equal(js.headers.get('Content-Type'),'text/javascript');assert.deepEqual(Buffer.from(await fetch(baseUrl+'image.png').then(r=>r.arrayBuffer())),Buffer.from([1,2,3]));
    assert.equal((await write([{path:'../x.html',content:'bad'}])).status,400);assert.equal((await fetch(baseUrl+'main.mjs')).status,200);
    await write([{path:'new.html',content:'new'}]);assert.equal((await fetch(baseUrl+'main.mjs')).status,404);assert.equal((await fetch(base+'/__preview/wrong/new.html')).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
