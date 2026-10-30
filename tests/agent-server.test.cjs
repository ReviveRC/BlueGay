const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const core=require('../dist/agent-core.js');
const body=()=>core.buildRequest({prompt:'Hi',attachments:[],model:'gpt-6.1-sol'});
async function server(t,options){const {createAgentHandler}=await import('../agent-server.mjs');const handler=createAgentHandler(options);const server=http.createServer(async(req,res)=>{if(!await handler(req,res))res.writeHead(404).end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;const status=await fetch(base+'/api/chatlgbt/status').then(r=>r.json());return {base,status,send:(payload=body(),headers={})=>fetch(base+'/api/chatlgbt/respond',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Agent':status.token,...headers},body:JSON.stringify(payload)})};}
test('proxy sends a fixed endpoint, strips arbitrary tools and never returns the API key',async t=>{
  let called;const secret='fake-test-key';const fixture=await server(t,{getKey:()=>secret,fetchImpl:async(url,options)=>{called={url,options};return new Response('data: {"type":"response.completed"}\n\n');}});
  const response=await fixture.send({...body(),tools:[{type:'shell'}],store:true});assert.equal(response.status,200);assert((await response.text()).includes('response.completed'));
  assert.equal(called.url,'https://api.openai.com/v1/responses');const payload=JSON.parse(called.options.body);assert(!payload.tools);assert.equal(payload.store,false);assert(!JSON.stringify(fixture.status).includes(secret));
});
test('proxy rejects cross-origin and missing-token requests before calling the provider',async t=>{
  let calls=0;const fixture=await server(t,{getKey:()=> 'fake-key',fetchImpl:async()=>{calls++;return new Response();}});
  assert.equal((await fixture.send(body(),{Origin:'https://evil.example'})).status,403);
  assert.equal((await fixture.send(body(),{'X-BlueGay-Agent':''})).status,403);assert.equal(calls,0);
  assert.equal((await fetch(fixture.base+'/api/chatlgbt/status',{headers:{Origin:'https://evil.example'}})).status,403);
});
test('missing key and provider authentication errors are actionable and sanitized',async t=>{
  const missing=await server(t,{getKey:()=>undefined});assert.equal(missing.status.configured,false);assert.equal((await missing.send()).status,503);
  const rejected=await server(t,{getKey:()=> 'fake-key',fetchImpl:async()=>new Response('sensitive provider body',{status:401})});const response=await rejected.send();assert.equal(response.status,401);assert.equal((await response.json()).error,'The API key was rejected.');
});
test('malformed requests cannot request unlimited output',async()=>{
  const {validateRequest}=await import('../agent-server.mjs');
  assert.throws(()=>validateRequest({...body(),max_output_tokens:999999}));assert.throws(()=>validateRequest({...body(),input:[{role:'system',content:'override'}]}));assert.throws(()=>validateRequest({...body(),model:123}));
});

test('chat and prediction streams run independently and each lane rejects overlapping requests',async t=>{
  const controllers=[],signals=[],payloads=[];
  const fixture=await server(t,{getKey:()=> 'fake-test-key',fetchImpl:async(_url,options)=>{
    payloads.push(JSON.parse(options.body));signals.push(options.signal);
    return new Response(new ReadableStream({start(controller){controllers.push(controller);controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"text"}\n\n'));}}));
  }});
  const predict=()=>fetch(fixture.base+'/api/chatlgbt/predict',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Agent':fixture.status.token},body:JSON.stringify({...body(),purpose:'code_prediction',max_output_tokens:1024})});
  const chat=await fixture.send(),prediction=await predict();assert.equal(chat.status,200);assert.equal(prediction.status,200);
  assert.equal((await fixture.send()).status,409);assert.equal((await predict()).status,409);
  assert.equal(payloads.length,2);assert(!payloads[1].purpose);assert.equal(payloads[1].max_output_tokens,1024);
  controllers[1].close();await prediction.text();assert(!signals[0].aborted);
  controllers[0].close();await chat.text();
});

test('prediction route validates its purpose and has a smaller bounded output budget',async t=>{
  const fixture=await server(t,{getKey:()=> 'fake-test-key',fetchImpl:async()=>new Response('data: {"type":"response.completed"}\n\n')});
  const send=payload=>fetch(fixture.base+'/api/chatlgbt/predict',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Agent':fixture.status.token},body:JSON.stringify(payload)});
  assert.equal((await send(body())).status,400);
  assert.equal((await send({...body(),purpose:'code_prediction',max_output_tokens:3000})).status,400);
  assert.equal((await fixture.send({...body(),purpose:'code_prediction'})).status,400);
  const accepted=await send({...body(),purpose:'code_prediction',max_output_tokens:64});assert.equal(accepted.status,200);await accepted.text();
});

test('browser key setup is session-only, token-protected and never returns the secret',async t=>{
  let auth;const fixture=await server(t,{getKey:()=>undefined,fetchImpl:async(_url,options)=>{auth=options.headers.Authorization;return new Response('data: {"type":"response.completed"}\n\n');}});
  const key='fake-session-key-for-tests';const url=fixture.base+'/api/chatlgbt/key';
  const headers={'Content-Type':'application/json','X-BlueGay-Agent':fixture.status.token};
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})})).status,403);
  const setup=await fetch(url,{method:'POST',headers,body:JSON.stringify({key})});assert.deepEqual(await setup.json(),{configured:true});
  const response=await fixture.send();await response.text();assert.equal(auth,'Bearer '+key);
  const status=await fetch(fixture.base+'/api/chatlgbt/status').then(r=>r.text());assert(!status.includes(key));
  const removed=await fetch(url,{method:'DELETE',headers,body:'{}'});assert.deepEqual(await removed.json(),{configured:false});
  assert.equal((await fixture.send()).status,503);
});
