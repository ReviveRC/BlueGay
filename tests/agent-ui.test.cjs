const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const harness=require('./ui-harness.cjs');
function setup(invoke){
  const h=harness(invoke);h.context.window.ChatLGBTCore=require('../dist/agent-core.js');
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../dist/agent.js'),'utf8'),h.context);
  h.run(`files=[];tabs=[];activeId=null;newFile('a.js','const x = 1;');newFile('b.js','const y = 1;');
    modelFor=file=>({pushStackElement(){},getFullModelRange(){return {};},pushEditOperations(_,edits){file.content=edits[0].text;},setValue(text){file.content=text;}});
    var proposal={epoch:chat.epoch,edits:[{id:files[0].id,path:'a.js',before:'const x = 1;',after:'const x = 2;'},{id:files[1].id,path:'b.js',before:'const y = 1;',after:'const y = 2;'}]};`);
  return h;
}
test('accepted changes make checkpoints, stay unsaved and can be undone as a batch',async()=>{
  const h=setup();h.run('applyChatProposal(proposal)');
  assert.equal(h.run('files[0].content'),'const x = 2;');assert.equal(h.run('files[1].content'),'const y = 2;');
  assert.equal(h.run('files[0].history[0].content'),'const x = 1;');
  assert.equal(await h.run('saveFile(files[0],false,{automatic:true})'),false);
  assert.equal(h.run('files[0].saved'),'const x = 1;');
  h.run('undoChatApply()');assert.equal(h.run('files[0].content'),'const x = 1;');assert.equal(h.run('files[1].content'),'const y = 1;');
});
test('if one file changed, no file in the proposal is mutated',()=>{
  const h=setup();h.run("files[1].content='a newer edit'");assert.throws(()=>h.run('applyChatProposal(proposal)'),/changed/);
  assert.equal(h.run('files[0].content'),'const x = 1;');assert.equal(h.run('files[0].history.length'),0);
});
test('rejected and prior-workspace proposals cannot be accepted',()=>{
  const h=setup();h.run("proposal.resolution='Rejected'");assert.throws(()=>h.run('applyChatProposal(proposal)'),/active/);
  h.run('delete proposal.resolution;chat.epoch++');assert.throws(()=>h.run('applyChatProposal(proposal)'),/active/);
});
test('Undo refuses to overwrite edits made after acceptance',()=>{
  const h=setup();h.run("applyChatProposal(proposal);files[0].content='typed after apply';undoChatApply()");
  assert.equal(h.run('files[0].content'),'typed after apply');assert.equal(h.run('files[1].content'),'const y = 2;');
});
test('unexpected failure during a batch restores files already changed',()=>{
  const h=setup();h.run("const originalFactory=modelFor;modelFor=file=>{const model=originalFactory(file);if(file.path==='b.js')model.pushEditOperations=()=>{throw Error('test failure')};return model;}");
  assert.throws(()=>h.run('applyChatProposal(proposal)'),/test failure/);
  assert.equal(h.run('files[0].content'),'const x = 1;');assert.equal(h.run('files[0].history.length'),0);assert.equal(h.run('files[1].content'),'const y = 1;');
});
test('new files are created only on acceptance and Undo removes unsaved additions',()=>{
  const h=setup();h.run("proposal.edits=[{id:null,path:'new.txt',before:null,after:'hello'}];applyChatProposal(proposal)");
  assert.equal(h.run("files.find(f=>f.path==='new.txt').aiPendingSave"),true);assert.equal(h.run("files.find(f=>f.path==='new.txt').saved"),'');
  h.run('undoChatApply()');assert.equal(h.run("files.some(f=>f.path==='new.txt')"),false);
});
test('manual save releases the AI autosave hold',async()=>{
  const h=setup();h.run('applyChatProposal(proposal)');await h.run('saveFile(files[0])');assert.equal(h.run('files[0].aiPendingSave'),false);assert.equal(h.run('fileDirty(files[0])'),false);
});
test('closing a project clears AI context, history and pending proposals',async()=>{
  const h=setup();h.run("chat.messages=[{role:'user',text:'private prompt'}];chat.attachments=[{id:files[0].id}]");await h.run('closeProject()');
  assert.equal(h.run('chat.messages.length'),0);assert.equal(h.run('chat.attachments.length'),0);assert.throws(()=>h.run('applyChatProposal(proposal)'),/active/);
});

function streamSetup(events,invoke){
  const h=setup(invoke);h.context.AbortController=AbortController;
  h.context.fetch=async()=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
  h.run("refreshChatStatus=async()=>({configured:true,token:'test-token'});$('#chat-prompt').value='Change x to 2';chat.attachments=[{id:files[0].id,path:files[0].path}]");
  return h;
}

test('API billing disclosure remains present with or without a configured key',()=>{
  for(const configured of [false,true]){
    const h=setup();h.run(`chat.status={configured:${configured}};var billingModal='';ensureChatLGBT=()=>{};openModal=html=>billingModal=html;showChatSettings()`);
    assert.match(h.run('billingModal'),/API-key mode is billed separately from ChatGPT/);
    assert.match(h.run('billingModal'),/API credits or an active API billing arrangement/);
    assert.match(h.run('billingModal'),/does not verify your credit balance/);
    assert.match(h.run('chatBillingNotice()'),/Manage API billing & credits/);
  }
});

test('model dropdown restores and persists a supported choice',async()=>{
  const h=setup();h.run(`ensureChatLGBT=()=>{};var settingsHtml='';openModal=html=>settingsHtml=html;chatSettings.model='gpt-6-luna';showChatSettings();saveSettingsToComputer=async()=>{};refreshChatStatus=async()=>{};closeModal=()=>{};`);
  assert.match(h.run('settingsHtml'),/<select id="chat-model-input"/);
  assert.doesNotMatch(h.run('settingsHtml'),/<input id="chat-model-input"/);
  assert.equal(h.run("$('#chat-model-input').value"),'gpt-6-luna');
  h.run("$('#chat-model-input').value='gpt-6-astra'");
  await h.run("$('#chat-settings-form').onsubmit({preventDefault(){}})");
  assert.equal(JSON.parse(h.storage.get('bluegay.agent.settings')).model,'gpt-6-astra');
  assert.equal(h.run("chatCore.buildRequest({prompt:'hello',attachments:[],...chatSettings}).model"),'gpt-6-astra');
});

test('old unsupported models require an explicit choice without sending or losing a draft',async()=>{
  const h=setup();h.run(`ensureChatLGBT=()=>{};var settingsHtml='';openModal=html=>settingsHtml=html;chatSettings.model='old-model';$('#chat-prompt').value='Keep this draft';`);
  await h.run('sendChatMessage()');
  assert.match(h.run('settingsHtml'),/Choose a supported model \(previous: old-model\)/);
  assert.equal(h.run("$('#chat-model-input').value"),'');
  assert.equal(h.run("$('#chat-prompt').value"),'Keep this draft');
  assert.equal(h.run('chat.request'),null);
  await h.run("$('#chat-settings-form').onsubmit({preventDefault(){}})");
  assert.match(h.run("$('#chat-settings-status').textContent"),/Choose a supported model/);
  assert.equal(h.storage.has('bluegay.agent.settings'),false);
});

test('billing and student links dispatch to the native browser opener',async()=>{
  const calls=[];const h=setup(async(command,args)=>calls.push({command,args}));
  for(const target of ['billing','students']){
    let prevented=false;const status={textContent:'old error'};
    const link={dataset:{chatExternal:target},closest:()=>({querySelector:()=>status})};
    await h.events.click({target:{closest:()=>link},preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(status.textContent,'');
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))),{command:'open_chat_link',args:{target}});
  }
});

test('browser previews keep normal links and desktop failures show a usable address',async()=>{
  const link={dataset:{chatExternal:'billing'},closest:()=>({querySelector:()=>status})};
  const status={textContent:''};const event={target:{closest:()=>link},preventDefault(){throw Error('Browser navigation must remain enabled');}};
  await setup().events.click(event);
  const h=setup(async()=>{throw Error('No browser');});h.run('toast=()=>{}');
  await h.events.click({...event,preventDefault(){}});
  assert.match(status.textContent,/Open this address manually: https:\/\/platform.openai.com/);
});

test('student notice includes eligibility, registration, and the API-credit distinction',()=>{
  const h=setup();
  for(const detailed of [false,true]){
    const notice=h.run(`chatBillingNotice(${detailed})`);
    assert.match(notice,/\$100 in Codex credits/);
    assert.match(notice,/enrolled and residing in the U.S. or Canada/);
    assert.match(notice,/not API credits/);
    assert.match(notice,/https:\/\/chatgpt.com\/codex\/offers\/students/);
  }
});

test('missing API key opens setup without sending or losing the draft',async()=>{
  const h=streamSetup([]);let calls=0;h.context.fetch=async()=>{calls++;throw Error('must not send');};
  h.run("var setupOpened=false;showChatSettings=()=>setupOpened=true;refreshChatStatus=async()=>({configured:false});");
  await h.run('sendChatMessage()');
  assert.equal(calls,0);assert.equal(h.run('setupOpened'),true);assert.equal(h.run('chat.messages.length'),0);
  assert.equal(h.run("$('#chat-prompt').value"),'Change x to 2');assert.equal(h.run('chat.request'),null);
});
test('a completed model stream creates a reviewable proposal without applying it',async()=>{
  const text='Slay!\n```bluegay-edits\n'+JSON.stringify({edits:[{path:'a.js',replacements:[{before:'const x = 1;',after:'const x = 2;'}]}]})+'\n```';
  const h=streamSetup([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{usage:{input_tokens:10,output_tokens:20}}}]);
  await h.run('sendChatMessage()');
  assert.equal(h.run('chat.messages[1].edits.length'),1);assert.equal(h.run('files[0].content'),'const x = 1;');assert.equal(h.run('chat.messages[1].usage.output_tokens'),20);
});
test('an incomplete stream never exposes an accept-able proposal',async()=>{
  const h=streamSetup([{type:'response.output_text.delta',delta:'Partial answer'},{type:'response.incomplete'}]);
  await h.run('sendChatMessage()');assert.equal(h.run('chat.messages[1].edits.length'),0);assert.match(h.run('chat.messages[1].error'),/limit/);assert.equal(h.run('chat.request'),null);
});

test('credit exhaustion in an HTTP 200 stream shows billing cause and restores the prompt',async()=>{
  const error={code:'credit_balance_exhausted',type:'insufficient_quota',message:'You have no credits remaining.'};
  const h=streamSetup([{type:'error',error},{type:'response.failed',response:{error}}]);
  await h.run('sendChatMessage()');
  assert.match(h.run('chat.messages[1].error'),/credit_balance_exhausted/);
  assert.match(h.run('chat.messages[1].error'),/billing/);
  assert.equal(h.run("$('#chat-prompt').value"),'Change x to 2');
  assert.equal(h.run('chat.messages[1].edits.length'),0);
  let request;
  h.context.fetch=async(_url,options)=>{request=JSON.parse(options.body);return new Response('data: {"type":"response.completed"}\n\n');};
  await h.run('sendChatMessage()');
  assert.equal(request.input.length,1,'Retry excludes both messages from the failed attempt');
});

test('failed streams preserve a newer draft and never enable edits, even after completed',async()=>{
  const h=streamSetup([]);
  const proposal='```bluegay-edits\n'+JSON.stringify({edits:[{path:'a.js',replacements:[{before:'const x = 1;',after:'const x = 2;'}]}]})+'\n```';
  h.context.fetch=async()=>{
    h.run("$('#chat-prompt').value='My next message'");
    return new Response([{type:'response.output_text.delta',delta:proposal},{type:'response.failed',response:{error:{code:'server_error',message:'Service unavailable.'}}},{type:'response.completed'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  };
  await h.run('sendChatMessage()');
  assert.equal(h.run("$('#chat-prompt').value"),'My next message');
  assert.equal(h.run('chat.messages[1].edits.length'),0);
  assert.equal(h.run('files[0].content'),'const x = 1;');
});

test('native event transport preserves the same actionable billing failure',async()=>{
  let listener;
  const h=streamSetup([],async(name,args)=>{
    assert.equal(name,'agent_respond');
    listener({payload:{id:args.id,chunk:Array.from(new TextEncoder().encode('data: '+JSON.stringify({type:'response.failed',response:{error:{code:'credit_balance_exhausted',message:'No credits remaining.'}}})+'\n\n'))}});
  });
  h.context.window.__TAURI__={event:{listen:async(_name,callback)=>{listener=callback;return ()=>{};}}};
  await h.run('sendChatMessage()');
  assert.match(h.run('chat.messages[1].error'),/credit_balance_exhausted/);
  assert.equal(h.run('chat.request'),null);
});
test('stopping an in-flight stream keeps partial text and offers no edits',async()=>{
  const h=streamSetup([]);let began;
  const started=new Promise(resolve=>began=resolve);
  h.context.fetch=async(_url,options)=>{began();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));};
  const task=h.run('sendChatMessage()');await started;h.run('stopChatLGBT()');await task;
  assert.match(h.run('chat.messages[1].error'),/Stopped/);assert.equal(h.run('chat.messages[1].edits.length'),0);assert.equal(h.run('chat.request'),null);
});
test('a workspace reset while status is pending prevents sending old code',async()=>{
  const h=streamSetup([]);let release;let calls=0;
  h.context.statusPromise=new Promise(resolve=>release=resolve);h.context.fetch=async()=>{calls++;return new Response();};
  h.run('refreshChatStatus=()=>statusPromise');const task=h.run('sendChatMessage()');h.run('resetChatLGBT()');release({configured:true});await task;
  assert.equal(calls,0);assert.equal(h.run('chat.messages.length'),0);assert.equal(h.run('chat.request'),null);
});
