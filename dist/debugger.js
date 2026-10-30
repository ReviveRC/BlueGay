/* Debugger UI. Program output and expressions are always rendered as text. */
window.BlueGayDebugger=(()=>{
  const core=window.BlueGayDebugCore;
  const state={phase:'idle',status:'Ready to run Python or Java',lines:[],threads:[],frames:[],scopes:[],variables:new Map(),expanded:new Set(),watches:[],watchValues:[],breakpoints:{},config:{args:[],env:{},stopOnEntry:false,exceptions:'uncaught',mainClass:''},decorations:new Map(),stoppedEpoch:0,showErrors:false};
  try{state.breakpoints=JSON.parse(localStorage.getItem('bluegay.debug.breakpoints')||'{}');state.watches=JSON.parse(localStorage.getItem('bluegay.debug.watches')||'[]').filter(s=>typeof s==='string').slice(0,50);state.config={...state.config,...JSON.parse(localStorage.getItem('bluegay.debug.launch')||'{}')};}catch{}
  const canUse=()=>window.BlueGayTogether?.mode!=='guest'||!!(window.BlueGayTogether.connected&&window.BlueGayTogether.permissions.console);
  const sessionRoutes=new Map();
  const breakpointTracks=new Map(),observedModels=new WeakSet();
  async function transport(operation,args={}){
    if(!disk.available)throw Error('Running and debugging require the desktop app.');
    const route=(args.session&&sessionRoutes.get(args.session))||(window.BlueGayTogether?.mode==='guest'?{guest:true,code:together.code,id:together.id}:{guest:false});
    if(!args.session&&route.guest&&!canUse())throw Error('The host has disabled the console and debugger.');
    try{
      const result=route.guest?await togetherNative('together_request',{code:route.code,operation:'debugger',args:{id:route.id,operation,args}}):await window.__TAURI__.core.invoke('debugger_request',{operation,args});
      if(operation==='open')sessionRoutes.set(result.session,route);
      return result;
    }finally{if(operation==='stop')sessionRoutes.delete(args.session);}
  }
  const engine=new core.Engine({transport,onEvent:handleEvent,chooseMain,getBreakpoints:()=>Object.entries(state.breakpoints).flatMap(([path,breakpoints])=>{
    const file=files.find(f=>f.path===path);if(!file?.disk)return [];
    const absolute=window.BlueGayTogether?.mode==='guest'?core.normalize(engine.session.root)+'/'+path:file.disk.path;
    if(core.relativeSource(engine.session.root,absolute)===core.normalize(absolute))return [];
    return [{path:absolute,breakpoints}];
  })});
  function log(text,category='console'){
    if(!text)return;
    state.lines.push({text:String(text).slice(0,65536),category});let size=state.lines.reduce((n,line)=>n+line.text.length,0);
    while(state.lines.length>2000||size>1000000)size-=state.lines.shift().text.length;
    const output=document.querySelector('#debug-output');if(output){const near=output.scrollHeight-output.scrollTop-output.clientHeight<60;const span=document.createElement('span');span.className='debug-output-'+category;span.textContent=text;output.append(span);if(output.childNodes.length>2000)drawOutput(output);if(near)output.scrollTop=output.scrollHeight;}
  }
  function handleEvent(type,body){
    window.BlueGayJavaTools?.handleEvent(type,body);
    if(type==='output'){if(body.category==='adapter'){state.adapterOutput=((state.adapterOutput||'')+body.output).slice(-16000);if(state.config.diagnostics)log(body.output);return;}log(body.output,body.category);return;}
    if(type==='status'){state.phase=body.phase;state.status=body.text;if(body.phase==='running'){state.frames=[];state.scopes=[];state.variables.clear();clearExecutionLine();}}
    if(type==='progress'&&state.phase==='starting')state.status=body.text||'Preparing Java project…';
    if(type==='error'){state.status=body.message;state.showErrors=true;log(body.message+'\n','stderr');if(state.adapterOutput&&!state.config.diagnostics)log(state.adapterOutput,'stderr');}
    if(type==='stopped')loadStopped(body).catch(error=>{if(engine.paused)showError(error);});
    if(type==='breakpoint')refreshBreakpointDecorations();
    if(type==='diagnostics'&&body.diagnostics?.some(d=>d.severity===1)){for(const d of body.diagnostics.filter(d=>d.severity===1).slice(0,20))log((body.uri||'')+':'+(d.range.start.line+1)+' '+d.message+'\n','stderr');}
    if(type==='exited')log('Process exited with code '+body.exitCode+'.\n');
    if(type==='ended'){state.phase='idle';state.frames=[];state.threads=[];state.scopes=[];state.variables.clear();state.watchValues=[];state.stoppedEpoch++;clearExecutionLine();if(!state.showErrors)state.status='Debug session ended';}
    refresh();
  }
  function showError(error){const message=error?.message||String(error);state.status=message;state.showErrors=true;log(message+'\n','stderr');refresh();}
  async function run(noDebug=false){
    if(!canUse()){open();return;}
    if(!disk.available){showError(Error('Running and debugging require the desktop app.'));open();return;}
    if(engine.session&&engine.paused&&!noDebug){await control('continue');return;}
    if(['starting','stopping'].includes(state.phase)||engine.session)return;
    const file=currentFile();if(!file||file.unsupported||file.previewOnly||! /\.(py|java)$/i.test(file.path)){open();showError(Error('Open a Python or Java source file to run or debug.'));return;}
    if(files.some(fileDirty)&&!await saveAllFiles())return;
    if(!file.disk){showError(Error('Save this file before debugging.'));return;}
    open();state.showErrors=false;state.lines=[];state.adapterOutput='';state.watchValues=[];state.expanded.clear();drawOutput(document.querySelector('#debug-output'));
    const standalone=!nativeRoot,root=nativeRoot||file.disk.path;
    const config=core.validateConfig({...state.config,language:/\.py$/i.test(file.path)?'python':'java',path:standalone?file.path.split('/').pop():file.path,noDebug});
    state.lastLaunch={root,config,content:file.content,mainClass:state.config.mainClass,exceptions:state.config.exceptions};
    try{await engine.start(state.lastLaunch);}catch(error){showError(error);}
  }
  async function restart(){if(!state.lastLaunch)return run(false);await engine.stop();state.showErrors=false;try{if(files.some(fileDirty)&&!await saveAllFiles())return;const file=files.find(f=>f.path===state.lastLaunch.config.path);if(file)state.lastLaunch.content=file.content;await engine.start(state.lastLaunch);}catch(error){showError(error);}}
  async function control(command){const epoch=state.stoppedEpoch;try{await engine.control(command);if(epoch===state.stoppedEpoch&&['continue','next','stepIn','stepOut'].includes(command)){engine.paused=false;engine.frameId=null;state.phase='running';clearExecutionLine();refresh();}}catch(error){showError(error);}}
  async function loadStopped(body){
    const epoch=++state.stoppedEpoch;const threads=await engine.rpc('dap','threads');if(epoch!==state.stoppedEpoch)return;
    state.threads=threads.threads||[];engine.threadId=body.threadId||state.threads[0]?.id;
    await loadFrames(engine.threadId,epoch);
    if(body.reason==='exception'&&engine.capabilities.supportsExceptionInfoRequest){try{const info=await engine.rpc('dap','exceptionInfo',{threadId:engine.threadId});log((info.exceptionId||'Exception')+': '+(info.description||'')+'\n','stderr');}catch{}}
  }
  async function loadFrames(threadId,epoch=state.stoppedEpoch){
    engine.threadId=threadId;const result=await engine.rpc('dap','stackTrace',{threadId,startFrame:0,levels:50});if(epoch!==state.stoppedEpoch)return;
    state.frames=result.stackFrames||[];refresh();if(state.frames[0])await selectFrame(state.frames[0],epoch);
  }
  async function selectFrame(frame,epoch=state.stoppedEpoch){
    engine.frameId=frame.id;state.variables.clear();state.expanded.clear();
    const result=await engine.rpc('dap','scopes',{frameId:frame.id});if(epoch!==state.stoppedEpoch)return;state.scopes=result.scopes||[];
    for(const [index,scope]of state.scopes.entries())if(!scope.expensive&&(index===0||/^locals?$/i.test(scope.name))){state.expanded.add(scope.variablesReference);await expand(scope.variablesReference);}
    await updateWatches();if(epoch===state.stoppedEpoch){await showFrame(frame);refresh();}
  }
  async function expand(reference){if(!reference)return;const result=await engine.rpc('dap','variables',{variablesReference:reference,start:0,count:200});const internal=variable=>/^(special|function) variables$/i.test(variable.name);state.variables.set(reference,(result.variables||[]).sort((a,b)=>Number(internal(a))-Number(internal(b))));refresh();}
  async function updateWatches(){state.watchValues=await Promise.all(state.watches.map(async expression=>{try{return {expression,...await engine.evaluate(expression,'watch')};}catch(error){return {expression,result:error.message,error:true};}}));refresh();}
  async function showFrame(frame){
    const source=frame.source;if(!source)return;const path=core.relativeSource(engine.session?.root,source.path);
    const file=source.path&&files.find(f=>f.path===path||!!f.disk&&core.normalize(f.disk.path).toLowerCase()===core.normalize(source.path).toLowerCase());
    clearExecutionLine();
    if(file&&!file.unsupported){switchTab(file.id);const model=modelFor(file);state.execution={model,line:frame.line};state.executionDecorations=model.deltaDecorations([],[{range:new monaco.Range(frame.line,1,frame.line,1),options:{isWholeLine:true,className:'debug-current-line',glyphMarginClassName:'debug-current-arrow',glyphMarginHoverMessage:{value:'Current execution line'}}}]);editor.setPosition({lineNumber:frame.line,column:frame.column||1});editor.revealLineInCenter(frame.line);return;}
    try{
      let content;
      if(source.sourceReference){content=(await engine.rpc('dap','source',{sourceReference:source.sourceReference,source:{name:source.name,sourceReference:source.sourceReference}})).content;}
      else if(path&&!/^(?:[a-z]+:|\/)/i.test(path)){content=(await disk.call('read_document',{path:window.BlueGayTogether?.mode==='guest'?'together/'+path:source.path})).content;}
      if(typeof content!=='string')return;
      openModal('<div class="modal-header"><h2>'+escapeHtml(source.name||path)+'</h2><button class="icon-button" data-action="closeModal">×</button></div><div id="debug-source" class="diff-shell"></div>','diff-modal');
      const model=monaco.editor.createModel(content,state.lastLaunch.config.language),view=monaco.editor.create($('#debug-source'),{...editorOptions(),readOnly:true,model,minimap:{enabled:false}});view.setPosition({lineNumber:frame.line,column:frame.column||1});view.revealLineInCenter(frame.line);modalCleanup=()=>{view.dispose();model.dispose();};
    }catch(error){log('Source unavailable: '+(error.message||String(error))+'\n');}
  }
  function clearExecutionLine(){if(state.execution&&!state.execution.model.isDisposed())state.execution.model.deltaDecorations(state.executionDecorations||[],[]);state.execution=null;state.executionDecorations=[];}
  function breakpointFile(ed=focusedEditor()){return files.find(f=>models.get(f.id)===ed?.getModel());}
  function saveBreakpoints(){localStorage.setItem('bluegay.debug.breakpoints',JSON.stringify(state.breakpoints));refreshBreakpointDecorations();refresh();}
  function toggleBreakpoint(ed=focusedEditor(),line=ed?.getPosition()?.lineNumber){
    const file=breakpointFile(ed);if(!file||!line||! /\.(py|java)$/i.test(file.path))return;
    const list=state.breakpoints[file.path]||[];state.breakpoints[file.path]=list.some(b=>b.line===line)?list.filter(b=>b.line!==line):[...list,{line}].sort((a,b)=>a.line-b.line);saveBreakpoints();syncBreakpoints(file).catch(showError);
  }
  function editBreakpoint(){const file=breakpointFile(),line=focusedEditor()?.getPosition()?.lineNumber;if(!file||!line)return;const existing=state.breakpoints[file.path]?.find(b=>b.line===line);promptValue('Breakpoint condition','Pause only when this expression is true. Leave empty for an unconditional breakpoint.',existing?.condition||'',condition=>{state.breakpoints[file.path]=[...(state.breakpoints[file.path]||[]).filter(b=>b.line!==line),{line,...(condition.trim()?{condition:condition.trim()}:{})}];saveBreakpoints();syncBreakpoints(file).catch(showError);});}
  async function syncBreakpoints(file){if(!engine.session)return;const path=window.BlueGayTogether?.mode==='guest'?core.normalize(engine.session.root)+'/'+file.path:file.disk?.path;if(path)await engine.setBreakpoints(path,state.breakpoints[file.path]||[]);}
  function refreshBreakpointDecorations(){
    if(!monacoReady)return;
    for(const [id,model]of models){
      const file=files.find(f=>f.id===id),list=(state.breakpoints[file?.path]||[]).filter(b=>b.line<=model.getLineCount());
      const ids=model.deltaDecorations(state.decorations.get(id)||[],list.map(b=>({range:new monaco.Range(b.line,1,b.line,1),options:{stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,glyphMarginClassName:b.condition?'debug-breakpoint-conditional':'debug-breakpoint',glyphMarginHoverMessage:{value:b.condition?'Breakpoint: '+b.condition:'Breakpoint'}}})));
      state.decorations.set(id,ids);breakpointTracks.set(id,{path:file?.path,points:list,ids});
      if(!observedModels.has(model)){
        observedModels.add(model);model.onDidChangeContent(()=>{
          const track=breakpointTracks.get(id);if(!track?.points.length)return;
          const points=track.points.flatMap((point,index)=>{const range=model.getDecorationRange(track.ids[index]);return range?[{...point,line:range.startLineNumber}]:[];});
          if(points.some((point,index)=>point.line!==track.points[index]?.line)||points.length!==track.points.length){state.breakpoints[track.path]=[...new Map(points.map(point=>[point.line,point])).values()];saveBreakpoints();}
        });
      }
    }
    for(const id of state.decorations.keys())if(!models.has(id)){state.decorations.delete(id);breakpointTracks.delete(id);}
  }
  function attachEditor(ed){
    ed.onDidChangeModelContent(()=>window.BlueGayJavaTools?.markChanged());
    ed.onMouseDown(event=>{if(event.target.type===monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN&&event.target.position){event.event.preventDefault();if(event.event.rightButton){ed.setPosition(event.target.position);editBreakpoint();}else toggleBreakpoint(ed,event.target.position.lineNumber);}});
    ed.onDidChangeModel(refreshBreakpointDecorations);
    ed.addAction({id:'bluegay.debug.breakpoint',label:'Toggle breakpoint',contextMenuGroupId:'debug',run:()=>toggleBreakpoint(ed)});
  }
  function open(){panelView='debug';prefs.showPanel=true;$('#bottom-panel').hidden=false;renderPanel();}
  function button(label,action,disabled=false){const button=document.createElement('button');button.textContent=label;button.disabled=disabled;button.onclick=()=>Promise.resolve().then(action).catch(showError);return button;}
  function drawOutput(output){if(!output)return;output.replaceChildren();for(const line of state.lines){const span=document.createElement('span');span.className='debug-output-'+line.category;span.textContent=line.text;output.append(span);}output.scrollTop=output.scrollHeight;}
  function render(root){
    $('#bottom-panel')?.classList.add('debug-panel');
    if(!root.querySelector('#debugger-panel')){
      root.innerHTML='<div id="debugger-panel"><div id="debug-toolbar" class="debug-toolbar"></div><p id="debug-status" role="status"></p><div class="debug-layout"><div class="debug-inspector"><label>Threads<select id="debug-threads" aria-label="Debug thread"></select></label><details open><summary>Call stack</summary><div id="debug-stack"></div></details><details open><summary>Variables</summary><div id="debug-variables"></div></details><details open><summary>Watch expressions</summary><div id="debug-watches"></div><form id="debug-watch-form"><input id="debug-watch" aria-label="Add watch expression" placeholder="Add watch expression"><button>Add</button></form></details><details><summary>Breakpoints</summary><div id="debug-breakpoints"></div></details></div><div class="debug-console"><pre id="debug-output" aria-label="Program output" role="log" aria-live="off"></pre><form id="debug-input-form"><select id="debug-input-mode" aria-label="Console input mode"><option value="stdin">Program input</option><option value="repl">Evaluate expression</option></select><input id="debug-input" aria-label="Console input" autocomplete="off" placeholder="Program input; Enter sends a line"><button id="debug-send">Send</button></form></div></div></div>';
      drawOutput(root.querySelector('#debug-output'));
      $('#debug-threads').onchange=()=>loadFrames(+$('#debug-threads').value).catch(showError);
      $('#debug-watch-form').onsubmit=event=>{event.preventDefault();const value=$('#debug-watch').value.trim();if(!value||state.watches.length>=50)return;state.watches.push(value);$('#debug-watch').value='';localStorage.setItem('bluegay.debug.watches',JSON.stringify(state.watches));if(engine.paused)updateWatches();else refresh();};
      $('#debug-input-form').onsubmit=async event=>{event.preventDefault();if(!canUse()||!engine.session)return;const input=$('#debug-input'),value=input.value;input.value='';try{if($('#debug-input-mode').value==='repl'){log('> '+value+'\n');const result=await engine.evaluate(value,'repl');log(result.result+'\n');if(engine.paused)await selectFrame(state.frames.find(f=>f.id===engine.frameId)||state.frames[0]);}else await engine.native('input',{text:value+'\n'});}catch(error){showError(error);}};
    }
    refresh();
  }
  function refresh(){
    const toolbar=document.querySelector('#debug-toolbar');if(!toolbar)return;
    const allowed=canUse(),running=!!engine.session,paused=engine.paused,starting=['starting','stopping'].includes(state.phase);
    toolbar.replaceChildren(button('▶ Run',()=>run(true),!allowed||running||starting),button(paused?'▶ Continue':'▷ Debug',()=>run(false),!allowed||starting||running&&!paused),button('Ⅱ Pause',()=>control('pause'),!allowed||!running||paused),button('↷ Over',()=>control('next'),!allowed||!paused),button('↓ Into',()=>control('stepIn'),!allowed||!paused),button('↑ Out',()=>control('stepOut'),!allowed||!paused),button('↻ Restart',restart,!allowed||!state.lastLaunch),button('■ Stop',()=>engine.stop(),!allowed||!running&&!starting),button('Settings',settingsDialog,!allowed),button('Clear',()=>{state.lines=[];drawOutput($('#debug-output'));}));
    $('#debug-status').textContent=!allowed?'The host has disabled the console and debugger.':state.status;
    $('#debug-input').disabled=!allowed||!running||starting;$('#debug-send').disabled=!allowed||!running||starting;
    const threadSelect=$('#debug-threads');threadSelect.replaceChildren();for(const thread of state.threads){const option=document.createElement('option');option.value=thread.id;option.textContent=thread.name;threadSelect.append(option);}threadSelect.value=engine.threadId??'';
    const stack=$('#debug-stack');stack.replaceChildren();for(const frame of state.frames){const entry=button(frame.name+' · '+(frame.source?.name||frame.source?.path?.split(/[\\/]/).pop()||'source')+':'+frame.line,()=>selectFrame(frame));entry.className=frame.id===engine.frameId?'selected':'';stack.append(entry);}
    const variables=$('#debug-variables');variables.replaceChildren();for(const scope of state.scopes){const section=document.createElement('div');section.className='debug-scope';section.append(button((state.expanded.has(scope.variablesReference)?'▾ ':'▸ ')+scope.name,()=>toggleReference(scope.variablesReference)));if(state.expanded.has(scope.variablesReference))drawVariables(section,scope.variablesReference,0);variables.append(section);}
    const watches=$('#debug-watches');watches.replaceChildren();for(const expression of state.watches){const value=state.watchValues.find(v=>v.expression===expression),row=document.createElement('div');row.className='debug-watch-row';const text=document.createElement('span');text.textContent=expression+' = '+(value?.result??'—');row.append(text,button('×',()=>{state.watches=state.watches.filter(s=>s!==expression);localStorage.setItem('bluegay.debug.watches',JSON.stringify(state.watches));refresh();}));if(value?.variablesReference){row.append(button('Inspect',()=>toggleReference(value.variablesReference)));if(state.expanded.has(value.variablesReference))drawVariables(row,value.variablesReference,0);}watches.append(row);}
    const breakpoints=$('#debug-breakpoints');breakpoints.replaceChildren();for(const [path,points]of Object.entries(state.breakpoints))for(const point of points)breakpoints.append(button(path+':'+point.line+(point.condition?' if '+point.condition:''),()=>{const file=files.find(f=>f.path===path);if(file){switchTab(file.id);editor.setPosition({lineNumber:point.line,column:1});editor.revealLineInCenter(point.line);}}));
  }
  async function toggleReference(reference){if(state.expanded.has(reference))state.expanded.delete(reference);else{state.expanded.add(reference);if(!state.variables.has(reference))await expand(reference);}refresh();}
  function drawVariables(parent,reference,depth){if(depth>6)return;for(const variable of state.variables.get(reference)||[]){const row=document.createElement('div');row.className='debug-variable';row.style.paddingLeft=(depth*10)+'px';const text=(variable.variablesReference?(state.expanded.has(variable.variablesReference)?'▾ ':'▸ '):'')+variable.name+' = '+variable.value+(variable.type?'  ‹'+variable.type+'›':'');const entry=button(text,()=>variable.variablesReference?toggleReference(variable.variablesReference):Promise.resolve());entry.title='Double-click to edit this value';entry.ondblclick=()=>{if(!engine.capabilities.supportsSetVariable)return;promptValue('Set variable','Enter a value or expression.',variable.value,value=>{engine.rpc('dap','setVariable',{variablesReference:reference,name:variable.name,value}).then(()=>expand(reference)).catch(showError);});};row.append(entry);parent.append(row);if(variable.variablesReference&&state.expanded.has(variable.variablesReference))drawVariables(parent,variable.variablesReference,depth+1);}}
  async function chooseMain(classes){return new Promise(resolve=>{let chosen=false;openModal('<div class="modal-header"><h2>Choose Java main class</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body"><label>Main class<select id="debug-main-class" aria-label="Main class"></select></label><button class="primary-button" id="debug-main-launch">Launch</button></div>');classes.forEach((entry,index)=>{const option=document.createElement('option');option.value=index;option.textContent=entry.mainClass+(entry.projectName?' · '+entry.projectName:'');$('#debug-main-class').append(option);});modalCleanup=()=>{if(!chosen)resolve(null);};$('#debug-main-launch').onclick=()=>{chosen=true;const selected=classes[+$('#debug-main-class').value];closeModal();resolve(selected);};});}
  async function settingsDialog(){
    if(!canUse())return;let info;
    openModal('<div class="modal-header"><h2>Debugger settings</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body" id="debug-settings-body"><p>Checking Python and Java runtimes…</p></div>','debug-settings-modal');
    try{info=await transport('info');}catch(error){$('#debug-settings-body').textContent=error.message||String(error);return;}
    if(!document.querySelector('#debug-settings-body'))return;
    const guest=window.BlueGayTogether?.mode==='guest';
    $('#debug-settings-body').innerHTML=`<p>Python uses debugpy. Java uses the Java Debug Server and Eclipse JDT Language Server for project builds and dependencies. Java debugging tools require a JDK 21 or newer.</p><label>Python executable<input id="debug-python-path" aria-label="Python executable" value="${escapeHtml(info.settings.python||'')}" ${guest?'disabled':''} placeholder="Full path to python.exe"></label><label>Java executable<input id="debug-java-path" aria-label="Java executable" value="${escapeHtml(info.settings.java||'')}" ${guest?'disabled':''} placeholder="Full path to a JDK's java.exe"></label><p>${escapeHtml(info.pythonVersion||'Python was not found.')}<br>${escapeHtml(info.javaVersion||'Java was not found.')}</p><div class="debug-setup-buttons"><button id="debug-install-python" class="secondary-button" ${guest?'disabled':''}>${info.pythonReady?'Reinstall':'Set up'} Python debugger</button><button id="debug-install-java" class="secondary-button" ${guest?'disabled':''}>${info.javaReady?'Reinstall':'Set up'} Java debugger</button></div><p>Setup downloads the pinned debug adapters into BlueGay's settings folder. Your Python environments and JDK installations are kept separate.</p><label>Program arguments (JSON array)<textarea id="debug-arguments" aria-label="Program arguments">${escapeHtml(JSON.stringify(state.config.args))}</textarea></label><label>Environment variables (JSON object)<textarea id="debug-environment" aria-label="Environment variables">${escapeHtml(JSON.stringify(state.config.env))}</textarea></label><label>Java main class (optional)<input id="debug-main-override" aria-label="Java main class" value="${escapeHtml(state.config.mainClass||'')}" placeholder="Detect from selected source file"></label><label class="debug-checkbox-row" for="debug-stop-entry"><input type="checkbox" id="debug-stop-entry" ${state.config.stopOnEntry?'checked':''}><span><strong>Stop on entry</strong><small>Pause before the first statement when debugging.</small></span></label><label>Pause on exceptions<select id="debug-exceptions"><option value="none">Never</option><option value="uncaught">Uncaught exceptions</option><option value="all">All exceptions</option></select></label><label class="debug-checkbox-row" for="debug-diagnostics"><input type="checkbox" id="debug-diagnostics" ${state.config.diagnostics?'checked':''}><span><strong>Show debugger diagnostic output</strong><small>Include adapter startup logs in the debug console.</small></span></label><p id="debug-settings-status" role="status">${guest?'Ask the host to install or change debugger tools.':(info.pythonReady?'Python ready. ':'')+(info.javaReady?'Java ready.':'')}</p><div class="modal-footer"><button class="secondary-button" data-action="closeModal">Cancel</button><button id="debug-settings-save" class="primary-button">Save settings</button></div>`;
    $('#debug-exceptions').value=state.config.exceptions;
    const saveRuntime=()=>guest?Promise.resolve():transport('settings',{settings:{python:$('#debug-python-path').value.trim(),java:$('#debug-java-path').value.trim()}});
    for(const language of ['python','java'])$('#debug-install-'+language).onclick=async()=>{const status=$('#debug-settings-status');try{await saveRuntime();$('#debug-install-python').disabled=true;$('#debug-install-java').disabled=true;status.textContent='Setting up '+language+' debugging tools. This may take a few minutes…';const result=await transport('install',{language});status.textContent=(result.pythonReady?'Python ready. ':'')+(result.javaReady?'Java ready.':'');}catch(error){status.textContent=error.message||String(error);}finally{if(document.querySelector('#debug-install-python')){$('#debug-install-python').disabled=guest;$('#debug-install-java').disabled=guest;}}};
    $('#debug-settings-save').onclick=async()=>{try{const config={...state.config,args:JSON.parse($('#debug-arguments').value),env:JSON.parse($('#debug-environment').value),stopOnEntry:$('#debug-stop-entry').checked,exceptions:$('#debug-exceptions').value,diagnostics:$('#debug-diagnostics').checked,mainClass:$('#debug-main-override').value.trim()};core.validateConfig({...config,language:'python',path:'check.py'});await saveRuntime();state.config=config;localStorage.setItem('bluegay.debug.launch',JSON.stringify(config));closeModal();}catch(error){$('#debug-settings-status').textContent=error.message||String(error);}};
  }
  function permissionsChanged(){if(!canUse()){state.lines=[];state.showErrors=false;state.status='The host has disabled the console and debugger.';engine.stop().catch(()=>{});drawOutput(document.querySelector('#debug-output'));}refresh();}
  async function reset(){await engine.stop();window.BlueGayJavaTools?.reset();state.lines=[];state.lastLaunch=null;state.decorations.clear();breakpointTracks.clear();clearExecutionLine();drawOutput(document.querySelector('#debug-output'));}
  document.addEventListener('keydown',event=>{
    if(!disk.available||$('#modal').open)return;const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();let action;
    if(key==='f5')action=event.shiftKey?(mod?restart:()=>engine.stop()):()=>run(mod);
    else if(key==='f9')action=event.shiftKey?editBreakpoint:()=>toggleBreakpoint();
    else if(key==='f10')action=()=>control('next');else if(key==='f11')action=()=>control(event.shiftKey?'stepOut':'stepIn');else if(key==='f6')action=()=>control('pause');else if(mod&&event.shiftKey&&key==='d')action=open;
    if(action){event.preventDefault();event.stopPropagation();Promise.resolve().then(action).catch(showError);}
  },true);
  window.addEventListener('bluegay-ready',()=>{
    attachEditor(editor);refreshBreakpointDecorations();
    for(const language of ['python','java'])monaco.languages.registerHoverProvider(language,{async provideHover(model,position,token){if(!engine.paused||!canUse())return null;const word=model.getWordAtPosition(position);if(!word)return null;try{const result=await engine.evaluate(word.word,'hover');if(token.isCancellationRequested||!engine.paused)return null;return {contents:[{value:'```text\n'+result.result.replace(/```/g,'')+'\n```'}]};}catch{return null;}}});
  },{once:true});
  return {state,engine,open,run,restart,stop:()=>engine.stop(),control,render,attachEditor,toggleBreakpoint,editBreakpoint,settings:settingsDialog,permissionsChanged,canUse,reset,refreshBreakpointDecorations};
})();
