/* Code Together: native transport, live workspace sync, permissions and presence. */
const together = window.BlueGayTogether = {
  mode:null, code:'', permissions:{write:false,createDelete:false,console:false},
  connected:false, busy:false, leaving:false, epoch:0, previous:null, members:[], decorations:new Map(),
  id:crypto.randomUUID(), name:'', color:Math.floor(Math.random()*6)
};
const togetherNative = (command,args={}) => window.__TAURI__.core.invoke(command,args);
const togetherRemote = (operation,args={}) => togetherNative('together_request',{code:together.code,operation,args});
function togetherReadOnly() { return together.mode==='guest' && (!together.connected || !together.permissions.write); }
function togetherAllowed(manage=false) {
  if (!together.mode || together.mode==='host') return true;
  const allowed = together.connected && together.permissions.write && (!manage || together.permissions.createDelete);
  if (!allowed) toast(!together.connected?'Disconnected. Reconnect to edit the shared project.':manage?'The host has disabled creating, renaming and deleting files.':'The host has made this session read only.','error');
  return allowed;
}
function togetherOptions() {
  window.BlueGayDebugger?.permissionsChanged();
  editor?.updateOptions({readOnly:!!currentFile()?.previewOnly||togetherReadOnly()});
  splitEditor?.updateOptions({readOnly:!!currentFile()?.previewOnly||togetherReadOnly()});
  document.querySelector('[data-action="codeTogether"]')?.classList.toggle('active',!!together.mode);
}
function togetherPresence() {
  const ed = typeof focusedEditor==='function' ? focusedEditor() : editor;
  const uri = ed?.getModel()?.uri?.toString();
  const file = files.find(f=>models.get(f.id)?.uri.toString()===uri) || currentFile();
  const position = ed?.getPosition() || {lineNumber:1,column:1};
  return {id:together.id,name:together.name,color:together.color,path:file?.path||'',line:position.lineNumber,column:position.column};
}
function renderTogetherPresence() {
  let strip = document.querySelector('#together-presence');
  if (!strip) { strip=document.createElement('div');strip.id='together-presence';strip.setAttribute('aria-label','Collaborators');$('.tabs-bar').append(strip); }
  strip.hidden=!together.mode;
  const members=together.members.filter(p=>p.id!==together.id);
  strip.innerHTML = members.map((p,i)=>`<button class="together-avatar together-color-${p.color}" data-peer="${i}" title="${escapeHtml(p.name+' · '+(p.path||'Browsing')+(p.path?':'+p.line:''))}" aria-label="${escapeHtml('Follow '+p.name+' in '+(p.path||'project'))}">${escapeHtml(p.name.slice(0,2).toUpperCase()||'?')}</button>`).join('') + (together.mode?`<button class="together-state" data-action="codeTogether">${together.connected?members.length+1+' online':'Disconnected'}</button>`:'');
  strip.querySelectorAll('[data-peer]').forEach(button=>button.onclick=()=>{const peer=members[+button.dataset.peer],file=files.find(f=>f.path===peer.path);if(file&&!file.unsupported){switchTab(file.id);editor?.setPosition({lineNumber:peer.line,column:peer.column});editor?.revealLineInCenter(peer.line);}});
  if (!monacoReady) return;
  for (const [id,model] of models) {
    const file=files.find(f=>f.id===id);
    const decorations=members.filter(p=>p.path===file?.path).map(p=>{
      const position=model.validatePosition({lineNumber:p.line,column:p.column});
      return {range:new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column), options:{
        className:'together-cursor together-color-'+p.color,
        before:{content:' '+(p.name||'Collaborator')+' ',inlineClassName:'together-cursor-label together-color-'+p.color},
        glyphMarginClassName:'together-glyph together-color-'+p.color,
        glyphMarginHoverMessage:{value:p.name.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g,'\\$&')},
        stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }};
    });
    together.decorations.set(id,model.deltaDecorations(together.decorations.get(id)||[],decorations));
  }
  for (const id of together.decorations.keys()) if(!models.has(id))together.decorations.delete(id);
}
function togetherEdited(file) {
  if (!together.mode || together.leaving || nativePaused || togetherReadOnly() || file.aiPendingSave) return;
  clearTimeout(file.togetherTimer);
  file.togetherTimer=setTimeout(()=>{if(together.mode&&!together.leaving&&!nativePaused&&!togetherReadOnly()&&!file.diskConflict&&!file.saveError)saveFile(file,false,{automatic:true});},300);
}
function mergeTogetherSnapshot(snapshot) {
  const regainedWrite=together.mode==='guest'&&!together.permissions.write&&snapshot.permissions.write;
  together.permissions=snapshot.permissions;
  together.members=snapshot.presence||[];
  const incoming = new Map(snapshot.workspace.files.map(d=>[d.path,d]));
  for (const document of incoming.values()) {
    if (together.mode==='host') document.absolutePath=nativePath(document.path);
    const file=files.find(f=>f.path===document.path);
    if (!file) {files.push(nativeFile(document));continue;}
    if (file.saving || file.disk?.version===document.version) continue;
    if (fileDirty(file)) {
      if(!file.diskConflict)toast(file.path+' has overlapping edits. Click its disk status to review.','error');
      file.diskConflict={code:'conflict',message:'Another collaborator changed this file.'};
    } else {
      // Avoid resetting models/cursors for identical content on each heartbeat.
      const view=editor&&editor.getModel()===models.get(file.id)?editor.saveViewState():null;
      adoptDiskDocument(file,document);
      if(view)editor.restoreViewState(view);
    }
  }
  if(!snapshot.workspace.skipped) {
    for(const file of [...files]) if(!incoming.has(file.path)&&!file.saving&&!file.isDraft) {
      if(fileDirty(file))file.diskConflict={code:'missing',message:'A collaborator deleted this file. Export your changes to keep a copy.'};
      else removeWorkspaceFile(file);
    }
    explicitFolders=snapshot.workspace.folders;
  }
  togetherOptions();renderTogetherPresence();refreshFileUI();persist();
  if(regainedWrite)for(const file of files){if(file.saveError?.code==='permission')file.saveError=null;if(fileDirty(file))togetherEdited(file);}
}
async function pollTogether() {
  if (!together.mode || together.busy || together.leaving || nativePaused || nativeClosing) return;
  together.busy=true;
  const epoch=together.epoch;
  const signature=()=>JSON.stringify([files.map(f=>[f.id,f.path,f.disk?.version]),explicitFolders]);
  const before=signature();
  try {
    const snapshot=together.mode==='host'
      ? await togetherNative('together_host_poll',{presence:togetherPresence()})
      : await togetherRemote('snapshot',{presence:togetherPresence()});
    for(const file of files.filter(f=>f.forceOpen&&f.disk)) {
      const index=snapshot.workspace.files.findIndex(d=>d.path===file.path);
      if(index>=0) snapshot.workspace.files[index]={...await disk.call('read_document',{path:file.disk.path,forceOpen:true}),path:file.path};
    }
    if(epoch!==together.epoch)return;
    const reconnect=!together.connected;together.connected=true;
    if(reconnect) {for(const file of files)if(!file.diskConflict)file.saveError=null;toast('Code Together reconnected.');}
    if(before===signature())mergeTogetherSnapshot(snapshot);
    else {together.permissions=snapshot.permissions;together.members=snapshot.presence||[];togetherOptions();renderTogetherPresence();}
    if(reconnect)files.filter(fileDirty).forEach(togetherEdited);
  } catch(error) {
    if(epoch!==together.epoch)return;
    if(together.connected)toast('Code Together disconnected. Your unsaved edits are kept. '+nativeError(error),'error');
    together.connected=false;together.members=[];togetherOptions();renderTogetherPresence();
  } finally {together.busy=false;}
}
function togetherTransport(command,args,invoke) {
  const operations=['read_document','save_document','rename_document','trash_document','trash_folder','create_folder'];
  if(operations.includes(command)) {
    if(command!=='read_document'&&!togetherAllowed(command!=='save_document'||args.expectedVersion===null))return Promise.reject({code:'permission',message:'This operation is not permitted by the host.'});
    const wire={...args};
    for(const key of ['path','destination'])if(wire[key]) {
      if(!wire[key].startsWith('together/'))return Promise.reject({code:'path',message:'Choose a file in the shared project.'});
      wire[key]=wire[key].slice(9);
    }
    return togetherRemote(command,wire);
  }
  if(command==='refresh_workspace')return togetherRemote('snapshot',{presence:togetherPresence()}).then(s=>s.workspace);
  if(['save_document_as','open_folder','open_files'].includes(command))return Promise.reject({code:'session',message:'Leave Code Together before opening a local project or using Save As. Use Export project to keep a local copy.'});
  return invoke(command,args);
}
function installTogetherWorkspace(workspace) {
  window.BlueGayDebugger?.reset();if(typeof resetChatLGBT==='function')resetChatLGBT();
  clearTimeout(saveTimer);clearTimeout(persistenceTimer);
  files.forEach(f=>clearTimeout(f.togetherTimer));
  editor?.setModel(null);splitEditor?.setModel(null);models.forEach(m=>m.dispose());models.clear();viewStates.clear();together.decorations.clear();
  files=workspace.files.map(d=>nativeFile(d));explicitFolders=workspace.folders;nativeRoot=workspace.root;
  projectName=workspace.name;tabs=[];collapsed.clear();scratchpad='';
  switchTab(files.find(f=>!f.unsupported)?.id||null);setSidebar('explorer');
}
async function startTogether() {
  if(!nativeReady||!nativeRoot)return toast('Open a project folder before hosting Code Together.','info');
  const permissions={write:$('#together-write').checked,createDelete:$('#together-manage').checked,console:$('#together-console').checked};
  const address=$('#together-address').value;
  together.name=$('#together-name').value.trim()||'Host';
  if(!await saveAllFiles())return;
  try {
    const result=await togetherNative('together_start',{root:nativeRoot,address,permissions});
    Object.assign(together,{mode:'host',code:result.code,permissions,connected:true});together.epoch++;
    showCodeTogether();togetherOptions();await pollTogether();
  } catch(error) {toast(nativeError(error),'error');}
}
async function joinTogether() {
  const code=$('#together-code').value.trim(),name=$('#together-name').value.trim()||'Collaborator';
  if(!nativeReady || !await guardUnsaved(files,'Save before joining Code Together.'))return;
  try {
    const snapshot=await togetherNative('together_request',{code,operation:'snapshot',args:{}});
    persist();together.previous=localStorage.getItem('bluegay.workspace');
    Object.assign(together,{mode:'guest',code,name,permissions:snapshot.permissions,connected:true});together.epoch++;
    disk.setTransport(togetherTransport);installTogetherWorkspace(snapshot.workspace);
    closeModal();mergeTogetherSnapshot(snapshot);await pollTogether();toast('Joined '+projectName+'.');
  } catch(error) {toast(nativeError(error),'error');}
}
async function leaveTogether() {
  if(!together.mode)return true;
  if(!await guardUnsaved(files,'Save or export your edits before leaving Code Together.'))return false;
  const mode=together.mode,previous=together.previous;
  together.leaving=true;
  together.epoch++;
  if(mode==='host')try{await togetherNative('together_stop');}catch(error){together.leaving=false;throw error;}
  else try{await togetherRemote('leave',{id:together.id});}catch{}
  files.forEach(f=>clearTimeout(f.togetherTimer));
  Object.assign(together,{mode:null,code:'',connected:false,members:[],previous:null,leaving:false});disk.setTransport(null);
  if(mode==='guest') {
    const saved=JSON.parse(previous||'null');
    installTogetherWorkspace({name:saved?.name||'Workspace',root:saved?.nativeRoot||null,files:[],folders:saved?.folders||[]});
    files=saved?.files||[];tabs=saved?.tabs||[];scratchpad=saved?.scratchpad||'';
    switchTab(saved?.activeId||null);await refreshNativeWorkspace();
  }
  togetherOptions();renderTogetherPresence();persist();
  closeModal();toast(mode==='host'?'Code Together stopped. The invite code is no longer valid.':'Left Code Together.');return true;
}
function showCodeTogether() {
  const active=!!together.mode,host=together.mode==='host';
  openModal(`<div class="modal-header"><h2>Code Together</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body together-dialog">
    <p>${active?(host?'Hosting <strong>'+escapeHtml(projectName)+'</strong> on this computer.':'Connected to <strong>'+escapeHtml(projectName)+'</strong>.'):'Share a project from your computer, or join a collaborator.'}</p>
    ${!disk.available?'<p>Code Together requires the desktop app on both computers.</p>':`
    ${!active?'<label>Your display name<input id="together-name" maxlength="40" placeholder="Your name" value="'+escapeHtml(together.name)+'"></label>':''}
    ${!active||host?`<fieldset><legend>Participant permissions</legend><label><input type="checkbox" id="together-write" ${together.permissions.write?'checked':''}><span>Allow editing<small>Turn off for read-only access.</small></span></label><label><input type="checkbox" id="together-manage" ${together.permissions.createDelete?'checked':''}><span>Create, rename and delete<small>Files and folders inside this project.</small></span></label><label><input type="checkbox" id="together-console" ${together.permissions.console?'checked':''}><span>Allow console and debugging<small>Participants can run and debug project code on this computer. Off by default.</small></span></label><small>Creating and deleting also requires editing permission. Live edits save automatically to the host's disk.</small></fieldset>`:`<p>${together.permissions.write?'You can edit files.':'This session is read only.'} ${together.permissions.write&&together.permissions.createDelete?'You can create and delete files.':''} ${together.permissions.console?'You can use the console and debugger.':'The host has disabled the console and debugger.'}</p>`}
    ${active?`${host?'<label>Invite code<input id="together-invite" readonly value="'+escapeHtml(together.code)+'"></label><button class="secondary-button" id="together-copy">Copy code</button><button class="secondary-button" id="together-update">Apply permissions</button>':''}<button class="primary-button" id="together-leave">${host?'Stop hosting':'Leave session'}</button>`:`<label>Host LAN / VPN address (optional)<input id="together-address" placeholder="Automatic network address"></label><button class="primary-button" id="together-start">Host this project</button><hr><label>Join with a code<input id="together-code" autocomplete="off" spellcheck="false" placeholder="Paste the host’s invite code"></label><button class="secondary-button" id="together-join">Join project</button><button class="secondary-button" id="together-recover">Recover last remote workspace</button>`}
    <p class="muted together-note">Both computers need a shared LAN or VPN. Allow BlueGay through the host firewall if prompted. The code grants access to this project; share it only with collaborators. Use a trusted network or encrypted VPN: direct LAN traffic is not encrypted.</p>`}
    </div>`,'together-modal');
  if(!disk.available)return;
  if(!active){$('#together-start').onclick=()=>togetherTask(startTogether);$('#together-join').onclick=()=>togetherTask(joinTogether);$('#together-recover').onclick=()=>togetherTask(recoverTogether);}
  else {
    $('#together-leave').onclick=()=>togetherTask(leaveTogether);
    if(host){
      $('#together-copy').onclick=async()=>{try{await navigator.clipboard.writeText(together.code);toast('Invite code copied.');}catch{$('#together-invite').select();toast('Press Ctrl+C to copy the selected code.','info');}};
      $('#together-update').onclick=()=>togetherTask(async()=>{const permissions={write:$('#together-write').checked,createDelete:$('#together-manage').checked,console:$('#together-console').checked};await togetherNative('together_permissions',{permissions});together.permissions=permissions;toast('Participant permissions updated.');});
    }
  }
}
async function recoverTogether() {
  const saved=JSON.parse(localStorage.getItem('bluegay.togetherRecovery')||'null');
  if(!saved?.files?.length)return toast('No remote workspace recovery copy is available.','error');
  if(!await guardUnsaved(files,'Save before opening the remote recovery copy.'))return;
  installTogetherWorkspace({name:saved.name+' (recovery)',root:null,files:[],folders:saved.folders||[]});
  files=saved.files.map(f=>({...f,disk:null,isDraft:!f.unsupported,diskConflict:null,saveError:null,saving:false,togetherTimer:null}));
  switchTab(files.find(f=>!f.unsupported)?.id||null);persist();closeModal();toast('Recovered remote edits as local drafts. Use Save As to keep them on this computer.');
}
let togetherActionBusy=false;
async function togetherTask(action) {
  if(togetherActionBusy)return;togetherActionBusy=true;
  try{await action();}catch(error){toast(nativeError(error),'error');}finally{togetherActionBusy=false;}
}
setInterval(pollTogether,1000);

Object.assign(together,{readOnly:togetherReadOnly,allowed:togetherAllowed,edited:togetherEdited});
