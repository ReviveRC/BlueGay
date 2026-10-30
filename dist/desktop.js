/* Desktop integration. Loaded before app.js; declarations are shared with the UI. */
const disk = window.BlueGayDisk;
let nativeRoot = null;
let nativeReady = !disk.available;
let nativePaused = false;
let nativeClosing = false;

function fileDirty(file) { return !file.unsupported && (disk.available ? disk.dirty(file) : file.content !== file.saved); }
function nativePath(relative) { return nativeRoot.replace(/[\\/]+$/, '') + '/' + relative; }
function nativeError(error) { return error?.message || String(error); }

let projectClosing = false;
async function closeProject() {
  if(window.BlueGayTogether?.mode && !await leaveTogether())return false;
  if (projectClosing) return false;
  projectClosing = true;
  try {
    if (disk.available) {
      if (!nativeReady || !await guardUnsaved(files, 'Save before closing this project.')) return false;
    } else if (files.length || explicitFolders.length || scratchpad) {
      // Browser imports may have no disk copy. Keep the complete project before clearing it.
      try {
        localStorage.setItem('bluegay.closedWorkspace', JSON.stringify({name:projectName, files, folders:explicitFolders, tabs, activeId, scratchpad}));
      } catch {
        toast('Could not keep a recovery copy. Export your project before closing it.','error');
        return false;
      }
    }
    window.BlueGayPreviews?.reset();window.BlueGayDebugger?.reset();if(typeof resetChatLGBT==='function')resetChatLGBT();
    clearTimeout(saveTimer); clearTimeout(persistenceTimer);
    editor?.setModel(null); splitEditor?.setModel(null);
    models.forEach(model => model.dispose()); models.clear(); viewStates.clear();
    files=[]; tabs=[]; activeId=null; explicitFolders=[]; collapsed.clear();
    nativeRoot=null; directoryHandle=null; scratchpad=''; projectName='Workspace';
    splitVisible=false; $('#split-editor').hidden=true;
    searchState={query:'',replace:'',case:false,regex:false}; sidebarView='explorer';
    switchTab(null); persist();
    toast(disk.available ? 'Project closed. Files remain on disk.' : 'Project closed. Reopen it from the File menu.');
    return true;
  } finally { projectClosing=false; }
}

function reopenClosedProject() {
  if (disk.available) return openNativeFolder();
  if (files.length || explicitFolders.length || scratchpad) return toast('Close the current project first.','info');
  try {
    const saved=JSON.parse(localStorage.getItem('bluegay.closedWorkspace') || 'null');
    if (!saved || !Array.isArray(saved.files)) return toast('No closed project to reopen.','error');
    window.BlueGayDebugger?.reset();if(typeof resetChatLGBT==='function')resetChatLGBT();
    files=saved.files; explicitFolders=saved.folders || []; projectName=saved.name || 'Workspace';
    tabs=saved.tabs || []; scratchpad=saved.scratchpad || '';
    if (monacoReady) files.forEach(file => modelFor(file));
    switchTab(saved.activeId || files[0]?.id || null); persist();
  } catch { toast('The closed project could not be restored.','error'); }
}
function refreshFileUI() { renderTabs(); renderSidebar(); updateStatus(); updateBreadcrumb(); if (panelView === 'history') renderPanel(); }

function rebindFilePath(file, path) {
  if(file.path===path)return;
  const old=models.get(file.id);
  file.path=path;
  models.delete(file.id);
  if(monacoReady){
    const next=modelFor(file);
    if(editor?.getModel()===old)editor.setModel(next);
    if(old&&splitEditor?.getModel()===old)splitEditor.setModel(next);
  }
  old?.dispose();
}

// A promise-based dialog lets callers await Cancel as well as Save/Discard.
function chooseAction(title, message, choices) {
  return new Promise(resolve => {
    openModal(`<div class="modal-header"><h2>${escapeHtml(title)}</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body"><p>${escapeHtml(message)}</p><div class="modal-footer">${choices.map((choice,i)=>`<button class="${i===choices.length-1?'primary-button':'secondary-button'}" data-choice="${i}">${escapeHtml(choice.label)}</button>`).join('')}</div></div>`);
    let resolved = false;
    modalCleanup = () => { if (!resolved) { resolved = true; resolve('cancel'); } };
    $$('[data-choice]').forEach(button => button.onclick = () => {
      const value = choices[+button.dataset.choice].value;
      resolved = true;
      closeModal();
      resolve(value);
    });
  });
}

async function guardUnsaved(targets, reason) {
  nativePaused = true;
  await disk.settled();
  const pending = targets.filter(fileDirty);
  if (!pending.length) { nativePaused = false; return true; }
  const choice = await chooseAction('Save your changes?', `${pending.length} file${pending.length===1?' has':'s have'} unsaved changes. ${reason}`, [
    {label:'Cancel',value:'cancel'}, {label:'Discard changes',value:'discard'}, {label:'Save changes',value:'save'}
  ]);
  if (choice === 'save') {
    for (const file of pending) {
      if (!await saveFile(file, false)) { nativePaused = false; return false; }
    }
    // Edits can happen during slow writes. Never close with newly dirty data.
    if (targets.some(fileDirty)) { nativePaused = false; toast('There are newer edits. Save them before continuing.','error'); return false; }
  }
  if (choice === 'discard') {
    for (const file of pending) {
      if (file.isDraft && (!file.disk || file.disk.version === null)) removeWorkspaceFile(file);
      else {
        setDocumentText(file, file.saved);
        file.isDraft = false;
        file.saveError = null;
      }
    }
    persist();
  }
  nativePaused = false;
  return choice === 'save' || choice === 'discard';
}

function setDocumentText(file, text) {
  // setValue is intentional for a clean disk reload/discard, not for ordinary edits.
  // Suppress autosave while replacing the model from disk.
  const paused = nativePaused;
  nativePaused = true;
  file.content = text;
  const model = models.get(file.id);
  if (model && model.getValue() !== text) model.setValue(text);
  nativePaused = paused;
}

function removeWorkspaceFile(file) {
  file.deleted = true;
  files = files.filter(item => item.id !== file.id);
  closeTabNow(file.id);
  models.get(file.id)?.dispose();
  models.delete(file.id);
  viewStates.delete(file.id);
}

function nativeFile(document, displayPath = document.path) {
  return { id: uid(), path: displayPath, content: document.content, saved: document.content,
    baseline: document.content, history: [], forceOpen:!!document.forceOpen, previewOnly:!!document.previewOnly, unsupported: document.unsupported || null, disk: { path: document.absolutePath, version: document.version }, isDraft: false };
}

async function openNativeFolder() {
  if(window.BlueGayTogether?.mode)return toast('Stop or leave Code Together before changing projects.','info');
  if (!nativeReady) return toast('Restoring disk connections. Please try again shortly.','info');
  try {
    if (!await guardUnsaved(files, 'Save before opening another folder.')) return;
    const workspace = await disk.call('open_folder');
    if (!workspace) return;
    installNativeWorkspace(workspace);
  } catch (error) { toast(nativeError(error),'error'); }
}

function installNativeWorkspace(workspace) {
    window.BlueGayPreviews?.reset();
    window.BlueGayDebugger?.reset();if(typeof resetChatLGBT==='function')resetChatLGBT();
    editor?.setModel(null); splitEditor?.setModel(null);
    models.forEach(model => model.dispose()); models.clear(); viewStates.clear();
    files = workspace.files.map(document => nativeFile(document));
    explicitFolders = workspace.folders;
    nativeRoot = workspace.root;
    projectName = workspace.name || 'Workspace'; tabs = []; collapsed.clear();
    switchTab(files.find(file=>!file.unsupported)?.id || null);
    persist();
    toast(`Opened ${files.length} files from disk.${workspace.skipped ? ` Some entries could not be listed (access restrictions or workspace limits).` : ''}`);
}

async function openNativeFiles() {
  if(window.BlueGayTogether?.mode)return toast('Stop or leave Code Together before opening local files.','info');
  if (!nativeReady) return;
  try {
    const documents = await disk.call('open_files');
    installNativeDocuments(documents);
  } catch (error) { toast(nativeError(error),'error'); }
}

function installNativeDocuments(documents) {
    const key=path=>path.replace(/\\/g,'/').toLowerCase();
    for (const document of documents) {
      const existing = files.find(file => file.disk && key(file.disk.path) === key(document.absolutePath));
      if (existing) { switchTab(existing.id); continue; }
      const root=nativeRoot && key(nativeRoot).replace(/\/+$/,'')+'/';
      let name = root && key(document.absolutePath).startsWith(root) ? document.absolutePath.replace(/\\/g,'/').slice(root.length) : document.path, n = 2;
      while (files.some(file => file.path === name)) name = `opened-${n++}/${document.path}`;
      const file = nativeFile(document, name);
      files.push(file); switchTab(file.id);
    }
    persist();
}

let nativeDropQueue=Promise.resolve();
function openNativeDroppedFiles(id) {
  const operation=nativeDropQueue.catch(()=>{}).then(async()=>{
    const discard=!nativeReady||!!window.BlueGayTogether?.mode;
    try {
      const selection=await disk.call('open_dropped_paths',{id,discard});
      if(discard)return toast(!nativeReady?'Please wait for the editor to finish loading, then drop the files again.':'Stop or leave Code Together before opening local files.','info');
      if(!selection)return;
      if(selection.kind==='folder') {
        if(!await guardUnsaved(files,'Save before opening the dropped folder.'))return;
        installNativeWorkspace(selection.data);
      } else installNativeDocuments(selection.data);
    }catch(error){toast(nativeError(error),'error');}
  });
  nativeDropQueue=operation;return operation;
}

function showFileDropOverlay(visible) {
  if(!visible){$('.drop-overlay')?.remove();return;}
  if(!$('.drop-overlay')){const overlay=document.createElement('div');overlay.className='drop-overlay';overlay.textContent='Drop files or a folder to open in BlueGay';document.body.append(overlay);}
}

async function saveNativeFile(file, { saveAs = false, automatic = false, notify = false } = {}) {
  if (file.unsupported || file.deleted || !nativeReady || automatic && nativePaused) return false;
  if (automatic && (!file.disk || file.diskConflict || file.saveError)) return false;
  if (file.diskConflict && !saveAs) {
    if (automatic) return false;
    await reviewDiskConflict(file);
    return !fileDirty(file) && !file.diskConflict;
  }
  refreshFileUI();
  try {
    const oldPath = file.disk?.path;
    const success = await disk.save(file, { saveAs, automatic });
    if (success) {
      file.aiPendingSave=false;
      window.dispatchEvent(new Event('bluegay-file-saved'));
      // Save As adopts the new disk path and detects its language by extension.
      if (file.disk.path !== oldPath) {
        const absolute = file.disk.path.replace(/\\/g, '/');
        let display = nativeRoot && absolute.startsWith(nativeRoot.replace(/\\/g,'/')+'/')
          ? absolute.slice(nativeRoot.replace(/\\/g,'/').length + 1) : absolute.split('/').pop();
        if (files.some(other => other.id !== file.id && other.path === display)) display = absolute.replace(/^[A-Za-z]:\//,'');
        rebindFilePath(file, display);
        delete file.language;
        if (monacoReady) monaco.editor.setModelLanguage(modelFor(file),languageFor(file));
      }
      if (notify) toast(`Saved ${file.path} to disk.`);
    }
    persist();
    return success;
  } catch (error) {
    if (error.code === 'size' && !automatic) {
      const choice=await chooseAction('File exceeds 50 MB','Allow this file to exceed the default size limit and save your edits?',[{label:'Cancel',value:'cancel'},{label:'Save anyway',value:'save'}]);
      if(choice==='save'){file.forceOpen=true;file.saveError=null;return saveNativeFile(file,{saveAs,notify});}
    } else if (error.code === 'conflict' && !automatic) await reviewDiskConflict(file);
    else toast(`Could not save ${file.path}: ${nativeError(error)}`,'error');
    persist();
    return false;
  } finally { refreshFileUI(); }
}

async function reviewDiskConflict(file) {
  let document;
  try { document = await disk.call('read_document',{path:file.disk.path,...(file.forceOpen?{forceOpen:true}:{})}); if(document.unsupported)throw {message:document.unsupported}; }
  catch (error) {
    const choice = await chooseAction('File unavailable', nativeError(error), [{label:'Cancel',value:'cancel'}, {label:'Save As…',value:'saveAs'}]);
    if (choice==='saveAs') await saveNativeFile(file,{saveAs:true,notify:true});
    return;
  }
  const choice = await chooseAction('File changed on disk', `${file.path} was edited outside BlueGay. Your unsaved text has been kept. Reload the disk version, save a separate copy, or explicitly replace the disk version.`, [
    {label:'Cancel',value:'cancel'}, {label:'Reload disk',value:'reload'}, {label:'Save As…',value:'saveAs'}, {label:'Overwrite disk',value:'overwrite'}
  ]);
  if (choice==='reload') {
    file.history.unshift({at:Date.now(),content:file.content}); file.history=file.history.slice(0,20);
    setDocumentText(file,document.content); disk.attach(file,document); persist(); refreshFileUI();
  } else if (choice==='saveAs') await saveNativeFile(file,{saveAs:true,notify:true});
  else if (choice==='overwrite') {
    // Accept only the reviewed version. A further disk edit still causes a conflict.
    file.disk.version=document.version; file.diskConflict=null; file.saveError=null;
    await saveNativeFile(file,{notify:true});
  }
}

function adoptDiskDocument(file, document) {
  if (document.unsupported && !document.previewOnly && !window.BlueGayPreviews?.asset(file)) {
    closeTabNow(file.id);
    models.get(file.id)?.dispose(); models.delete(file.id); viewStates.delete(file.id);
  }
  setDocumentText(file, document.content);
  disk.attach(file, document);
  if(activeId===file.id){editor?.updateOptions?.(editorOptions());splitEditor?.updateOptions?.(editorOptions());}
}

// Re-enumerate the selected folder at startup instead of trusting its recovery snapshot.
async function refreshNativeWorkspace() {
  if (!nativeRoot) return;
  const root = nativeRoot;
  try {
    const workspace = await disk.call('refresh_workspace', {root});
    if (root !== nativeRoot || !workspace?.files) return;
    const key = path => path.replace(/\\/g,'/').toLowerCase();
    const byPath = new Map(files.filter(file=>file.disk).map(file=>[key(file.disk.path),file]));
    for (const document of workspace.files) {
      const existing = byPath.get(key(document.absolutePath));
      if (!existing) files.push(nativeFile(document));
      else if (existing.forceOpen) continue;
      else if (!fileDirty(existing)) adoptDiskDocument(existing, document);
      else if (existing.disk.version !== document.version) existing.diskConflict={code:'conflict',message:'Changed on disk'};
    }
    // Keep folders for unsaved drafts; treeData also derives parents from surviving files.
    if (!workspace.skipped) explicitFolders = workspace.folders;
    else toast('Some project entries could not be listed (access restrictions or workspace limits).','error');
    persist(); refreshFileUI();
  } catch(error) { toast('Could not refresh the project folder: '+nativeError(error),'error'); }
}

let nativeInspecting = false;
async function inspectNativeFiles() {
  if(window.BlueGayTogether?.mode)return;
  if (!nativeReady || nativePaused || nativeClosing || nativeInspecting || !disk.available) return;
  nativeInspecting = true;
  try {
  for (const file of [...files]) {
    if (nativePaused || nativeClosing) break;
    const result = await disk.inspect(file);
    if (!files.includes(file) || nativePaused) continue;
    if (result.kind==='reload') {
      // A reload result must be rechecked because the user may type between awaits.
      if (fileDirty(file)) { file.diskConflict={code:'conflict',message:'Changed on disk'}; continue; }
      adoptDiskDocument(file,result.document); persist(); refreshFileUI();
    } else if (result.kind==='removed') {
      if (fileDirty(file)) { file.diskConflict=result.error; continue; }
      removeWorkspaceFile(file); persist(); refreshFileUI();
    } else if (result.kind==='conflict' || result.kind==='error') {
      const first=!file.diskConflict;
      file.diskConflict=result.error||{code:'conflict',message:'Changed on disk'};
      if(first)toast(`${file.path} changed or became unavailable on disk. Click its disk status to review.`,'error');
      updateStatus();
      persist();
    }
  }
  } finally { nativeInspecting=false; }
}

async function saveAllFiles() {
  for (const file of [...files]) {
    if ((fileDirty(file) || prefs.fixIndentationOnSave && tabs.includes(file.id)) && !await saveFile(file)) return false;
  }
  persist(); refreshFileUI();
  toast(disk.available?'All changes saved to disk.':'All files saved in this browser.');
  return true;
}

async function nativeRenameFile(file) {
  if(window.BlueGayTogether&&!window.BlueGayTogether.allowed(true))return;
  if (!file.disk || !nativeRoot) {
    if (await saveNativeFile(file,{saveAs:true,notify:true})) toast('Saved under the new name. The original file is kept.');
    return;
  }
  promptValue('Rename file on disk','Enter a path relative to the open workspace.',file.path,async path=>{
    path=normalizedPath(path);
    if(!validPath(path)||files.some(other=>other.id!==file.id&&other.path===path))return toast('Please choose a valid, unused path.','error');
    try {
      if(fileDirty(file)&&!await saveFile(file))return;
      const document=await disk.call('rename_document',{path:file.disk.path,destination:nativePath(path),expectedVersion:file.disk.version});
      adoptDiskDocument(file,document); rebindFilePath(file,path); persist(); refreshFileUI();
    }catch(error){toast(nativeError(error),'error');}
  });
}

async function nativeDeleteFile(file) {
  if(window.BlueGayTogether&&!window.BlueGayTogether.allowed(true))return;
  if (!nativeReady) return toast('Restoring disk connections. Please try again shortly.','info');
  const onDisk=file.disk&&file.disk.version!==null;
  const choice=await chooseAction(onDisk?'Move file to Recycle Bin?':'Discard file?',`${file.path}${fileDirty(file)?' has unsaved changes.':''} ${onDisk?'This will remove the disk file and discard its edits.':'This will remove the unsaved draft.'}`,[{label:'Cancel',value:'cancel'},{label:onDisk?'Move to Recycle Bin':'Discard',value:'delete'}]);
  if(choice!=='delete')return;
  nativePaused=true;
  try{await disk.settled();if(file.disk&&file.disk.version!==null)await disk.call('trash_document',{path:file.disk.path,expectedVersion:file.disk.version});removeWorkspaceFile(file);persist();refreshFileUI();}
  catch(error){toast(nativeError(error),'error');}finally{nativePaused=false;}
}

async function deleteFolder(path) {
  if(window.BlueGayTogether&&!window.BlueGayTogether.allowed(true))return;
  if (disk.available && !nativeReady) return toast('Restoring disk connections. Please try again shortly.','info');
  if (!validPath(path)) return;
  const inside = name => name === path || name.startsWith(path+'/');
  const onDisk = disk.available && nativeRoot;
  const targets = files.filter(file=>inside(file.path));
  const message = onDisk
    ? `${path} and everything inside it will move to the Recycle Bin, including files not loaded in the editor. Unsaved edits in this folder will be discarded.`
    : `Remove ${path} and all its contents from this workspace? Original disk files will be kept. Unsaved edits in this folder will be discarded.`;
  if ((onDisk || prefs.confirmDelete || targets.some(fileDirty)) && await chooseAction('Delete folder?',message,[{label:'Cancel',value:'cancel'},{label:onDisk?'Move to Recycle Bin':'Delete folder',value:'delete'}]) !== 'delete') return;
  const paused = nativePaused;
  nativePaused = true;
  try {
    await disk.settled();
    if (onDisk) await disk.call('trash_folder',{root:nativeRoot,path:nativePath(path)});
    for (const file of [...files]) if (inside(file.path)) removeWorkspaceFile(file);
    explicitFolders=explicitFolders.filter(folder=>!inside(folder));
    for (const folder of collapsed) if (inside(folder)) collapsed.delete(folder);
    persist(); refreshFileUI();
    toast(onDisk?'Folder moved to the Recycle Bin.':'Folder removed from workspace.');
  } catch(error) { toast(nativeError(error),'error'); }
  finally { nativePaused=paused; }
}

async function createNewFolder(path) {
  if(window.BlueGayTogether&&!window.BlueGayTogether.allowed(true))return;
  path=normalizedPath(path);
  if(!validPath(path)||files.some(file=>file.path===path))return toast('Please enter a valid, unused folder path.','error');
  try {
    if(disk.available&&nativeRoot)await disk.call('create_folder',{path:nativePath(path)});
    if(!explicitFolders.includes(path))explicitFolders.push(path);
    renderSidebar();persist();toast(disk.available&&nativeRoot?'Folder created on disk.':'Folder created in workspace.');
  }catch(error){toast(nativeError(error),'error');}
}

async function drainLaunchRequests(){
  try{for(const id of await disk.call('take_launch_requests'))await openNativeDroppedFiles(id);}catch(error){toast(nativeError(error),'error');}
}

async function initializeDesktop() {
  if(!disk.available)return;

  let snapshot;
  try { snapshot=JSON.parse(localStorage.getItem('bluegay.workspace')||'null'); } catch {}
  if(snapshot&&prefs.restoreSession){nativeRoot=snapshot.nativeRoot||null;}
  else {
    editor?.setModel(null);splitEditor?.setModel(null);models.forEach(model=>model.dispose());models.clear();
    files=[];tabs=[];activeId=null;explicitFolders=[];projectName='Workspace';
  }
  for(const file of files){file.saving=false;file.saveError=null;}
  try {
    await window.__TAURI__.event.listen('bluegay-launch-request',()=>{if(nativeReady)drainLaunchRequests();});
    await window.__TAURI__.event.listen('bluegay-file-drag',event=>showFileDropOverlay(event.payload));
    await window.__TAURI__.event.listen('bluegay-files-dropped',event=>openNativeDroppedFiles(event.payload));
    await window.__TAURI__.event.listen('bluegay-drop-error',event=>toast(nativeError(event.payload),'error'));
    await window.__TAURI__.event.listen('bluegay-close-requested',async()=>{
      if(nativeClosing)return;
      nativeClosing=true;
      try{if(await guardUnsaved(files,'Save before closing BlueGay.')){persist();await window.BlueGaySettings?.settled();await disk.call('finish_close');}}
      finally{nativeClosing=false;}
    });
    await disk.call('enable_close_guard');
    // Reloading the webview must not leave an invisible sharing server running.
    await disk.call('together_stop');
    nativeReady=true;
    await refreshNativeWorkspace();
    await inspectNativeFiles();
    await drainLaunchRequests();
  } catch(error) { toast('Desktop initialization failed: '+nativeError(error),'error'); }
  switchTab(activeId);updateStatus();
  setInterval(inspectNativeFiles,4000);
  window.addEventListener('focus',inspectNativeFiles);
}

// Monaco initializes asynchronously; the app announces when its models are ready.
window.addEventListener('bluegay-ready',initializeDesktop,{once:true});
