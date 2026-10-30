/* Project-wide documentation uses the existing ChatLGBT connection and transport. */
const documentationCore=window.BlueGayDocumentationCore;
let documentationJob=null;
function showProjectDocumentation(){
  if(documentationJob)return toast('Project documentation generation is running. Use ChatLGBT Stop to cancel.','info');
  if(chat.request)return toast('Wait for ChatLGBT to finish before generating project documentation.','info');
  if(disk.available&&(!nativeReady||!nativeRoot))return toast('Open a project folder before generating project documentation.','info');
  if(window.BlueGayTogether?.mode)return toast('Generate Project Documentation in a local project outside a Code Together session.','info');
  const plan=documentationCore.plan(files,languageFor);
  openModal('<div class="modal-header"><h2>Generate Project Documentation</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body"><p>ChatLGBT will document '+plan.sources.length+' files using <strong>'+escapeHtml(chatSettings.model)+'</strong> and your '+(chatSettings.provider==='chatgpt'?'ChatGPT connection':'API-key connection')+'. Each file is sent to OpenAI in a separate request using its current editor contents. Normal usage limits and costs apply.</p><p>HTML pages and an index are saved in <strong>Documentation/</strong>. Documentation language: '+(prefs.locale==='fr-CA'?'français (Canada)':'English')+'. Source files stay unchanged unless you choose to add comments. Unmodified pages from an earlier run can be regenerated.</p><div class="documentation-comment-choice"><label for="documentation-comments">Also add documentation comments inside source files?</label><select id="documentation-comments"><option value="no">No — generate HTML only</option><option value="yes">Yes — add comments above functions</option></select><p>Comments follow your interface language and each file’s comment syntax. They are added as undoable source edits. Save source files to write them to disk.</p></div><details><summary>Files to document ('+plan.sources.length+')</summary><ul>'+plan.sources.map(s=>'<li>'+escapeHtml(s.path)+' — '+escapeHtml(s.language==='auto'?documentationCore.label('Auto detect from source',prefs.locale):languageName(s.language))+'</li>').join('')+'</ul></details><details><summary>Skipped files ('+plan.skipped.length+')</summary><ul>'+plan.skipped.map(s=>'<li>'+escapeHtml(s.path)+': '+escapeHtml(documentationCore.label(s.reason,prefs.locale))+'</li>').join('')+'</ul></details><p id="documentation-status" role="status" aria-live="polite">'+(disk.available?'Ready to save HTML files to your project folder.':'Browser preview saves to this workspace. Export the project ZIP to download the HTML files.')+'</p></div><div class="modal-footer"><button class="secondary-button" data-action="closeModal">Close</button><button id="documentation-stop" class="secondary-button" hidden>Stop</button><button id="documentation-start" class="primary-button" '+(!plan.sources.length?'disabled':'')+'>Generate HTML</button></div>','documentation-dialog');
  const status=$('#documentation-status'),start=$('#documentation-start'),stop=$('#documentation-stop'),comments=$('#documentation-comments');
  const epoch=chat.epoch;
  start.onclick=async()=>{
    start.disabled=true;comments.disabled=true;stop.hidden=false;stop.onclick=stopChatLGBT;
    try{await generateDocumentation(plan,message=>{status.textContent=message;},epoch,{includeComments:comments.value==='yes'});}
    catch(error){status.textContent=nativeError(error);}
    finally{stop.hidden=true;start.disabled=false;comments.disabled=false;}
  };
}
function documentationTarget(path){
  const lower=path.toLowerCase();
  if(explicitFolders.some(p=>p.toLowerCase()===lower)||files.some(f=>{const p=f.path.toLowerCase();return p!==lower&&(p.startsWith(lower+'/')||lower.startsWith(p+'/'));}))throw Error('Output path conflicts with a file or folder: '+path);
  const file=files.find(f=>f.path.toLowerCase()===lower);
  if(file&&(file.unsupported||fileDirty(file)||file.saving||file.diskConflict||!file.content.startsWith('<!doctype html>\n'+documentationCore.marker)))throw Error('Existing or edited file will not be overwritten: '+path);
  return {file,content:file?.content,version:file?.disk?.version??null};
}
function documentationCheck(job){
  if(job.stopped||job.epoch!==chat.epoch||job.root!==nativeRoot)throw Error('Generation stopped. Completed HTML files remain in Documentation.');
  if(window.BlueGayTogether?.mode)throw Error('Generation stopped because Code Together started.');
}
async function writeDocumentation(path,content,target,job){
  documentationCheck(job);
  const now=documentationTarget(path);
  if(now.file!==target.file||now.content!==target.content||now.version!==target.version)throw Error('Output changed during generation: '+path);
  let document;
  if(disk.available)document=await disk.call('save_document',{path:nativePath(path),content,expectedVersion:target.version});
  // A workspace switch during a disk write must not add files to the new project.
  documentationCheck(job);
  const after=documentationTarget(path);
  if(after.file!==target.file||after.content!==target.content||after.version!==target.version)throw Error('Output changed while saving; editor contents were preserved: '+path);
  let file=target.file;
  if(file){setDocumentText(file,content);file.saved=content;file.baseline=content;}
  else{file={id:uid(),path,content,saved:content,baseline:content,history:[],isDraft:false};files.push(file);}
  if(document)disk.attach(file,document,content);
  persist();refreshFileUI();
}
function applyDocumentationComments(source,file,comments,job){
  documentationCheck(job);
  if(!files.includes(file)||file.path!==source.path||file.content!==source.content)throw Error('Source changed during the request; generate again.');
  if(file.unsupported||file.previewOnly||window.BlueGayTogether?.readOnly())throw Error('This file is read-only.');
  if(file.saving||file.diskConflict)throw Error('Resolve source file saves or disk conflicts before adding documentation comments.');
  const result=documentationCore.addComments(source.content,comments);
  if(!result.added)return 0;
  const model=monacoReady?modelFor(file):models.get(file.id);
  if(model&&(model.isDisposed()||model.getValue(undefined,true)!==source.content))throw Error('Source changed during the request; generate again.');
  // Match ordinary ChatLGBT edits: one undo step, with an explicit source save.
  file.aiPendingSave=true;
  if(model){model.pushStackElement();model.pushEditOperations([],[{range:model.getFullModelRange(),text:result.content}],()=>null);model.pushStackElement();}
  else{file.history=[{at:Date.now(),content:file.content},...(file.history||[])].slice(0,20);}
  file.content=result.content;
  persist();refreshFileUI();
  return result.added;
}
async function generateDocumentation(plan,progress,epoch=chat.epoch,{includeComments=false}={}){
  if(chat.request||documentationJob)throw Error('Another ChatLGBT request is running.');
  if(epoch!==chat.epoch)throw Error('The workspace changed. Open Generate Project Documentation again.');
  if(disk.available&&(!nativeReady||!nativeRoot))throw Error('Open a project folder first.');
  if(!plan.sources.length)throw Error('No eligible text files to document.');
  validateChatModel(chatSettings.model);
  const settings={...chatSettings,locale:prefs.locale==='fr-CA'?'fr-CA':'en',includeComments:!!includeComments},accountId=window.BlueGayAccount?.state.activeId||'';
  const job={id:uid(),epoch,root:nativeRoot,controller:new AbortController(),stopped:false};
  documentationJob=job;chat.request=job;renderChat();
  const completed=[],skipped=[...plan.skipped],project=projectName;
  let indexTarget,commentsAdded=0;
  try{
    const status=await refreshChatStatus();documentationCheck(job);
    if(!status?.configured)throw Error('Connect ChatLGBT in Account settings before generating project documentation.');
    indexTarget=documentationTarget('Documentation/index.html');
    // Check all destinations before spending tokens or creating files.
    const targets=new Map(plan.sources.map(s=>[s.path,documentationTarget(documentationCore.outputPath(s.path))]));
    if(disk.available)await disk.call('create_folder',{path:nativePath('Documentation')});
    documentationCheck(job);
    if(!explicitFolders.includes('Documentation'))explicitFolders.push('Documentation');
    collapsed.delete('Documentation');persist();refreshFileUI();
    for(const [index,source] of plan.sources.entries()){
      documentationCheck(job);
      const message='Documenting '+(index+1)+'/'+plan.sources.length+': '+source.path;
      progress(message);chatNotice(message);
      try{
        const current=files.find(f=>f.id===source.id&&f.path===source.path);
        if(!current||current.content!==source.content)throw Error('Source changed; generate again to document the new contents.');
        const payload=documentationCore.request(source,settings);
        if(settings.provider==='chatgpt'){payload.auth_provider='chatgpt';payload.account_id=accountId;}
        const raw=await requestDocumentation(payload,job,status);
        documentationCheck(job);
        if(!files.includes(current)||current.path!==source.path||current.content!==source.content)throw Error('Source changed during the request; generate again.');
        const data=documentationCore.parse(raw),content=documentationCore.documentPage(source,data,settings.locale);
        await writeDocumentation(documentationCore.outputPath(source.path),content,targets.get(source.path),job);
        completed.push(source);
        if(settings.includeComments)try{commentsAdded+=applyDocumentationComments(source,current,data.comments,job);}catch(error){documentationCheck(job);skipped.push({path:source.path,reason:'Documentation comments were not added: '+documentationCore.label(nativeError(error),settings.locale)});}
      }catch(error){documentationCheck(job);skipped.push({path:source.path,reason:nativeError(error)});}
    }
    await writeDocumentation('Documentation/index.html',documentationCore.indexPage(project,completed,skipped,settings.locale),indexTarget,job);
    const message='Generated '+completed.length+'/'+plan.sources.length+' HTML pages in Documentation. '+skipped.length+' skipped or failed; see Documentation/index.html for details.'+(settings.includeComments?' Added '+commentsAdded+' documentation comments. Save source files to write them to disk.':'');
    progress(message);chatNotice(message);toast(message,completed.length?'success':'info');
    return {completed,skipped,commentsAdded};
  }finally{
    job.controller.abort();if(chat.request===job)chat.request=null;if(documentationJob===job)documentationJob=null;renderChat();
  }
}
async function requestDocumentation(payload,job,status){
  let text='',completed=false,failure=null;
  const parser=chatCore.createSSE(event=>{
    documentationCheck(job);
    if(event.type==='response.output_text.delta'){text+=event.delta||'';if(text.length>chatCore.MAX_OUTPUT)throw Error('Documentation response is too large.');}
    if(event.type==='response.refusal.delta')failure='ChatLGBT declined to document this file.';
    if(event.type==='response.completed')completed=true;
    if(['error','response.failed','response.incomplete'].includes(event.type))failure=chatCore.responseFailure(event);
  });
  if(disk.available){
    let parseFailure;
    const unlisten=await window.__TAURI__.event.listen('chatlgbt-chunk',event=>{if(event.payload.id===job.id&&!parseFailure)try{parser.push(new Uint8Array(event.payload.chunk));}catch(error){parseFailure=error;disk.call('agent_cancel',{id:job.id}).catch(()=>{});}});
    try{documentationCheck(job);await disk.call('agent_respond',{id:job.id,payload});if(parseFailure)throw parseFailure;}finally{unlisten();}
  }else{
    const response=await fetch('/api/chatlgbt/respond',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Agent':status.token},body:JSON.stringify(payload),signal:job.controller.signal});
    if(!response.ok){const error=await response.json();throw Error(error.error||'Documentation request failed.');}
    const reader=response.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;parser.push(value);}}finally{reader.releaseLock();}
  }
  documentationCheck(job);parser.finish();if(failure)throw Error(failure);if(!completed)throw Error('The connection ended before documentation was complete.');return text;
}
