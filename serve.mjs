import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createAgentHandler} from './agent-server.mjs';
import {createSettingsHandler} from './settings-server.mjs';
import {createPreviewHandler} from './preview-server.mjs';
const root=path.resolve('dist');
const port=Number(process.env.BLUEGAY_PORT)||4173;
const agent=createAgentHandler();
const settings=createSettingsHandler();
const previews=createPreviewHandler();
const mime={'.wasm':'application/wasm','.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403).end('Invalid host');return;}
  if(await agent(req,res))return;
  if(await settings(req,res))return;
  if(await previews(req,res))return;
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  let url;try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const file=path.resolve(root,'.'+(url==='/'?'/index.html':url));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);});
});
server.listen(port,'127.0.0.1',()=>console.log(`BlueGay ready at http://127.0.0.1:${port}`));
