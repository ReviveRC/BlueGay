const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const harness=require('./ui-harness.cjs');
function setup(invoke){
  const h=harness(invoke);h.context.window.ChatLGBTCore=require('../dist/agent-core.js');
  for(const file of ['agent.js','account.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),h.context);
  h.run('var account=window.BlueGayAccount;saveSettingsToComputer=async()=>{};');return h;
}
const publicAccount={id:'oaiapp_test',name:'Test Student',email:'student@example.test',signedIn:true,planEnabled:true,label:'student@example.test · p_test'};
test('bottom-left account displays verified name and email and settings expose account actions',async()=>{
  const h=setup(async()=>({accounts:[publicAccount],activeId:publicAccount.id,pending:false,message:''}));
  await h.run('account.refresh()');
  assert.equal(h.run("$('#account-name').textContent"),'Test Student');assert.equal(h.run("$('#account-email').textContent"),'student@example.test');
  const html=h.run('account.accountBody()');for(const text of ['Account settings','Continue with ChatGPT','Sign out','Manage ChatGPT usage','OpenAI API key','Use selected account'])assert(html.includes(text));
  assert.equal(h.storage.has('bluegay.agent.settings'),false);
});
test('untrusted account labels are escaped in account settings',()=>{
  const h=setup();h.context.fake={...publicAccount,name:'<img src=x onerror=alert(1)>',email:'<script>bad</script>',label:'<svg onload=bad>'};h.run('account.state.accounts=[fake];account.state.activeId=fake.id');
  const html=h.run('account.accountBody()');assert(!html.includes('<img'));assert(!html.includes('<script>'));assert(html.includes('&lt;img'));
});
test('ChatGPT model catalog never uses another account’s stale result',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>resolve=r));h.context.fake=publicAccount;
  h.run("account.state.accounts=[fake];account.state.activeId=fake.id;chatSettings.provider='chatgpt'");
  const pending=h.run('account.loadModels()');h.run("account.state.activeId='oaiapp_other'");resolve({accountId:publicAccount.id,models:[{id:'wrong-account-model',label:'Wrong account'}]});await pending;
  assert.equal(h.run('availableChatModels().length'),0);
});
test('model failure does not substitute the API model list',async()=>{
  const h=setup(async()=>{throw Error('Account not eligible');});h.context.fake=publicAccount;
  h.run("account.state.accounts=[fake];account.state.activeId=fake.id;chatSettings.provider='chatgpt'");await h.run('account.loadModels()');
  assert.equal(h.run('availableChatModels().length'),0);assert.equal(h.run('account.state.modelError'),'Account not eligible');assert.throws(()=>h.run("validateChatModel('gpt-6.1-sol')"),/Choose a supported model/);
});
test('switching accounts clears old context and preserves a draft',async()=>{
  let selected=publicAccount.id;const calls=[];
  const other={...publicAccount,id:'oaiapp_other',name:'Other Student'};
  const h=setup(async(command,args)=>{calls.push(command);if(command==='chatgpt_select')selected=args.accountId;if(command==='chatgpt_status')return {accounts:[publicAccount,other],activeId:selected,pending:false,message:''};if(command==='chatgpt_models')return {accountId:selected,models:[{id:'gpt-6-luna',label:'Luna'}]};});
  await h.run('account.refresh()');h.run("chat.messages=[{role:'user',text:'old account context'}];chat.attachments=[{id:'old'}];$('#chat-prompt').value='Keep my draft';");
  await h.run("account.switchAccount('oaiapp_other')");
  assert.equal(h.run('chat.messages.length'),0);assert.equal(h.run('chat.attachments.length'),0);assert.equal(h.run("$('#chat-prompt').value"),'Keep my draft');assert.equal(h.run('account.state.activeId'),'oaiapp_other');assert.equal(h.run('chatSettings.provider'),'chatgpt');
  assert(!calls.includes('agent_respond'));
});
test('sign out leaves ChatGPT mode disconnected and never falls back to a key',async()=>{
  let signedIn=true;const h=setup(async command=>{if(command==='chatgpt_logout'){signedIn=false;return {message:'Signed out locally. Remote revocation was not confirmed.'};}if(command==='chatgpt_status')return {accounts:[{...publicAccount,signedIn}],activeId:signedIn?publicAccount.id:null,pending:false,message:''};throw Error('Unexpected API-key fallback');});
  h.run("chatSettings.provider='chatgpt'");await h.run('account.refresh()');await h.run('account.logout()');
  assert.equal(h.run('chatSettings.provider'),'chatgpt');assert.equal(h.run('chat.status.configured'),false);assert.equal(h.run('account.active()'),null);assert.match(h.run('account.state.message'),/Remote revocation/);
});
test('login launches only on an explicit action and preview cannot switch to ChatGPT billing',async()=>{
  const calls=[];const h=setup(async(command,args)=>{calls.push({command,args});if(command==='chatgpt_status')return {accounts:[],activeId:null,pending:true,message:'Finish in browser'};});
  assert.equal(calls.length,0);await h.run('account.login(null)');assert.equal(calls[0].command,'chatgpt_login');assert.equal(calls[0].args.accountId,null);assert.equal(h.run('account.state.pending'),true);
  const preview=setup();await assert.rejects(preview.run("account.provider('chatgpt')"),/Windows desktop app/);assert.equal(preview.run('chatSettings.provider'),'api');
});
test('ChatGPT request uses the selected account and explicit connection mode',async()=>{
  let payload;const h=setup(async(command,args)=>{if(command==='chatgpt_status')return {accounts:[publicAccount],activeId:publicAccount.id,pending:false,message:''};if(command==='agent_respond'){payload=args.payload;throw Error('Synthetic stop');}});
  h.context.AbortController=AbortController;
  h.run("chatSettings.provider='chatgpt';account.state.accounts="+JSON.stringify([publicAccount])+";account.state.activeId='oaiapp_test';account.state.loaded=true;account.state.modelAccountId='oaiapp_test';account.state.models=[{id:'gpt-6.1-sol',label:'Sol'}];$('#chat-prompt').value='Hello';");
  await h.run('sendChatMessage()');assert.equal(payload.auth_provider,'chatgpt');assert.equal(payload.account_id,'oaiapp_test');assert.equal(h.run("$('#chat-prompt').value"),'Hello');
});

test('starting ChatGPT sign-in immediately replaces the stale API-key gate',async()=>{
  const calls=[];const h=setup(async command=>{
    calls.push(command);
    if(command==='chatgpt_status')return {accounts:[],activeId:null,pending:true,message:'Finish in browser'};
    if(command==='agent_status')throw Error('Must not ask for an API key during ChatGPT login');
  });
  h.run("chat.status={configured:false,provider:'api'}");await h.run('account.login(null)');
  assert.equal(h.run('chatSettings.provider'),'chatgpt');assert.equal(h.run('chat.status.provider'),'chatgpt');
  assert.equal(JSON.parse(h.storage.get('bluegay.agent.settings')).provider,'chatgpt');
  assert.equal(JSON.parse(h.storage.get('bluegay.agent.settings')).connectionSelected,true);
  assert(!calls.includes('agent_status'));
});

test('saved signed-in account repairs default API mode and sends with ChatGPT authentication',async()=>{
  let payload;const calls=[];const h=setup(async(command,args)=>{
    calls.push(command);
    if(command==='chatgpt_status')return {accounts:[publicAccount],activeId:publicAccount.id,pending:false,message:''};
    if(command==='chatgpt_models')return {accountId:publicAccount.id,models:[{id:'gpt-6.1-sol',label:'Sol'}]};
    if(command==='agent_respond'){payload=args.payload;throw Error('Synthetic stop');}
    if(command==='agent_status')throw Error('No API key should be requested');
  });
  h.context.AbortController=AbortController;
  await h.run('account.restoreConnection()');
  assert.equal(h.run('chat.status.configured'),true);assert.equal(h.run('chatSettings.provider'),'chatgpt');
  h.run("$('#chat-prompt').value='Hello'");await h.run('sendChatMessage()');
  assert.equal(payload.auth_provider,'chatgpt');assert.equal(payload.account_id,publicAccount.id);
  assert(!calls.includes('agent_status'));
});

test('startup preserves an explicitly selected API connection for a signed-in user',async()=>{
  const h=setup(async command=>{
    if(command==='chatgpt_status')return {accounts:[publicAccount],activeId:publicAccount.id,pending:false,message:''};
    if(command==='agent_status')return {configured:false};
    throw Error('Unexpected '+command);
  });
  h.run("chatSettings.provider='api';chatSettings.connectionSelected=true");
  await h.run('account.restoreConnection()');assert.equal(h.run('chatSettings.provider'),'api');
  assert.equal(h.run('chat.status.configured'),false);
});
