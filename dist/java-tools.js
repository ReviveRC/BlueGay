/* Java build and JUnit results. Test names, output and traces are plain text. */
window.BlueGayJavaTools=(()=>{
  const state={busy:false,status:'Compile Java or run JUnit tests',rows:new Map(),summary:null,diagnostics:[],output:'',selected:null,filter:'all',query:'',stale:false,last:null,error:'',cancelled:false};
  const debuggerUI=()=>window.BlueGayDebugger,engine=()=>debuggerUI().engine;
  const eligible=()=>files.filter(file=>/\.java$/i.test(file.path)&&!file.unsupported&&!file.previewOnly);
  const failed=()=>[...state.rows.values()].filter(row=>row.status==='failed').map(row=>row.id);
  function open(){panelView='tests';prefs.showPanel=true;$('#bottom-panel').hidden=false;renderPanel();}
  async function run(mode='project',ids=[]){
    if(state.busy)return;open();
    if(!disk.available){state.status='Java compilation and testing require the desktop app.';refresh();return;}
    if(!debuggerUI().canUse()){state.status='The host has disabled the console and debugger.';refresh();return;}
    if(engine().session||['starting','stopping'].includes(debuggerUI().state.phase)){state.status='Stop the current program before compiling or running tests.';refresh();return;}
    const sources=eligible();let file=currentFile();
    if(mode==='class'&&!sources.includes(file)){state.status='Select a Java test file first.';refresh();return;}
    if(!sources.includes(file))file=files.find(file=>file.path===state.last?.path)||sources[0];
    if(!file){state.status='Open a Java project or source file first.';refresh();return;}
    if(files.some(fileDirty)&&!await saveAllFiles())return;
    if(!file.disk){state.status='Save this Java file before compiling or testing.';refresh();return;}
    Object.assign(state,{busy:true,status:mode==='compile'?'Compiling Java project…':'Preparing Java tests…',rows:new Map(),summary:null,diagnostics:[],output:'',selected:null,stale:false,error:'',cancelled:false,last:{mode:mode==='failed'?(state.last?.mode||'project'):mode,path:file.path}});refresh();
    const config={language:'java',path:nativeRoot?file.path:file.path.split('/').pop(),args:[],env:debuggerUI().state.config.env||{},noDebug:true};
    try{
      const result=await engine().javaTask({root:nativeRoot||file.disk.path,config,content:file.content,mode,ids,sources:sources.map(source=>({path:source.path,content:source.content}))});
      if(state.cancelled||!result){state.status='Java task cancelled';for(const row of state.rows.values())if(['running','pending'].includes(row.status))row.status='cancelled';}
      else if(mode==='compile')state.status='Java compilation succeeded';
      else if(!state.summary?.total)state.status=state.summary?.containerFailures?'Test setup failed':'No JUnit tests found';
      else state.status=state.summary.failed||state.summary.containerFailures?'Java tests failed':'Java tests completed';
    }catch(error){state.error=error.message||String(error);state.status='Java compilation or testing failed';}
    finally{state.busy=false;for(const row of state.rows.values())if(['running','pending'].includes(row.status))row.status=state.cancelled?'cancelled':'notRun';refresh();}
  }
  async function stop(){if(!state.busy)return;state.cancelled=true;state.status='Stopping Java task…';refresh();await engine().stop();}
  function handleEvent(type,body){
    if(!state.busy)return;
    if(type==='status'&&body.phase!=='stopping')state.status=body.text;
    if(type==='progress')state.status=body.text||state.status;
    if(type==='output'){if(body.category!=='adapter')state.output=(state.output+body.output).slice(-1000000);}
    if(type==='diagnostics'){
      state.diagnostics=state.diagnostics.filter(row=>!row.id.startsWith(body.uri+':'));
      for(const diagnostic of body.diagnostics||[])if(diagnostic.severity===1){const row={id:body.uri+':'+diagnostic.range.start.line+':'+diagnostic.range.start.character,kind:'diagnostic',status:'failed',name:diagnostic.message,path:window.BlueGayDebugCore.relativeSource(engine().session?.root,decodeSource(body.uri)),line:diagnostic.range.start.line+1};state.diagnostics.push(row);}
    }
    if(type==='javaBuild'&&body.success)state.diagnostics=[];
    if(type==='javaTest'&&(state.rows.size<10000||state.rows.has(body.id)))state.rows.set(body.id,{...state.rows.get(body.id),...body});
    if(type==='javaTestSummary')state.summary=body;
    if(type==='javaTestError'||type==='error'){state.error=body.message||'Java test runner failed.';}
    scheduleRefresh();
  }
  let refreshTimer=null;
  function scheduleRefresh(){if(refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;refresh();},60);}
  function decodeSource(uri){try{const url=new URL(uri);return decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i,'$1');}catch{return uri;}}
  function jump(row){
    const type=(row.className||'').split('$')[0],suffix=type.replace(/\./g,'/')+'.java';
    const file=files.find(file=>row.path?file.path===row.path:file.path===suffix||file.path.endsWith('/'+suffix))||files.find(file=>file.path.split('/').pop()===type.split('.').pop()+'.java');
    if(!file)return;switchTab(file.id);let line=row.line||1;
    if(!row.line&&row.methodName){const pattern=new RegExp('\\b'+row.methodName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\(');const index=file.content.split('\n').findIndex(text=>pattern.test(text));if(index>=0)line=index+1;}
    editor?.setPosition({lineNumber:line,column:1});editor?.revealLineInCenter(line);editor?.focus();
  }
  function button(label,action,disabled=false){const node=document.createElement('button');node.textContent=label;node.disabled=disabled;node.onclick=()=>Promise.resolve().then(action).catch(error=>{state.error=error.message||String(error);refresh();});return node;}
  const label=status=>({passed:'Passed',failed:'Failed',skipped:'Skipped',running:'Running',pending:'Queued',notRun:'Not run',cancelled:'Cancelled'})[status]||status;
  const hasValue=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
  const valueText=value=>value===''?'""':String(value);
  function failureSummary(row){
    if(row.status!=='failed')return '';
    const values=[];if(hasValue(row,'expected'))values.push('Expected: '+valueText(row.expected));if(hasValue(row,'actual'))values.push('Received: '+valueText(row.actual));
    return values.join(' · ')||row.message||'';
  }
  function render(root){
    if(!root.querySelector('#java-tests-panel')){
      root.innerHTML='<section id="java-tests-panel"><div id="java-task-toolbar" class="debug-toolbar"></div><div id="java-test-summary" role="status"></div><p id="java-test-stale" hidden>Sources changed. Run the tests again to update these results.</p><div class="java-test-filters"><label>Show<select id="java-test-filter"><option value="all">All tests</option><option value="failed">Failed</option><option value="passed">Passed</option><option value="skipped">Skipped</option></select></label><input id="java-test-search" aria-label="Filter Java tests" placeholder="Filter by test or class"></div><div class="java-test-layout"><div id="java-test-list" aria-label="Java test results"></div><div id="java-test-details"></div></div><details class="java-test-output"><summary>Build and test output</summary><pre id="java-test-output"></pre></details></section>';
      $('#java-test-filter').value=state.filter;$('#java-test-filter').onchange=event=>{state.filter=event.target.value;refresh();};
      $('#java-test-search').value=state.query;$('#java-test-search').oninput=event=>{state.query=event.target.value;refresh();};
    }
    refresh();
  }
  function refresh(){
    const toolbar=document.querySelector('#java-task-toolbar');if(!toolbar)return;
    const allowed=debuggerUI()?.canUse(),disabled=state.busy||!allowed;
    toolbar.replaceChildren(button('Compile Java',()=>run('compile'),disabled),button('Run all tests',()=>run('project'),disabled),button('Test current file',()=>run('class'),disabled),button('Rerun failed',()=>run('failed',failed()),disabled||!failed().length),button('Stop',stop,!state.busy),button('Settings',()=>debuggerUI().settings(),state.busy||!allowed));
    const summary=$('#java-test-summary');summary.className=state.error||state.summary?.failed||state.summary?.containerFailures?'java-tests-failed':state.summary?.total||state.status==='Java compilation succeeded'?'java-tests-passed':'';
    summary.replaceChildren();const title=document.createElement('strong');title.textContent=!allowed?'The host has disabled the console and debugger.':state.status;summary.append(title);
    if(state.summary){const counts=document.createElement('span');counts.textContent=`${state.summary.passed} passed · ${state.summary.failed} failed · ${state.summary.skipped} skipped · ${state.summary.total} total`+(state.summary.containerFailures?` · ${state.summary.containerFailures} setup errors`:'');summary.append(counts);}
    $('#java-test-stale').hidden=!state.stale;
    const list=$('#java-test-list');list.replaceChildren();const rows=[...state.diagnostics,...state.rows.values()].filter(row=>(state.filter==='all'||row.status===state.filter)&&(!state.query||(row.name+' '+row.className).toLowerCase().includes(state.query.toLowerCase())));
    for(const row of rows){const entry=button((row.status==='passed'?'✓ ':row.status==='failed'?'✗ ':row.status==='running'?'◌ ':'○ ')+(row.className?row.className+' · ':'')+row.name,()=>{state.selected=row.id;refresh();});entry.className='java-test-row java-test-'+row.status+(state.selected===row.id?' selected':'');entry.ondblclick=()=>jump(row);const reason=failureSummary(row);if(reason){const note=document.createElement('small');note.className='java-test-failure-summary';note.textContent=reason;entry.append(note);}entry.title=label(row.status)+(row.duration!==undefined?' · '+row.duration+' ms':'')+(reason?'\n'+reason:'');list.append(entry);}
    if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=state.busy?'Discovering and running tests…':state.error?'Compilation stopped before tests could run.':state.rows.size?'No tests match this filter.':'Run JUnit tests to see individual results here.';list.append(empty);}
    const details=$('#java-test-details');details.replaceChildren();const selected=rows.find(row=>row.id===state.selected)||rows.find(row=>row.status==='failed')||rows[0];
    if(selected){
      const heading=document.createElement('strong');heading.textContent=selected.name;const status=document.createElement('p');status.textContent=label(selected.status)+(selected.duration!==undefined?' · '+selected.duration+' ms':'');details.append(heading,status,button('Go to test source',()=>jump(selected)));
      if(selected.status==='failed')details.append(button('Explain this error with ChatLGBT',()=>{
        const type=(selected.className||'').split('$')[0],suffix=type.replace(/\./g,'/')+'.java';
        const source=files.find(file=>selected.path?file.path===selected.path:file.path===suffix||file.path.endsWith('/'+suffix))||files.find(file=>file.path.split('/').pop()===type.split('.').pop()+'.java');
        explainError({file:source,path:source?.path||selected.path,line:selected.line||1,test:selected.name,message:selected.message||selected.name,expected:selected.expected,actual:selected.actual,trace:selected.trace});
      }));
      for(const [key,title]of [['expected','Expected'],['actual','Received']])if(hasValue(selected,key)){const value=document.createElement('div');value.className='java-test-value';const caption=document.createElement('strong');caption.textContent=title;const content=document.createElement('pre');content.textContent=valueText(selected[key]);value.append(caption,content);details.append(value);}
      if(selected.message){const message=document.createElement('p');message.className='java-test-message';message.textContent=selected.message;details.append(message);}
      if(selected.trace){const stack=document.createElement('details'),caption=document.createElement('summary');caption.textContent='Stack trace';const trace=document.createElement('pre');trace.textContent=selected.trace;stack.append(caption,trace);details.append(stack);}
    }
    if(state.error){const error=document.createElement('p');error.className='java-test-error';error.textContent=state.error;details.prepend(error);}
    const output=$('#java-test-output');output.textContent=state.output;
    window.BlueGayI18n?.refresh();
  }
  function markChanged(){if((state.last||state.busy)&&/\.java$/i.test(currentFile()?.path||'')){state.stale=true;refresh();}}
  function reset(){Object.assign(state,{busy:false,rows:new Map(),summary:null,diagnostics:[],output:'',selected:null,last:null,error:'',stale:false,status:'Compile Java or run JUnit tests'});}
  document.addEventListener('keydown',event=>{if($('#modal').open)return;const mod=event.ctrlKey||event.metaKey;if(mod&&event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='b'){event.preventDefault();run('compile');}else if(mod&&event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='t'){event.preventDefault();run('project');}},true);
  return {state,open,run,stop,render,refresh,handleEvent,markChanged,reset};
})();
