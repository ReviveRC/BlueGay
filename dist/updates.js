/* Portable executable updates. Native code owns signatures and staged files. */
window.BlueGayUpdates=(()=>{
  const state={version:'1.0.5',endpoint:'',checking:false,installing:false,ready:false,release:null,message:'',error:''};
  let dialog=false;
  const text=error=>error?.message||String(error);
  async function info(){const value=await disk.call('update_info');state.version=value.currentVersion;state.endpoint=value.endpoint;}
  function banner(){
    let root=document.querySelector('#update-banner');
    if(!state.ready){root?.remove();return;}
    if(!root){root=document.createElement('div');root.id='update-banner';root.setAttribute('role','status');document.body.append(root);}
    root.innerHTML=`<span>${escapeHtml(state.release.version)} — <span>Update ready</span></span><button id="update-restart">Restart to update</button><button id="update-later">Later</button>`;
    $('#update-restart').onclick=install;$('#update-later').onclick=()=>root.remove();
  }
  function draw(){
    const root=$('#update-dialog');if(!dialog||!root)return;
    root.innerHTML=`<p>BlueGay <strong>${escapeHtml(state.version)}</strong></p><p>Updates are checked automatically. A newer version is downloaded and verified before you restart.</p><label>Update source (HTTPS)<input id="update-source" type="url" value="${escapeHtml(state.endpoint)}" placeholder="https://github.com/owner/repo/releases/latest/download/latest.jwt"></label><button class="secondary-button" id="update-source-save" ${state.checking||state.installing?'disabled':''}>Save update source</button><p id="update-status" role="status">${escapeHtml(state.error||state.message)}</p>${state.release?`<p><span>Available version</span>: ${escapeHtml(state.release.version)}</p><pre class="update-notes">${escapeHtml(state.release.notes||'')}</pre>`:''}<div class="modal-footer"><button class="secondary-button" id="update-check" ${state.checking||state.installing?'disabled':''}>Check for updates</button>${state.ready?'<button class="primary-button" id="update-install">Restart to update</button>':''}</div>`;
    $('#update-check').onclick=()=>check(false);if($('#update-install'))$('#update-install').onclick=install;
    $('#update-source-save').onclick=async()=>{try{await disk.call('update_source',{url:$('#update-source').value});state.ready=false;state.release=null;banner();await info();state.error='';state.message='Update source saved.';}catch(error){state.error=text(error);}draw();};
  }
  async function open(){
    if(!disk.available){toast('Updates are available in the Windows desktop app.','info');return;}
    dialog=true;openModal('<div class="modal-header"><h2>Updates</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body" id="update-dialog"></div>');modalCleanup=()=>{dialog=false;};
    // openModal closes the previous dialog and runs its cleanup first.
    dialog=true;try{await info();}catch(error){state.error=text(error);}draw();
  }
  async function check(silent=true){
    if(!disk.available||state.checking||state.ready||state.installing)return;
    state.checking=true;state.error='';state.message='Checking for updates…';draw();
    try{
      const value=await disk.call('update_check');state.version=value.currentVersion;
      if(!value.configured){state.message='No update source is configured.';return;}
      if(!value.available){state.message='You are using the latest version.';return;}
      state.release=value;state.message='Downloading and verifying update…';draw();
      await disk.call('update_prepare');state.ready=true;state.message='Update ready. Restart when your work is saved.';banner();
    }catch(error){state.error=text(error);if(!silent)toast(state.error,'error');}
    finally{state.checking=false;draw();}
  }
  async function install(){
    if(!state.ready||state.installing)return;
    state.installing=true;
    try{
      if(chat?.request)stopChatLGBT();
      if(!await guardUnsaved(files,'Save before restarting to update BlueGay.'))return;
      // guardUnsaved may have replaced the Updates dialog. Settings writes and
      // the local recovery copy finish before the process exits.
      persist();await window.BlueGaySettings?.settled();
      if(files.some(fileDirty)){toast('There are newer edits. Save them before continuing.','error');return;}
      await disk.call('update_install');
    }catch(error){state.error=text(error);toast(state.error,'error');}
    finally{state.installing=false;draw();}
  }
  window.addEventListener('bluegay-ready',()=>{if(disk.available){info().catch(()=>{});setTimeout(()=>check(true),10000);setInterval(()=>check(true),6*60*60*1000);}},{once:true});
  return {open,check,install,state};
})();
