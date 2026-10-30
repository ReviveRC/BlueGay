import {randomBytes} from 'node:crypto';
export function validateRequest(body){
  if(body?.auth_provider && body.auth_provider!=='api')throw Error('ChatGPT sign-in requires the desktop app. Choose API-key billing explicitly to use preview.');
  if(!body||typeof body.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(body.model)||typeof body.instructions!=='string'||body.instructions.length>10000||!Array.isArray(body.input)||body.input.length<1||body.input.length>9)throw Error('Invalid request.');
  if(body.input.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string')||JSON.stringify(body.input).length>90000)throw Error('Invalid or oversized context.');
  const max=body.max_output_tokens;
  if(body.purpose!==undefined&&body.purpose!=='code_prediction')throw Error('Invalid request purpose.');
  const prediction=body.purpose==='code_prediction';
  if(!Number.isInteger(max)||max<(prediction?64:1000)||max>(prediction?2048:16000))throw Error('Invalid output limit.');
  return {model:body.model,instructions:body.instructions,input:body.input.map(m=>({role:m.role,content:m.content})),max_output_tokens:max,stream:true,store:false};
}
export function createAgentHandler({getKey=()=>process.env.OPENAI_API_KEY,fetchImpl=fetch}={}){
  const token=randomBytes(32).toString('hex');const active=new Set();let sessionKey=null;
  const currentKey=()=>sessionKey||getKey()?.trim();
  async function readJSON(req,limit){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request too large.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  return async function handle(req,res){
    if(!req.url.startsWith('/api/chatlgbt/'))return false;
    const origin=`http://${req.headers.host}`;
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'){json(403,{error:'Same-origin access only.'});return true;}
    if(req.url==='/api/chatlgbt/status'&&req.method==='GET'){json(200,{configured:!!currentKey(),token});return true;}
    if(req.headers['x-bluegay-agent']!==token||req.headers['content-type']!=='application/json'){json(403,{error:'Reload BlueGay and try again.'});return true;}
    if(req.url==='/api/chatlgbt/key'&&['POST','DELETE'].includes(req.method)){
      try{const body=await readJSON(req,2048);if(req.method==='DELETE')sessionKey=null;else{const key=body.key?.trim();if(typeof key!=='string'||key.length<10||key.length>512||/\s/.test(key))throw Error('Invalid key');sessionKey=key;}json(200,{configured:!!currentKey()});}catch{json(400,{error:'Enter a valid API key.'});}return true;
    }
    if(!['/api/chatlgbt/respond','/api/chatlgbt/predict'].includes(req.url)||req.method!=='POST'){json(404,{error:'Not found.'});return true;}
    const lane=req.url.endsWith('/predict')?'prediction':'chat';
    let payload;
    try{const body=await readJSON(req,400000);if((body.purpose==='code_prediction')!==(lane==='prediction'))throw Error('Invalid request route.');payload=validateRequest(body);}catch{json(400,{error:'Invalid model request.'});return true;}
    if(active.has(lane)){json(409,{error:'Another request of this kind is running.'});return true;}
    const key=currentKey();if(!key){json(503,{error:'Connect an OpenAI API key in ChatLGBT settings.'});return true;}
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),lane==='prediction'?20000:180000);
    res.on('close',()=>controller.abort());active.add(lane);
    try{
      const upstream=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      if(!upstream.ok){const messages={401:'The API key was rejected.',403:'This API key cannot access the requested model.',404:'Model not found. Check the model ID and account access.',429:'API rate or billing limit reached.'};json(upstream.status,{error:messages[upstream.status]||`Model service returned HTTP ${upstream.status}.`});return true;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      let bytes=0;for await(const chunk of upstream.body){bytes+=chunk.length;if(bytes>4000000)throw Error('Response exceeded size limit.');if(res.destroyed)break;res.write(chunk);}
      res.end();
    }catch(error){if(!res.destroyed){const message=controller.signal.aborted?'Request stopped or timed out.':'ChatLGBT could not complete the request. Check your connection and request settings.';if(!res.headersSent)json(400,{error:message});else{res.write(`data: ${JSON.stringify({type:'error',message})}\n\n`);res.end();}}}
    finally{clearTimeout(timeout);controller.abort();active.delete(lane);}
    return true;
  };
}
