/* In-app previews; project JavaScript runs only in an opaque sandboxed frame. */
window.BlueGayPreviews=(()=>{
  const core=window.BlueGayPreviewCore;
  const state={mode:null,fileId:null,viewport:'desktop',revision:0,assetRevision:0,assetId:null,sourceId:null,pdf:null,pdfTask:null,renderTask:null,page:1,zoom:0,token:null,assetUrl:null};
  let timer,busy=false,again=false;
  const t=text=>window.BlueGayI18n?.translate(text)||text;
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  function button(text,action){const el=node('button',t(text));el.title=t(text);el.onclick=()=>Promise.resolve().then(action).catch(fail);return el;}
  function fail(error){const status=document.querySelector('#preview-status');if(status)status.textContent=error?.message||String(error);else toast(nativeError(error),'error');}
  function installUI(){
    if(document.querySelector('#source-area'))return;
    const area=document.querySelector('.editor-area'),source=node('div',undefined,'source-area');source.id='source-area';
    source.append($('#editor'),$('#split-editor'));area.append(source);
    const asset=node('section',undefined,'asset-view');asset.id='asset-view';asset.hidden=true;source.append(asset);
    const panel=node('aside',undefined,'preview-pane');panel.id='preview-pane';panel.hidden=true;panel.setAttribute('aria-label',t('Live preview'));area.append(panel);
    panel.innerHTML='<div class="preview-toolbar"><strong id="preview-title"></strong><button id="preview-refresh" title="Refresh preview">↻</button><button id="preview-close" title="Close preview">×</button></div><div class="preview-controls"><select id="preview-file" aria-label="Preview file"></select><select id="preview-size" aria-label="Preview size"><option value="desktop">Desktop</option><option value="tablet">Tablet · 768px</option><option value="phone">Phone · 390px</option></select></div><p id="preview-status" class="preview-status" role="status"></p><div class="preview-stage" id="preview-stage"></div>';
    $('#preview-close').onclick=close;$('#preview-refresh').onclick=()=>refresh();$('#preview-size').onchange=event=>{state.viewport=event.target.value;sizeFrame();};$('#preview-file').onchange=event=>{state.fileId=event.target.value;refresh();};
    window.addEventListener('bluegay-file-saved',()=>schedule());
  }
  function asset(file){return !!file&&['image','pdf'].includes(core.kind(file.path))&&state.sourceId!==file.id;}
  async function readBytes(file){
    if(file.disk){const result=await disk.call('read_preview_asset',{path:file.disk.path});return Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));}
    const source=blockedFileSources.get(file.sourceId);if(source){const bytes=await source();if(bytes.length>64*1024*1024)throw Error(t('Asset exceeds the 64 MB preview limit.'));return bytes;}
    if(!file.unsupported)return new TextEncoder().encode(file.content);
    throw Error(t('Reopen the original file to preview it.'));
  }
  function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
  async function snapshot(){
    const entries=[];let total=0;
    for(const file of files){if(!core.safePath(file.path)||!core.mime(file.path))continue;
      if(file.unsupported){if(!file.disk&&!blockedFileSources.has(file.sourceId))continue;const bytes=await readBytes(file);total+=bytes.length;entries.push({path:file.path,base64:base64(bytes)});}
      else{total+=new TextEncoder().encode(file.content).length;entries.push({path:file.path,content:file.content});}
      if(total>64*1024*1024)throw Error(t('Preview exceeds 64 MB.'));
    }return entries;
  }
  async function publish(entries){
    if(disk.available)return disk.call('preview_workspace',{files:entries});
    if(!state.token){const session=await fetch('/api/preview').then(r=>{if(!r.ok)throw Error('Restart the preview server to enable live preview.');return r.json();});state.token=session.token;}
    const response=await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json','X-BlueGay-Preview':state.token},body:JSON.stringify({files:entries})});const result=await response.json();if(!response.ok)throw Error(result.error||'Preview failed.');return result;
  }
  function sizeFrame(){const frame=$('#preview-stage iframe');if(!frame)return;const width=state.viewport==='phone'?390:state.viewport==='tablet'?768:0;frame.style.width=width?width+'px':'100%';frame.style.minWidth=width?width+'px':'0';}
  function open(file=currentFile()){
    installUI();const kind=core.kind(file?.path);
    if(kind==='image'||kind==='pdf'){state.sourceId=null;switchTab(file.id);return;}
    state.mode=kind==='markdown'?'markdown':'web';
    const target=state.mode==='markdown'?file:kind==='web'?file:files.find(f=>f.id===state.fileId&&core.kind(f.path)==='web')||files.find(f=>/^index\.html?$/i.test(f.path))||files.find(f=>core.kind(f.path)==='web');
    if(!target)return toast(t('Open an HTML or Markdown file to preview.'),'info');
    state.fileId=target.id;$('#preview-pane').hidden=false;refresh();
  }
  function close(){state.mode=null;state.revision++;clearTimeout(timer);const panel=$('#preview-pane');if(panel)panel.hidden=true;$('#preview-stage')?.replaceChildren();}
  function schedule(){if(!state.mode)return;clearTimeout(timer);timer=setTimeout(refresh,350);}
  async function refresh(){
    if(!state.mode)return;if(busy){again=true;return;}busy=true;again=false;const rev=++state.revision;
    try{
      const file=files.find(f=>f.id===state.fileId);if(!file||core.kind(file.path)!==state.mode){close();return;}
      $('#preview-title').textContent=t(state.mode==='web'?'Live preview':'Markdown preview');
      const select=$('#preview-file');select.replaceChildren();for(const f of files.filter(f=>core.kind(f.path)===state.mode)){const option=node('option',f.path);option.value=f.id;select.append(option);}select.value=file.id;
      $('#preview-size').hidden=state.mode!=='web';$('#preview-status').textContent=t('Updating preview…');
      const {baseUrl}=await publish(await snapshot());if(rev!==state.revision||!state.mode)return;
      const frame=node('iframe');frame.title=t(state.mode==='web'?'Live web preview':'Markdown preview');frame.setAttribute('sandbox',state.mode==='web'?'allow-scripts':'');frame.referrerPolicy='no-referrer';
      if(state.mode==='web')frame.src=core.url(baseUrl,file.path)+'?refresh='+rev;
      else{
        const html=window.BlueGayMarkdown.render(file.content),base=core.url(baseUrl,file.path).replace(/[^/]*$/,'');
        // Raw HTML is disabled in MarkdownIt. Links cannot execute JavaScript.
        frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src http://127.0.0.1:* data: https:; style-src \'unsafe-inline\'; script-src \'none\'; form-action \'none\'"><base href="'+escapeHtml(base)+'"><style>body{font:16px/1.65 system-ui,sans-serif;padding:24px;margin:auto;max-width:850px;color:#253044;background:#fff;overflow-wrap:anywhere}img{max-width:100%}pre{overflow:auto;padding:16px;background:#f1f3f6;border-radius:6px}code{font-family:Consolas,monospace}table{border-collapse:collapse}td,th{border:1px solid #ccd1db;padding:7px}blockquote{border-left:3px solid #8290b0;margin-left:0;padding-left:16px}a{color:#345bd6}</style></head><body>'+html+'</body></html>';
      }
      $('#preview-stage').replaceChildren(frame);sizeFrame();$('#preview-status').textContent=file.path+' · '+t('Updates on save');window.BlueGayI18n?.refresh();
    }catch(error){if(rev===state.revision)fail(error);}finally{busy=false;if(again&&state.mode)refresh();}
  }
  function disposeAsset(){state.assetRevision++;state.renderTask?.cancel();state.renderTask=null;state.pdfTask?.destroy().catch(()=>{});state.pdfTask=null;state.pdf=null;if(state.assetUrl)URL.revokeObjectURL(state.assetUrl);state.assetUrl=null;state.assetId=null;}
  function showActive(file){
    installUI();const panel=$('#asset-view');const showing=asset(file);$('#source-area').classList.toggle('asset-visible',showing);panel.hidden=!showing;
    if(!showing){if(state.assetId)disposeAsset();if(state.mode==='markdown'&&core.kind(file?.path)==='markdown'&&state.fileId!==file.id){state.fileId=file.id;refresh();}return false;}
    close();if(state.assetId===file.id)return true;disposeAsset();state.assetId=file.id;showAsset(file);return true;
  }
  async function showAsset(file){
    const rev=state.assetRevision,panel=$('#asset-view');panel.replaceChildren();const toolbar=node('div',undefined,'asset-toolbar'),title=node('strong',file.path),status=node('span',t('Loading preview…'),'asset-meta'),body=node('div',undefined,'asset-body');toolbar.append(title);if(!file.unsupported)toolbar.append(button('Edit source',()=>{state.sourceId=file.id;switchTab(file.id);}));toolbar.append(button('Refresh preview',()=>{disposeAsset();showActive(file);}));panel.append(toolbar,status,body);
    try{
      const bytes=await readBytes(file);if(rev!==state.assetRevision)return;
      const size=bytes.length.toLocaleString()+' '+t('bytes');
      if(core.kind(file.path)==='image'){
        state.assetUrl=URL.createObjectURL(new Blob([bytes],{type:core.mime(file.path)}));const image=node('img');image.alt=file.path;image.src=state.assetUrl;image.onload=()=>{if(rev===state.assetRevision)status.textContent=image.naturalWidth+' × '+image.naturalHeight+' px · '+size;};image.onerror=()=>{status.textContent=t('This image could not be decoded.');};body.append(image);toolbar.append(button('Fit image',()=>image.classList.remove('actual-size')),button('Actual size',()=>image.classList.add('actual-size')));
      }else{
        const pdfjs=await import('./vendor/previews/pdf.mjs');if(rev!==state.assetRevision)return;
        pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/previews/pdf.worker.mjs',location.href).href;
        const library=new URL('vendor/previews/',location.href).href;
        const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,cMapUrl:library+'cmaps/',cMapPacked:true,standardFontDataUrl:library+'standard_fonts/',wasmUrl:library+'wasm/',enableXfa:false});state.pdfTask=task;
        task.onPassword=update=>{if(rev===state.assetRevision)promptValue('PDF password','Enter the password for this PDF.','',value=>update(value));};
        const pdf=await task.promise;if(rev!==state.assetRevision){task.destroy();return;}state.pdf=pdf;state.page=1;state.zoom=0;
        const page=node('input');page.type='number';page.min='1';page.max=String(pdf.numPages);page.value='1';page.setAttribute('aria-label',t('PDF page'));
        const count=node('span','/ '+pdf.numPages);const zoom=node('select');zoom.setAttribute('aria-label',t('PDF zoom'));for(const [value,label]of [[0,'Fit width'],[0.75,'75%'],[1,'100%'],[1.5,'150%'],[2,'200%']]){const option=node('option',t(label));option.value=value;zoom.append(option);}
        const draw=()=>{page.value=state.page;return drawPdf(body,status,size,rev);};
        const previous=button('Previous page',()=>{state.page=Math.max(1,state.page-1);return draw();}),next=button('Next page',()=>{state.page=Math.min(pdf.numPages,state.page+1);return draw();});
        page.onchange=()=>{state.page=Math.max(1,Math.min(pdf.numPages,Number(page.value)||1));draw();};zoom.onchange=()=>{state.zoom=Number(zoom.value);draw();};toolbar.append(previous,page,count,next,zoom);await draw();
      }
    }catch(error){if(rev===state.assetRevision)status.textContent=t('Could not preview this file: ')+(error?.message||String(error));}
    window.BlueGayI18n?.refresh();
  }
  let drawing=0;
  async function drawPdf(body,status,size,rev){
    const generation=++drawing;state.renderTask?.cancel();state.renderTask=null;
    try{const pdf=state.pdf;if(!pdf)return;const page=await pdf.getPage(state.page);if(rev!==state.assetRevision||generation!==drawing)return;const original=page.getViewport({scale:1});const scale=state.zoom||Math.max(.2,Math.min(2,(body.clientWidth-48)/original.width));const ratio=Math.min(devicePixelRatio||1,2),view=page.getViewport({scale:scale*ratio});if(view.width*view.height>24000000)throw Error('This PDF page is too large to render at this zoom.');const canvas=node('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);canvas.style.width=view.width/ratio+'px';canvas.style.height=view.height/ratio+'px';canvas.setAttribute('aria-label',t('PDF page')+' '+state.page);body.replaceChildren(canvas);state.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:view});await state.renderTask.promise;if(rev===state.assetRevision&&generation===drawing)status.textContent=t('PDF page')+' '+state.page+' / '+pdf.numPages+' · '+size;
    }catch(error){if(error.name!=='RenderingCancelledException'&&rev===state.assetRevision&&generation===drawing)status.textContent=error.message;}
  }
  function reset(){close();disposeAsset();state.sourceId=null;$('#asset-view')?.replaceChildren();if(disk.available)disk.call('close_preview').catch(()=>{});}
  return {state,installUI,asset,showActive,open,close,refresh,schedule,reset,readBytes};
})();
