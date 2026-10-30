/* ChatLGBT UI. Model output is always rendered as text, never HTML. */
const chatCore=window.ChatLGBTCore;
// Current general-purpose Responses API models, verified against the official catalog on 2026-10-22.
const chatModels=[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol — balanced'},{id:'gpt-6-astra',label:'GPT-6 Astra — complex reasoning & coding'},{id:'gpt-6-luna',label:'GPT-6 Luna — fast & economical'}];
const chatExternalLinks={billing:'https://platform.openai.com/settings/organization/billing/overview',students:'https://chatgpt.com/codex/offers/students',usage:'https://chatgpt.com/settings/usage',account:'https://chatgpt.com/#settings'};
const chat={messages:[],attachments:[],request:null,epoch:0,lastApplied:null,ready:false,status:null,infoHidden:false};
try{chat.infoHidden=localStorage.getItem('bluegay.agent.infoHidden')==='true';}catch{}
let chatLastEditor=null;
let chatSettings={provider:'api',connectionSelected:false,model:'gpt-6.1-sol',tone:'sparkle',maxOutput:6000};
try{const saved=JSON.parse(localStorage.getItem('bluegay.agent.settings')||'null');if(saved)chatSettings={...chatSettings,provider:saved.provider==='chatgpt'?'chatgpt':'api',model:String(saved.model||chatSettings.model),tone:['sparkle','balanced','quiet'].includes(saved.tone)?saved.tone:'sparkle',maxOutput:[3000,6000,12000].includes(+saved.maxOutput)?+saved.maxOutput:6000};}catch{}

function chatBillingNotice(detailed=false){
  if(chatSettings.provider==='chatgpt')return `<div class="chat-billing-notice"><strong>Using ChatGPT plan</strong><p>Eligible requests use your signed-in ChatGPT account’s allowance. Credit use depends on eligibility and your credit-sharing settings. API-key billing is a separate option.</p><a data-chat-external="usage" href="${chatExternalLinks.usage}" target="_blank" rel="noopener noreferrer">Manage ChatGPT usage & credits ↗</a>${chatStudentOffer()}<span data-chat-link-status role="status"></span></div>`;
  return `<div class="chat-billing-notice"><strong>API-key mode is billed separately from ChatGPT.</strong><p>This agent uses the OpenAI API, billed separately from ChatGPT Plus, Pro, and other ChatGPT plans. You need API credits or an active API billing arrangement.${detailed?' For prepaid accounts, add credits before sending your first message. Each request uses your API balance; cost depends on the model and tokens.':''}</p><a data-chat-external="billing" href="${chatExternalLinks.billing}" target="_blank" rel="noopener noreferrer">Manage API billing & credits ↗</a>${detailed?'<small>Saving a key does not verify your credit balance. BlueGay does not purchase credits or recharge your account.</small>':''}<details class="chat-student-offer"><summary>Students: $100 in Codex credits</summary><p>Eligible university students enrolled and residing in the U.S. or Canada can claim $100 in ChatGPT credits for Codex after student verification. One offer per student; credits expire 12 months after being granted.</p><p>These are Codex credits, not API credits. They do not pay for API-key usage. Connected-app credit use depends on account eligibility and credit-sharing settings.</p><a data-chat-external="students" href="${chatExternalLinks.students}" target="_blank" rel="noopener noreferrer">Register for student credits ↗</a></details><span data-chat-link-status role="status"></span></div>`;
}
function chatStudentOffer(){return `<details class="chat-student-offer"><summary>Students: $100 in Codex credits</summary><p>Eligible university students enrolled and residing in the U.S. or Canada can claim $100 in ChatGPT credits for Codex after verification. One offer per student; credits expire after 12 months.</p><p>These are not API credits. Use in connected apps depends on your account’s eligibility and credit-sharing settings.</p><a data-chat-external="students" href="${chatExternalLinks.students}" target="_blank" rel="noopener noreferrer">Register for student credits ↗</a></details>`;}
async function handleChatExternalLink(event){
  const link=event.target.closest?.('a[data-chat-external]');
  if(!link||!disk.available)return; // Browser previews use the anchor's normal navigation.
  event.preventDefault();
  const target=link.dataset.chatExternal;
  if(!Object.prototype.hasOwnProperty.call(chatExternalLinks,target))return;
  const status=link.closest('.chat-billing-notice')?.querySelector('[data-chat-link-status]');
  if(status)status.textContent='';
  try{await disk.call('open_chat_link',{target});}
  catch(error){const message='Could not open your browser. Open this address manually: '+chatExternalLinks[target];if(status)status.textContent=message;toast(message,'error');}
}
document.addEventListener('click',handleChatExternalLink);
function availableChatModels(){
  if(chatSettings.provider!=='chatgpt')return chatModels;
  const account=window.BlueGayAccount;
  return account?.state.modelAccountId===account?.state.activeId?account?.state.models||[]:[];
}
function chatModelOptions(){
  const models=availableChatModels(),current=models.some(model=>model.id===chatSettings.model);
  return (current?'':`<option value="" disabled selected>Choose a supported model (previous: ${escapeHtml(chatSettings.model)})</option>`)+models.map(model=>`<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`).join('');
}
function validateChatModel(model){if(!availableChatModels().some(item=>item.id===model))throw Error('Choose a supported model in ChatLGBT settings.');}
function ensureChatLGBT(){
  if(chat.ready)return;
  const panel=document.createElement('aside');panel.id='chatlgbt';panel.className='chat-panel';panel.hidden=true;panel.setAttribute('aria-label','ChatLGBT assistant');
  panel.innerHTML=`<div class="chat-heading"><div class="chat-emblem">✦</div><div><strong>ChatLGBT</strong><small>YOUR CODING BESTIE</small></div><button class="icon-button" id="chat-new" title="New chat" aria-label="New chat">＋</button><button class="icon-button" id="chat-settings" title="ChatLGBT settings" aria-label="ChatLGBT settings">⚙</button><button class="icon-button" id="chat-close" aria-label="Close ChatLGBT">×</button></div>
    <div class="chat-model"><span class="local-dot"></span><span id="chat-model-name"></span><button id="chat-info-toggle" aria-controls="chat-info" aria-expanded="true">Hide info</button></div>
    <div id="chat-info">
    <div id="chat-key-required" class="chat-key-required"><strong>Connect ChatLGBT</strong><p>Continue with ChatGPT, or use your own API key with separate API billing.</p><button id="chat-connect" class="primary-button">Account settings</button></div>
    <div id="chat-billing">${chatBillingNotice()}</div></div><div id="chat-messages" class="chat-messages" role="log" aria-label="ChatLGBT conversation" aria-live="off"></div>
    <div id="chat-undo-row" class="chat-undo-row" hidden><span>Accepted edits stay unsaved.</span><button id="chat-undo">Undo last apply</button></div>
    <div class="chat-compose"><div class="chat-attach-tools"><button id="chat-attach-current">＋ Current file</button><button id="chat-attach-selection">Selection</button><button id="chat-search">⌕ Project</button></div><div id="chat-attachments" class="chat-attachments"></div>
    <textarea id="chat-prompt" aria-label="Message ChatLGBT" placeholder="What are we building, bestie?" maxlength="12000" rows="3"></textarea>
    <div class="chat-send-row"><span id="chat-estimate">No files attached</span><button id="chat-stop" class="secondary-button" hidden>Stop</button><button id="chat-send" class="primary-button">Send ↗</button></div>
    <p class="chat-privacy">Sends your message, recent chat and attached code to OpenAI. Review attachments before sending.</p><div id="chat-status" role="status" aria-live="polite"></div></div>`;
  $('.workbench').append(panel);chat.ready=true;
  $('#chat-close').onclick=()=>toggleChatLGBT(false);
  $('#chat-new').onclick=()=>{resetChatLGBT();$('#chat-prompt').value='';};
  $('#chat-settings').onclick=showChatSettings;
  $('#chat-info-toggle').onclick=()=>{chat.infoHidden=!chat.infoHidden;try{localStorage.setItem('bluegay.agent.infoHidden',String(chat.infoHidden));}catch{}renderChatInfo();};
  $('#chat-connect').onclick=()=>window.BlueGayAccount?.open();
  $('#chat-attach-current').onclick=()=>attachChatFile(currentFile());
  $('#chat-attach-selection').onclick=()=>attachChatSelection();
  $('#chat-search').onclick=searchChatContext;
  $('#chat-send').onclick=sendChatMessage;
  $('#chat-stop').onclick=stopChatLGBT;
  $('#chat-undo').onclick=undoChatApply;
  $('#chat-prompt').oninput=updateChatEstimate;
  $('#chat-prompt').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();sendChatMessage();}};
  renderChat();renderChatAttachments();
}
function toggleChatLGBT(force){ensureChatLGBT();const panel=$('#chatlgbt');panel.hidden=typeof force==='boolean'?!force:!panel.hidden;document.body.classList.toggle('chat-open',!panel.hidden);if(!panel.hidden){$('#chat-prompt').focus();refreshChatStatus();}}
function chatNotice(text){if(chat.ready)$('#chat-status').textContent=text;}
function renderChatInfo(){
  if(!chat.ready)return;
  $('#chat-info').hidden=chat.infoHidden;
  const toggle=$('#chat-info-toggle');toggle.textContent=chat.infoHidden?'Show info':'Hide info';toggle.setAttribute('aria-expanded',String(!chat.infoHidden));
}
function stopChatLGBT(){const request=chat.request;if(!request)return;request.stopped=true;request.controller.abort();if(disk.available)disk.call('agent_cancel',{id:request.id}).catch(()=>{});chatNotice('Stopping…');}
function resetChatLGBT(){window.BlueGay?.predictions?.invalidate();stopChatLGBT();chat.epoch++;chat.messages=[];chat.attachments=[];chat.lastApplied=null;if(chat.ready){$('#chat-prompt').value='';renderChat();renderChatAttachments();}}
function renderChatText(container,text){
  // A deliberately small renderer: fenced code and prose, with no HTML or remote embeds.
  const blocks=/```([^\n`]*)\n([\s\S]*?)```/g;let offset=0,match;
  const prose=value=>{const span=document.createElement('span');span.textContent=value;container.append(span);};
  while((match=blocks.exec(text))){prose(text.slice(offset,match.index));const pre=document.createElement('pre');pre.className='chat-code';const code=document.createElement('code');code.textContent=match[2];pre.append(code);container.append(pre);offset=blocks.lastIndex;}
  prose(text.slice(offset));
}
function renderChat(){
  if(!chat.ready)return;
  const root=$('#chat-messages'),scrollTop=root.scrollTop;const nearBottom=root.scrollHeight-root.scrollTop-root.clientHeight<100;
  root.replaceChildren();
  if(!chat.messages.length){
    root.innerHTML='<div class="chat-welcome"><div class="chat-sparkle">✦</div><span class="eyebrow">A LITTLE PRIDE. A LOT OF CODE.</span><h2>Omg yesss,<br>let’s build. 💅</h2><p>I’m ChatLGBT, your coding bestie. Attach some code and we’ll make it slay.</p><div class="chat-ideas"><button data-chat-idea="explain">◇ Explain this file</button><button data-chat-idea="bugs">⌕ Look for bugs</button><button data-chat-idea="refactor">✦ Refactor my selection</button></div><small>You choose the context.<br>You approve every change.</small></div>';
    root.querySelectorAll('[data-chat-idea]').forEach(button=>button.onclick=()=>{if(button.dataset.chatIdea==='refactor')attachChatSelection();else attachChatFile(currentFile());$('#chat-prompt').value=({explain:'Explain how this code works.',bugs:'Look for bugs in the attached code and propose fixes.',refactor:'Refactor the selected code for clarity while preserving its behavior.'})[button.dataset.chatIdea];updateChatEstimate();$('#chat-prompt').focus();});
  }
  chat.messages.forEach(message=>{
    const block=document.createElement('article');block.className='chat-message '+message.role;
    const label=document.createElement('div');label.className='chat-author';label.textContent=message.role==='user'?'YOU':'✦ ChatLGBT';block.append(label);
    const text=document.createElement('div');text.className='chat-text';renderChatText(text,message.role==='assistant'?chatCore.visibleReply(message.text):message.text);block.append(text);
    if(message.context?.length){const note=document.createElement('small');note.className='chat-context-note';note.textContent='Context: '+message.context.join(', ');block.append(note);}
    if(message.error){const note=document.createElement('p');note.className='chat-error';note.textContent=message.error;block.append(note);}
    if(message.edits?.length){
      const box=document.createElement('div');box.className='chat-proposal';
      const title=document.createElement('strong');title.textContent=`${message.edits.length} proposed file${message.edits.length===1?'':'s'}`;box.append(title);
      for(const edit of message.edits){const name=document.createElement('div');name.textContent=(edit.before===null?'＋ ':'↔ ')+edit.path;box.append(name);}
      if(!message.resolution){const review=document.createElement('button');review.className='secondary-button';review.textContent='Review changes';review.onclick=()=>reviewChatProposal(message);const reject=document.createElement('button');reject.className='chat-text-button';reject.textContent='Reject';reject.onclick=()=>{message.resolution='Rejected';renderChat();};box.append(review,reject);}else{const result=document.createElement('small');result.textContent=message.resolution;box.append(result);}
      block.append(box);
    }
    if(message.usage){const usage=document.createElement('small');usage.className='chat-context-note';usage.textContent=`${message.usage.input_tokens||0} input · ${message.usage.output_tokens||0} output tokens`;block.append(usage);}
    root.append(block);
  });
  $('#chat-model-name').textContent=chatSettings.model;
  $('#chat-send').disabled=!!chat.request;$('#chat-send').textContent=chat.status?.configured===false?'Connect account':'Send ↗';$('#chat-stop').hidden=!chat.request;
  $('#chat-billing').innerHTML=chatBillingNotice();
  renderChatInfo();
  $('#chat-undo-row').hidden=!chat.lastApplied;
  root.scrollTop=!chat.messages.length?0:nearBottom?root.scrollHeight:scrollTop;
}
function attachChatFile(file){
  if(!file)return toast('Open a file first.','info');
  ensureChatLGBT();try{chatCore.snapshot(file);chat.attachments=chat.attachments.filter(a=>a.id!==file.id);chat.attachments.push({id:file.id,path:file.path});renderChatAttachments();}catch(error){chatNotice(error.message);}
}
function attachChatSelection(ed=chatLastEditor===splitEditor&&!splitVisible?editor:chatLastEditor||focusedEditor()){
  const model=ed?.getModel(),selection=ed?.getSelection();
  const file=files.find(f=>models.get(f.id)===model);
  if(!file||!selection||selection.isEmpty())return toast('Select some code in the editor first.','info');
  try{const bom=file.content.charCodeAt(0)===0xfeff?1:0;const snap=chatCore.snapshot(file,{start:model.getOffsetAt(selection.getStartPosition())+bom,end:model.getOffsetAt(selection.getEndPosition())+bom});ensureChatLGBT();chat.attachments=chat.attachments.filter(a=>a.id!==file.id);chat.attachments.push(snap);renderChatAttachments();}catch(error){chatNotice(error.message);}
}
function collectChatAttachments(){return chat.attachments.map(item=>{const file=files.find(f=>f.id===item.id&&f.path===item.path);if(!file)throw Error(`${item.path} is no longer open. Remove that attachment.`);if(item.selection){if(file.content!==item.base)throw Error(`${item.path} changed. Select and attach the code again.`);return item;}return chatCore.snapshot(file);});}
function renderChatAttachments(){
  if(!chat.ready)return;
  const root=$('#chat-attachments');root.replaceChildren();
  chat.attachments.forEach(item=>{const button=document.createElement('button');button.className='chat-chip';button.textContent=(item.selection?'Selection · ':'')+item.path+' ×';button.title='Remove '+item.path;button.onclick=()=>{chat.attachments=chat.attachments.filter(a=>a!==item);renderChatAttachments();};root.append(button);});
  updateChatEstimate();
}
function updateChatEstimate(){if(!chat.ready)return;try{const attachments=collectChatAttachments();const payload=chatCore.buildRequest({prompt:$('#chat-prompt').value.trim()||'Hello',attachments,history:chat.messages.filter(m=>!m.error&&!m.failed).map(m=>({role:m.role,text:m.role==='assistant'?chatCore.visibleReply(m.text):m.text})),...chatSettings});$('#chat-estimate').textContent=`~${Math.ceil(JSON.stringify(payload).length/4).toLocaleString()} input tokens · estimate`;}catch(error){$('#chat-estimate').textContent='Context needs attention';}}
function searchChatContext(){
  openModal('<div class="modal-header"><h2>Attach project context</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body"><p>Search filenames or code locally. Only files you attach are sent.</p><input id="chat-context-query" aria-label="Search project context" placeholder="Filename, function, or text…"><div id="chat-context-results" class="chat-context-results"></div></div>');
  const input=$('#chat-context-query');
  const draw=()=>{const q=input.value.toLowerCase();const matches=files.filter(f=>!f.unsupported&&!chatCore.sensitivePath(f.path)&&(f.path.toLowerCase().includes(q)||f.content.toLowerCase().includes(q))).slice(0,40);const results=$('#chat-context-results');results.replaceChildren();for(const file of matches){const button=document.createElement('button');button.className='chat-context-file';button.textContent=(chat.attachments.some(a=>a.id===file.id)?'✓ ':'＋ ')+file.path;button.onclick=()=>{attachChatFile(file);draw();};results.append(button);}if(!matches.length)results.textContent='No matching files.';};input.oninput=draw;draw();input.focus();
}
async function refreshChatStatus(){
  if(chatSettings.provider==='chatgpt'){
    try{const accounts=window.BlueGayAccount;if(!accounts||!disk.available)throw Error('ChatGPT sign-in requires the Windows desktop app.');await accounts.refresh();const account=accounts.active();chat.status={configured:!!account?.planEnabled,provider:'chatgpt',accountId:account?.id};if(chat.ready){$('#chat-key-required').hidden=chat.status.configured;$('#chat-send').textContent=chat.status.configured?'Send ↗':'Connect account';$('#chat-billing').innerHTML=chatBillingNotice();}chatNotice(account?.planEnabled?'Using ChatGPT plan. Manage limits and credit sharing in Account settings.':account?'Enable ChatGPT plan usage in Account settings.':'Sign in with ChatGPT in Account settings.');return chat.status;}catch(error){chat.status={configured:false,provider:'chatgpt'};chatNotice(error.message||String(error));return null;}
  }
  try{const status=disk.available?await disk.call('agent_status'):await fetch('/api/chatlgbt/status').then(r=>{if(!r.ok)throw Error('Restart the preview server to enable ChatLGBT.');return r.json();});chat.status=status;if(chat.ready){$('#chat-key-required').hidden=!!status.configured;$('#chat-send').textContent=status.configured?'Send ↗':'Enter API key';}chatNotice(status.configured?'API key connected. API credits/billing required; balance not checked.':'API key and API credits required. Select Enter API key to connect ChatLGBT.');return status;}catch(error){chatNotice(error.message||String(error));return null;}
}
async function sendChatMessage(){
  if(chat.request)return;
  if(chat.status?.configured===false){if(chatSettings.provider==='chatgpt')window.BlueGayAccount?.open();else showChatSettings();return;}
  const prompt=$('#chat-prompt').value.trim();if(!prompt)return;
  try{validateChatModel(chatSettings.model);}catch(error){showChatSettings();$('#chat-settings-status').textContent=error.message;return;}
  let attachments,payload;
  try{attachments=collectChatAttachments();payload=chatCore.buildRequest({prompt,attachments,history:chat.messages.filter(m=>!m.error&&!m.failed).map(m=>({role:m.role,text:m.role==='assistant'?chatCore.visibleReply(m.text):m.text})),...chatSettings});if(chatSettings.provider==='chatgpt'){payload.auth_provider='chatgpt';payload.account_id=window.BlueGayAccount?.state.activeId||'';}}catch(error){chatNotice(error.message);return;}
  const request={id:uid(),epoch:chat.epoch,controller:new AbortController(),stopped:false};chat.request=request;renderChat();
  const reply={role:'assistant',text:''};const userMessage={role:'user',text:prompt,context:attachments.map(a=>a.path+(a.selection?' (selection)':''))};let completed=false,streamError=null;
  try{
    const status=await refreshChatStatus();if(request.stopped||request.epoch!==chat.epoch)return;
    if(!status)throw Error('Cannot connect to the local AI service. Restart the preview server and try again.');
    if(!status.configured){if(chatSettings.provider==='chatgpt')window.BlueGayAccount?.open();else showChatSettings();return;}
    const allPaths=files.map(f=>f.path);
    chat.messages.push(userMessage,reply);$('#chat-prompt').value='';renderChat();chatNotice('ChatLGBT is thinking…');
    const parser=chatCore.createSSE(event=>{
      if(request.stopped||request.epoch!==chat.epoch)return;
      if(event.type==='response.output_text.delta'||event.type==='response.refusal.delta'){reply.text+=event.delta||'';if(reply.text.length>chatCore.MAX_OUTPUT)throw Error('Response too large. Ask for a smaller change.');renderChat();chatNotice('ChatLGBT is writing…');}
      if(event.type==='response.completed'){completed=true;reply.usage=event.response?.usage;}
      if(['error','response.failed','response.incomplete'].includes(event.type)){streamError??=chatCore.responseFailure(event);reply.usage=event.response?.usage;}
    });
    if(disk.available){
      let parseFailure;
      const unlisten=await window.__TAURI__.event.listen('chatlgbt-chunk',event=>{if(event.payload.id===request.id&&!parseFailure)try{parser.push(new Uint8Array(event.payload.chunk));}catch(error){parseFailure=error;disk.call('agent_cancel',{id:request.id}).catch(()=>{});}});
      try{if(!request.stopped)await disk.call('agent_respond',{id:request.id,payload});if(parseFailure)throw parseFailure;}finally{unlisten();}
    }else{
      const response=await fetch('/api/chatlgbt/respond',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Agent':status.token},body:JSON.stringify(payload),signal:request.controller.signal});
      if(!response.ok){const error=await response.json();throw Error(error.error||'Request failed.');}
      const reader=response.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;parser.push(value);}}finally{reader.releaseLock();}
    }
    if(request.stopped||request.epoch!==chat.epoch)return;
    parser.finish();if(streamError)throw Error(streamError);if(!completed)throw Error('The connection ended early. No edits are available from this response.');
    reply.edits=chatCore.parseProposal(reply.text,attachments,allPaths);reply.epoch=request.epoch;
    chatNotice(reply.edits.length?'Changes are ready to review.':'Done, bestie. 💅');
  }catch(error){if(request.epoch===chat.epoch){reply.error=request.stopped?'Stopped. No proposed edits were applied.':streamError||error.message||String(error);reply.edits=[];chatNotice(reply.error);}}
  finally{request.controller.abort();if(request.epoch===chat.epoch){if(request.stopped){reply.error='Stopped. No proposed edits were applied.';reply.edits=[];chatNotice(reply.error);}if(reply.error){userMessage.failed=true;if(!$('#chat-prompt').value)$('#chat-prompt').value=prompt;}}if(chat.request===request)chat.request=null;renderChat();updateChatEstimate();}
}
function reviewChatProposal(message){
  if(message.resolution||message.epoch!==chat.epoch)return;
  try{chatCore.validateCurrent(message.edits,files,explicitFolders);}catch(error){chatNotice(error.message);return;}
  openModal('<div class="modal-header"><h2>Review ChatLGBT changes</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="chat-review-toolbar"><select id="chat-review-file" aria-label="Review proposed file"></select><span>Original → Proposed</span></div><div class="diff-shell" id="chat-diff"></div><div class="chat-review-footer"><span>Accept changes into the editor. Save to disk separately.</span><button id="chat-reject" class="secondary-button">Reject</button><button id="chat-accept" class="primary-button">Accept all changes</button></div>','diff-modal');
  const select=$('#chat-review-file');message.edits.forEach((edit,i)=>{const option=document.createElement('option');option.value=i;option.textContent=edit.path+(edit.before===null?' (new)':'');select.append(option);});
  const diff=monaco.editor.createDiffEditor($('#chat-diff'),{...editorOptions(),readOnly:true,originalEditable:false,renderSideBySide:innerWidth>900,minimap:{enabled:false}});let original,modified;
  diff.onDidUpdateDiff(()=>{const change=diff.getLineChanges()?.[0];if(change)diff.getModifiedEditor().revealLineInCenter(Math.max(1,change.modifiedStartLineNumber));});
  const draw=()=>{const edit=message.edits[+select.value];diff.setModel(null);original?.dispose();modified?.dispose();const language=languageFor({path:edit.path,content:edit.after});original=monaco.editor.createModel(edit.before||'',language);modified=monaco.editor.createModel(edit.after,language);diff.setModel({original,modified});};select.onchange=draw;draw();modalCleanup=()=>{diff.dispose();original?.dispose();modified?.dispose();};
  $('#chat-reject').onclick=()=>{message.resolution='Rejected';closeModal();renderChat();};
  $('#chat-accept').onclick=()=>{try{applyChatProposal(message);closeModal();}catch(error){chatNotice(error.message);toast(error.message,'error');}};
}
function applyChatProposal(message){
  if(message.resolution||message.epoch!==chat.epoch)throw Error('This proposal is no longer active.');
  chatCore.validateCurrent(message.edits,files,explicitFolders);
  if(message.edits.some(edit=>files.find(f=>f.id===edit.id)?.saving))throw Error('Wait for the current save to finish, then accept again.');
  // Prepare models before mutating any document. Capture one checkpoint per file.
  const prepared=message.edits.map(edit=>{const file=files.find(f=>f.id===edit.id);return {edit,file,history:file?[...file.history]:null,pending:file?.aiPendingSave,model:edit.before!==null?modelFor(file):null};});
  clearTimeout(saveTimer);const wasPaused=nativePaused;nativePaused=true;
  const applied=[];
  try{
    for(const {edit,file,model}of prepared){
      let target=file;
      if(target){target.history.unshift({at:Date.now(),content:target.content});target.history=target.history.slice(0,20);target.aiPendingSave=true;model.pushStackElement();model.pushEditOperations([],[{range:model.getFullModelRange(),text:edit.after}],()=>null);model.pushStackElement();}
      else{target=newFile(edit.path,edit.after);if(!target)throw Error('Could not create '+edit.path);target.saved='';target.baseline='';target.aiPendingSave=true;}
      applied.push({...edit,id:target.id,after:target.content});
    }
  }catch(error){
    for(const item of prepared){if(item.file){item.file.content=item.edit.before;item.model.setValue(item.edit.before);item.file.history=item.history;item.file.aiPendingSave=item.pending;}else{const created=files.find(f=>f.path===item.edit.path);if(created)removeWorkspaceFile(created);}}
    persist();refreshFileUI();throw error;
  }finally{clearTimeout(saveTimer);nativePaused=wasPaused;}
  chat.lastApplied={edits:applied,epoch:chat.epoch};message.resolution='Accepted · unsaved';persist();refreshFileUI();renderChat();chatNotice('Slay! Changes accepted. Review your code, then Ctrl+S to save.');
}
function undoChatApply(){
  const batch=chat.lastApplied;if(!batch||batch.epoch!==chat.epoch)return;
  for(const edit of batch.edits){const file=files.find(f=>f.id===edit.id&&f.path===edit.path);if(!file||file.content!==edit.after||file.saving)return chatNotice('A changed file was edited again. Use editor Undo or File History instead.');if(edit.before===null&&file.disk?.version)return chatNotice('A new file has already been saved to disk. Remove it from Explorer if desired.');}
  clearTimeout(saveTimer);const wasPaused=nativePaused;nativePaused=true;
  try{for(const edit of batch.edits){const file=files.find(f=>f.id===edit.id);if(edit.before===null)removeWorkspaceFile(file);else{file.aiPendingSave=true;const model=modelFor(file);model.pushStackElement();model.pushEditOperations([],[{range:model.getFullModelRange(),text:edit.before}],()=>null);model.pushStackElement();}}}finally{clearTimeout(saveTimer);nativePaused=wasPaused;}
  chat.lastApplied=null;persist();refreshFileUI();renderChat();chatNotice('Last accepted changes undone in the editor.');
}
async function updateChatKey(key){
  window.BlueGay?.predictions?.invalidate();
  if(disk.available)return key===null?disk.call('agent_delete_key'):disk.call('agent_set_key',{key});
  const status=await refreshChatStatus();if(!status)throw Error('Restart the preview server to enable key setup.');
  const response=await fetch('/api/chatlgbt/key',{method:key===null?'DELETE':'POST',headers:{'Content-Type':'application/json','X-BlueGay-Agent':status.token},body:JSON.stringify(key===null?{}:{key})});
  if(!response.ok){const result=await response.json();throw Error(result.error||'Could not update the session key.');}
}
function showChatSettings(){
  ensureChatLGBT();
  const usesChatGPT=chatSettings.provider==='chatgpt';
  openModal(`<div class="modal-header"><h2>ChatLGBT settings</h2><button class="icon-button" data-action="closeModal">×</button></div><form id="chat-settings-form" class="modal-body chat-settings-form"><div class="chat-connection-row"><button type="button" id="chat-account-settings" class="secondary-button">${usesChatGPT?'ChatGPT account & connection':'Continue with ChatGPT / Account settings'}</button></div><div class="chat-key-guidance" ${usesChatGPT?'hidden':''}><strong>${chat.status?.configured?'API key connected':'Enter your OpenAI API key to start'}</strong><p>API-key mode requires your own API key. Your message stays here until you connect and press Send.</p></div>${chatBillingNotice(true)}<label ${usesChatGPT?'hidden':''}>API key<input id="chat-api-key" type="password" autocomplete="off" placeholder="${chat.status?.configured?'Leave blank to keep current key':'Paste your OpenAI API key'}"></label><label>OpenAI model<select id="chat-model-input" required aria-describedby="chat-model-help">${chatModelOptions()}</select></label><p id="chat-model-help">${usesChatGPT?'Models available to your signed-in ChatGPT account.':'Current text and coding models supported by ChatLGBT. Availability depends on your API account.'}</p><label>Personality<select id="chat-tone"><option value="sparkle">Full sparkle 💅</option><option value="balanced">A little sparkle</option><option value="quiet">Keep it concise</option></select></label><label ${usesChatGPT?'hidden':''}>Maximum output tokens<select id="chat-limit"><option value="3000">3,000 — smaller replies</option><option value="6000">6,000 — balanced</option><option value="12000">12,000 — larger changes</option></select></label><p>${usesChatGPT?'Using ChatGPT plan. The service manages response length; ask for a smaller change when needed.':'Model access and API billing depend on your OpenAI account. Token estimates are approximate; the output limit includes reasoning tokens.'}</p><p ${usesChatGPT?'hidden':''}>${disk.available?'Saved in Windows Credential Manager.':'Held only in the local preview server until it stops.'} Never stored in settings.json or browser preferences. Used for chats and code prediction when enabled.</p><button type="button" ${usesChatGPT?'hidden':''} id="chat-delete-key" class="secondary-button">${disk.available?'Remove stored key':'Clear session key'}</button><div id="chat-settings-status" role="status"></div><div class="modal-footer"><button type="button" class="secondary-button" data-action="closeModal">Cancel</button><button type="submit" class="primary-button">Save settings</button></div></form>`);
  $('#chat-account-settings').onclick=()=>window.BlueGayAccount?.open();
  $('#chat-model-input').value=availableChatModels().some(model=>model.id===chatSettings.model)?chatSettings.model:'';
  if(usesChatGPT){const select=$('#chat-model-input'),help=$('#chat-model-help');select.disabled=true;help.textContent='Loading your ChatGPT models…';window.BlueGayAccount?.loadModels().then(()=>{if($('#chat-model-input')!==select)return;select.innerHTML=chatModelOptions();select.value=availableChatModels().some(m=>m.id===chatSettings.model)?chatSettings.model:'';select.disabled=false;help.textContent=window.BlueGayAccount.state.modelError||'Models available to your signed-in ChatGPT account.';});}
  if(!usesChatGPT&&chat.status?.configured===false)$('#chat-api-key').focus();
  $('#chat-tone').value=chatSettings.tone;$('#chat-limit').value=chatSettings.maxOutput;
  $('#chat-delete-key').onclick=async()=>{try{await updateChatKey(null);$('#chat-settings-status').textContent='Key removed. An environment key, if set, still applies.';refreshChatStatus();}catch(error){$('#chat-settings-status').textContent=String(error);}};
  $('#chat-settings-form').onsubmit=async event=>{event.preventDefault();const settings={provider:chatSettings.provider,connectionSelected:chatSettings.connectionSelected,model:$('#chat-model-input').value.trim(),tone:$('#chat-tone').value,maxOutput:+$('#chat-limit').value};try{validateChatModel(settings.model);chatCore.buildRequest({prompt:'check',attachments:[],...settings});const input=$('#chat-api-key'),key=input.value;input.value='';if(!usesChatGPT&&key.trim())await updateChatKey(key);localStorage.setItem('bluegay.agent.settings',JSON.stringify(settings));chatSettings=settings;window.BlueGay?.predictions?.invalidate();await saveSettingsToComputer();closeModal();renderChat();refreshChatStatus();}catch(error){$('#chat-settings-status').textContent=error.message||String(error);}};
}
function installChatEditorActions(ed){ed.onDidFocusEditorText(()=>{chatLastEditor=ed;});ed.addAction({id:'chatlgbt.ask',label:'Ask ChatLGBT about selection',contextMenuGroupId:'9_chatlgbt',contextMenuOrder:1,run:()=>{attachChatSelection(ed);toggleChatLGBT(true);$('#chat-prompt').value='Explain the selected code.';updateChatEstimate();}});ed.addAction({id:'chatlgbt.edit',label:'Edit selection with ChatLGBT',contextMenuGroupId:'9_chatlgbt',contextMenuOrder:2,run:()=>{attachChatSelection(ed);toggleChatLGBT(true);$('#chat-prompt').value='Refactor the selected code for clarity.';updateChatEstimate();}});}
window.addEventListener('bluegay-ready',()=>{ensureChatLGBT();installChatEditorActions(editor);},{once:true});
