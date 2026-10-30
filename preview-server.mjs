import {randomBytes} from 'node:crypto';
import core from './dist/preview-core.js';
export const previewCsp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; media-src 'self' blob: https:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
export function createPreviewHandler(){
  const secret=randomBytes(24).toString('hex');let entries=new Map();
  return async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname.startsWith('/__preview/')){
      let name;try{name=decodeURIComponent(pathname.slice(('/__preview/'+secret+'/').length));}catch{res.writeHead(400).end();return true;}
      if(!['GET','HEAD'].includes(req.method)||!pathname.startsWith('/__preview/'+secret+'/')||!core.safePath(name)){res.writeHead(404).end();return true;}
      const item=entries.get(name);if(!item){res.writeHead(404).end('Not found');return true;}
      res.writeHead(200,{'Content-Type':core.mime(name),'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Content-Security-Policy':previewCsp});res.end(req.method==='HEAD'?undefined:item);return true;
    }
    if(pathname!=='/api/preview')return false;
    if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({token:secret}));return true;}
    if(req.method!=='POST'||req.headers['x-bluegay-preview']!==secret||req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403).end();return true;}
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>90*1024*1024)throw Error('Preview exceeds 64 MB.');chunks.push(chunk);}
      const payload=JSON.parse(Buffer.concat(chunks).toString());if(!Array.isArray(payload.files)||payload.files.length>2000)throw Error('Invalid preview files.');
      const next=new Map();size=0;for(const file of payload.files){if(!core.safePath(file.path)||!core.mime(file.path)||next.has(file.path))throw Error('Invalid preview path.');const bytes=file.base64?Buffer.from(file.base64,'base64'):Buffer.from(file.content||'');size+=bytes.length;if(size>64*1024*1024)throw Error('Preview exceeds 64 MB.');next.set(file.path,bytes);}entries=next;
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({baseUrl:`http://${req.headers.host}/__preview/${secret}/`}));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}return true;
  };
}
