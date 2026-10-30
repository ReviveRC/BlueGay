(async()=>{
  // Load disk preferences before either the editor or ChatLGBT reads its cache.
  await window.BlueGaySettings.ready;
  for(const src of ['i18n.js','themes.js','agent-core.js','agent.js','documentation-core.js','documentation.js','tools.js','account.js','together.js','debugger-core.js','debugger.js','java-tools.js','browser-preview.js','vendor/previews/markdown.js','preview-core.js','previews.js','error-help.js','html-completions.js','javascript-intelligence.js','code-prediction.js','diagnostics.js','updates.js','vendor/vs/loader.js','app.js']){
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Could not load '+src));document.head.append(script);});
  }
})().catch(error=>{document.querySelector('#editor').textContent='BlueGay could not start. Refresh the page to retry.';console.error(error);});
