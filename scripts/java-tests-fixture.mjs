// Local UI verification against the real native adapter fixture on port 4177.
// No real accounts, credentials, or AI model calls are used.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
const root=path.resolve('dist'),project=path.resolve('test-artifacts/java-test-projects/ui');
const version=content=>createHash('sha256').update(content).digest('hex');
function document(relative){const target=path.join(project,relative),content=fs.readFileSync(target,'utf8');return {path:relative,absolutePath:target,content,version:version(content)};}
function scan(relative=''){const files=[],folders=[];for(const entry of fs.readdirSync(path.join(project,relative),{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory()){folders.push(name);const nested=scan(name);files.push(...nested.files);folders.push(...nested.folders);}else files.push(document(name));}return {files,folders};}
const workspace=()=>({root:project,name:'Java TDD verification',...scan(),skipped:0});
const injected=`<script>
window.__TAURI__={core:{invoke:async(command,args={})=>{const response=await fetch('/fixture/ipc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,args})});const value=await response.json();if(value.error)throw Error(value.error);return value.data;}},event:{listen:async()=>()=>{}}};
</script>`;
http.createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:4180'){res.writeHead(403).end();return;}
  if(req.url==='/fixture/ipc'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1024*1024){res.writeHead(413).end();return;}}
    const {command,args}=JSON.parse(body);let data=null;
    try{
      if(command==='debugger_request'){const result=await fetch('http://127.0.0.1:4177/debug',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:args.operation,args:args.args})}).then(r=>r.json());if(result.error)throw Error(result.error);data=result.data;}
      else if(command==='open_folder'||command==='refresh_workspace')data=workspace();
      else if(command==='load_settings')data={settings:{version:1,preferences:{codePrediction:false},chat:{}},path:'Isolated debugger fixture settings'};
      else if(command==='save_settings')data={path:'Isolated debugger fixture settings'};
      else if(command==='chatgpt_status')data={accounts:[],activeId:null,pending:false};
      else if(command==='agent_status')data={configured:false};
      else if(command==='update_info')data={source:null,version:'1.0.3',configured:false};
      else if(command==='read_document'){const relative=path.relative(project,args.path);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Outside fixture');data=document(relative);}
      else if(command==='save_document'){const relative=path.relative(project,args.path);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Outside fixture');fs.writeFileSync(path.join(project,relative),args.content);data=document(relative);}
      else if(command==='open_html')data=true;
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data}));
    }catch(error){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}return;
  }
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{let bytes=fs.readFileSync(target);if(pathname==='/')bytes=Buffer.from(bytes.toString('utf8').replace('<script src="vendor/fflate.js">',injected+'<script src="vendor/fflate.js">'));res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.ttf':'font/ttf'})[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);}catch{res.writeHead(404).end();}
}).listen(4180,'127.0.0.1',()=>console.log('Isolated debugger UI at http://127.0.0.1:4180'));
