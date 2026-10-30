/* ChatGPT account UI. Native commands return display data only, never tokens. */
window.BlueGayAccount=(()=>{
  const state={accounts:[],activeId:null,pending:false,message:'',error:'',models:[],modelAccountId:null,modelError:'',busy:false,loaded:false};
  let pollTimer=null,dialogOpen=false,modelRevision=0;
  const active=()=>state.accounts.find(a=>a.id===state.activeId&&a.signedIn)||null;
  const errorText=error=>error?.message||String(error);
  function render(){
    const account=active(),name=account?.name||account?.email||'Sign in to ChatGPT';
    const initials=account?(account.name||account.email||'CG').split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase():'○';
    for(const selector of ['#account-avatar','#account-compact']){const el=$(selector);if(el)el.textContent=initials;}
    if($('#account-name'))$('#account-name').textContent=name;
    if($('#account-email'))$('#account-email').textContent=account?.email||(state.pending?'Waiting for browser…':'Account settings');
    for(const selector of ['#account-button','#account-compact']){const el=$(selector);if(el){el.title=account?`${name}${account.email?' · '+account.email:''} — Account settings`:'Sign in with ChatGPT';el.setAttribute('aria-label',el.title);}}
  }
  function clearContext(){const draft=$('#chat-prompt')?.value||'';resetChatLGBT();if($('#chat-prompt'))$('#chat-prompt').value=draft;}
  async function refresh(){
    if(!disk.available){state.loaded=true;render();return state;}
    try{
      const result=await disk.call('chatgpt_status');
      if(!Array.isArray(result.accounts))throw Error('Could not read account status.');
      if(state.activeId!==result.activeId){modelRevision++;state.models=[];state.modelAccountId=null;state.modelError='';if(state.loaded)clearContext();}
      Object.assign(state,result,{loaded:true,error:''});render();return state;
    }catch(error){state.error=errorText(error);throw error;}
  }
  async function loadModels(){
    const account=active();state.models=[];state.modelAccountId=null;state.modelError='';
    const revision=++modelRevision;
    if(!account?.planEnabled)return [];
    try{
      const result=await disk.call('chatgpt_models',{accountId:account.id});
      if(revision!==modelRevision||state.activeId!==account.id||result.accountId!==account.id)return [];
      state.models=result.models.map(m=>({id:m.id,label:m.label}));state.modelAccountId=account.id;
      if(!state.models.length)state.modelError='No eligible models are available for this ChatGPT account.';
    }catch(error){if(revision===modelRevision)state.modelError=errorText(error);}
    return state.models;
  }
  async function provider(mode){
    if(!['api','chatgpt'].includes(mode))throw Error('Choose a connection method.');
    if(chat.request)throw Error('Stop the current response before changing accounts or billing.');
    if(mode==='chatgpt'&&!disk.available)throw Error('ChatGPT sign-in is available in the Windows desktop app.');
    chatSettings.provider=mode;chatSettings.connectionSelected=true;chat.status=null;
    localStorage.setItem('bluegay.agent.settings',JSON.stringify(chatSettings));await saveSettingsToComputer();
    if(mode==='chatgpt')await loadModels();
    await refreshChatStatus();renderChat();render();
  }
  function accountBody(){
    const account=active(),disabled=state.busy||state.pending;
    return `<div class="modal-header"><h2>Account settings</h2><button class="icon-button" data-action="closeModal" aria-label="Close account settings">×</button></div><div class="modal-body account-settings" id="account-settings">
      <div class="account-profile"><span class="account-profile-avatar">${escapeHtml(account?(account.name||account.email||'C').slice(0,1).toUpperCase():'○')}</span><div><h3>${escapeHtml(account?.name||'Your ChatGPT account')}</h3><p>${escapeHtml(account?.email||'Sign in to connect your account to BlueGay.')}</p></div></div>
      <p>Use your ChatGPT plan for eligible ChatLGBT requests. Available credits require account eligibility and credit sharing in ChatGPT settings.</p>
      ${!disk.available?'<p class="info-note">Open the Windows desktop app to sign in with ChatGPT. Browser preview supports API-key access.</p>':''}
      <div class="account-actions"><button type="button" class="chatgpt-signin" id="account-signin" ${disabled||!disk.available?'disabled':''}>Continue with ChatGPT</button>${state.pending?'<button type="button" class="secondary-button" id="account-cancel">Cancel sign-in</button>':''}</div>
      ${account&&!account.planEnabled?'<p class="info-note">You are signed in, but ChatGPT plan usage is not enabled.</p><button type="button" class="secondary-button" id="account-enable" '+(disabled?'disabled':'')+'>Enable ChatGPT plan usage</button>':''}
      ${state.accounts.length?`<label>Saved accounts<select id="account-picker" ${disabled?'disabled':''}>${state.accounts.map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===state.activeId?'selected':''}>${escapeHtml(a.label)}${a.signedIn?'':' — signed out'}</option>`).join('')}</select></label><button type="button" class="secondary-button" id="account-switch" ${disabled?'disabled':''}>Use selected account</button>`:''}
      <label>ChatLGBT connection<select id="account-provider" ${disabled?'disabled':''}><option value="chatgpt" ${chatSettings.provider==='chatgpt'?'selected':''} ${!disk.available?'disabled':''}>ChatGPT plan</option><option value="api" ${chatSettings.provider!=='chatgpt'?'selected':''}>OpenAI API key — billed separately</option></select></label>
      <div class="account-links chat-billing-notice"><strong>${chatSettings.provider==='chatgpt'?'Using ChatGPT plan':'Using API-key billing'}</strong><p>${chatSettings.provider==='chatgpt'?'Requests use this account’s eligible allowance and credits. BlueGay will not switch to API billing if access fails.':'API usage is separate from your ChatGPT allowance and credits.'}</p><a data-chat-external="usage" href="${chatExternalLinks.usage}" target="_blank" rel="noopener noreferrer">Manage ChatGPT usage & credits ↗</a><br><a data-chat-external="account" href="${chatExternalLinks.account}" target="_blank" rel="noopener noreferrer">Open ChatGPT account settings ↗</a><span data-chat-link-status role="status"></span></div>
      <div class="account-actions"><button type="button" class="secondary-button" id="account-chat-settings">Model & API settings</button>${account?'<button type="button" class="secondary-button" id="account-signout" '+(disabled?'disabled':'')+'>Sign out</button>':''}</div>
      <p class="account-security">Sign-in opens in your browser. Credentials are encrypted for your Windows account. Signing out here keeps your saved account entry; disconnect BlueGay in ChatGPT settings to remove its authorization.</p>
      <div id="account-status" role="status" aria-live="polite">${escapeHtml(state.error||state.message)}</div></div>`;
  }
  function show(){
    openModal(accountBody(),'account-modal');dialogOpen=true;modalCleanup=()=>{dialogOpen=false;};
    const bind=(id,action)=>{const el=$(id);if(el)el.onclick=()=>run(action);};
    bind('#account-signin',()=>login(null));
    bind('#account-enable',()=>login(state.activeId,true));
    bind('#account-cancel',()=>disk.call('chatgpt_cancel'));
    bind('#account-switch',()=>switchAccount($('#account-picker').value));
    bind('#account-signout',()=>logout());
    bind('#account-chat-settings',()=>showChatSettings());
    if($('#account-provider'))$('#account-provider').onchange=event=>run(()=>provider(event.target.value));
  }
  async function run(action){
    if(state.busy)return;state.busy=true;state.error='';
    try{await action();}catch(error){state.error=errorText(error);}
    finally{state.busy=false;render();if(dialogOpen)show();}
  }
  async function open(){show();await run(async()=>{await refresh();});}
  async function login(id,consent=false){
    if(chat.request)throw Error('Stop the current response before signing in.');
    if(!disk.available)throw Error('ChatGPT sign-in requires the Windows desktop app.');
    await disk.call('chatgpt_login',{accountId:id,consent});await refresh();
    // Selecting sign-in also selects its connection, even while the browser is
    // pending. Do not leave the chat gated by the previous API-key status.
    try{await provider('chatgpt');}finally{schedulePoll();}
  }
  function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(pollLogin,1000);}
  async function pollLogin(){
    try{
      await refresh();
      if(state.pending){if(dialogOpen)show();schedulePoll();return;}
      if(active()&&state.message.startsWith('Signed in.')){
        clearContext();await provider('chatgpt');
        const welcomeKey='bluegay.chatgpt.welcomed.'+state.activeId;
        if(active().planEnabled&&!localStorage.getItem(welcomeKey)){
          openModal('<div class="modal-header"><h2>You’re using your ChatGPT plan</h2></div><div class="modal-body"><p>Eligible ChatLGBT requests use your ChatGPT plan. Manage usage and credit sharing in ChatGPT settings.</p><button class="primary-button" id="account-welcome-done">Got it</button></div>');
          $('#account-welcome-done').onclick=()=>{localStorage.setItem(welcomeKey,'true');show();};return;
        }
      }
      if(dialogOpen)show();
    }catch(error){state.error=errorText(error);if(dialogOpen)show();if(state.pending)schedulePoll();}
  }
  async function switchAccount(id){
    if(chat.request)throw Error('Stop the current response before changing accounts.');
    const account=state.accounts.find(a=>a.id===id);if(!account)throw Error('Select an account.');
    if(!account.signedIn)return login(id);
    await disk.call('chatgpt_select',{accountId:id});await refresh();clearContext();await provider('chatgpt');
  }
  async function logout(){
    const id=state.activeId;if(!id)return;stopChatLGBT();
    const result=await disk.call('chatgpt_logout',{accountId:id});clearContext();await refresh();
    state.models=[];state.modelAccountId=null;await refreshChatStatus();state.message=result.message;
  }
  async function restoreConnection(){
    await refresh();
    // Migrate accounts saved by versions that left the default API mode active
    // after sign-in. Preserve a connection explicitly selected by the user.
    if(active()&&!chatSettings.connectionSelected)await provider('chatgpt');
    else{if(chatSettings.provider==='chatgpt')await loadModels();await refreshChatStatus();}
  }
  async function init(){
    const footer=document.createElement('div');footer.className='account-strip';footer.innerHTML='<button id="account-button" class="account-button" aria-label="Sign in with ChatGPT"><span id="account-avatar" class="account-avatar">○</span><span class="account-label"><strong id="account-name">Sign in to ChatGPT</strong><small id="account-email">Account settings</small></span><span aria-hidden="true">⌃</span></button>';
    $('#sidebar').append(footer);$('#account-button').onclick=open;
    const compact=document.createElement('button');compact.id='account-compact';compact.setAttribute('aria-label','Account settings');compact.textContent='○';compact.onclick=open;$('.activity-bottom').append(compact);
    try{await restoreConnection();}catch(error){state.error=errorText(error);render();}
  }
  window.addEventListener('bluegay-ready',init,{once:true});
  return {state,active,refresh,loadModels,provider,open,login,switchAccount,logout,render,accountBody,restoreConnection};
})();
