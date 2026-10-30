// Isolated, deterministic browser QA server. No API traffic or real credentials.
// Start explicitly with: node scripts/agent-fixture.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createAgentHandler} from '../agent-server.mjs';
import {createSettingsHandler} from '../settings-server.mjs';
const root=path.resolve('dist');
const settings=createSettingsHandler({file:path.resolve('test-artifacts/code-prediction-fixture-settings.json')});
const agent=createAgentHandler({getKey:()=> 'fixture-only',fetchImpl:async(_url,options)=>{
  const request=JSON.parse(options.body),context=JSON.parse(request.input.at(-1).content),file=context.attachedContext?.[0];
  const text=typeof context.before==='string'?'return a + b;':file?'[TEST FIXTURE — no AI call] Slay queen! 💅 Here is a reviewable change.\n```bluegay-edits\n'+JSON.stringify({edits:[{path:file.path,replacements:[{before:file.content,after:file.content+'\n'+(file.path.endsWith('.py')?'#':'//')+' ChatLGBT fixture change\n'}]},{path:'chatlgbt-fixture.txt',content:'New file from the test fixture.\n'}]})+'\n```':'[TEST FIXTURE — no AI call] Omg yesss 💅 Attach a file to test proposed edits.';
  let i=0;return new Response(new ReadableStream({async pull(controller){await new Promise(r=>setTimeout(r,50));if(options.signal.aborted){controller.close();return;}if(i<text.length){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:text.slice(i,i+=25)})+'\n\n'));}else{controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:100,output_tokens:100}}})+'\n\n'));controller.close();}}}),{headers:{'Content-Type':'text/event-stream'}});
}});
http.createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:4175'){res.writeHead(403).end();return;}
  if(await agent(req,res))return;
  if(await settings(req,res))return;
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
}).listen(4175,'127.0.0.1',()=>console.log('TEST FIXTURE ONLY at http://127.0.0.1:4175 — no model requests'));
