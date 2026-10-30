/* Preferences are cached in browser storage; the local host owns settings.json. */
window.BlueGaySettings=(()=>{
  const state={path:null,error:null,available:false};
  const invoke=window.__TAURI__?.core?.invoke;
  let token,queue=Promise.resolve();
  const cached=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}};
  const snapshot=()=>({version:1,preferences:cached('bluegay.preferences'),chat:cached('bluegay.agent.settings')});
  const cache=value=>{localStorage.setItem('bluegay.preferences',JSON.stringify(value.preferences));localStorage.setItem('bluegay.agent.settings',JSON.stringify(value.chat));};
  async function request(method,value){
    if(invoke)return method==='GET'?invoke('load_settings'):invoke('save_settings',{settings:value});
    const response=await fetch('/api/settings',{method,headers:method==='PUT'?{'Content-Type':'application/json','X-BlueGay-Settings':token}:{},body:method==='PUT'?JSON.stringify(value):undefined,signal:AbortSignal.timeout(5000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Local settings service unavailable.');return result;
  }
  const ready=(async()=>{
    try{
      const result=await request('GET');state.path=result.path;token=result.token;
      if(result.settings)cache(result.settings);
      else await request('PUT',snapshot());
      state.available=true;
    }catch(error){state.error=error.message||String(error);}
  })();
  function save(){
    const value=snapshot();
    const task=queue.then(async()=>{
      await ready;if(!state.available)throw Error(state.error||'Local settings service unavailable.');
      try{await request('PUT',value);state.error=null;}catch(error){state.error=error.message||String(error);throw error;}
    });
    queue=task.catch(()=>{});return task;
  }
  return {state,ready,save,settled:()=>queue};
})();
