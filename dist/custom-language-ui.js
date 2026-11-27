/* Language management lives in Preferences; packs contain data, never scripts. */
let customLanguages=null;
function cachedLanguagePacks(){
  try{return window.BlueGayLanguages.validatePacks(JSON.parse(localStorage.getItem('bluegay.languages')||'[]'));}
  catch(error){setTimeout(()=>toast('Custom languages could not load: '+error.message,'error'),0);return [];}
}
function installCustomLanguages(){customLanguages=window.BlueGayLanguages.install(monaco,cachedLanguagePacks());}
function customLanguageReferences(attachments){
  if(!customLanguages)return [];
  return customLanguages.references(attachments.map(a=>languageFor(files.find(f=>f.id===a.id)||{path:a.path,content:a.content||''})));
}
async function saveCustomLanguages(packs){
  const validated=window.BlueGayLanguages.validatePacks(packs);
  const previous=localStorage.getItem('bluegay.languages');
  localStorage.setItem('bluegay.languages',JSON.stringify(validated));
  try{await window.BlueGaySettings.save();}
  catch(error){if(previous===null)localStorage.removeItem('bluegay.languages');else localStorage.setItem('bluegay.languages',previous);throw error;}
  customLanguages.replace(validated);
  for(const file of files){const model=modelForSafe(file);if(model)monaco.editor.setModelLanguage(model,languageFor(file));}
  codePredictions?.invalidate();updateStatus();renderSidebar();renderChatAttachments();persist();
}
function renderLanguagePreferences(root){
  const packs=customLanguages?.packs||[];
  root.innerHTML=`<section class="settings-section language-settings"><h2>Custom languages</h2><p>Add highlighting, comments, brackets, keyword suggestions, Tab snippets, and an AI language reference. Languages are saved on this computer.</p>
    <div class="language-actions"><button class="primary-button" id="language-add">Add language</button><button class="secondary-button" id="language-import">Import language pack</button><button class="secondary-button" id="language-nomix">Use Nomix example</button><input type="file" id="language-import-file" accept=".json" hidden></div>
    <p id="language-list-status" role="status"></p>
    ${packs.length?packs.map(pack=>`<div class="setting-row"><div><h3>${escapeHtml(pack.name)} <small>${escapeHtml(pack.version||'')}</small></h3><p>${escapeHtml([...pack.extensions,...pack.filenames||[]].join(', '))} · ${pack.ai?.enabled===false?'AI reference off':pack.ai?.inline?'AI reference and predictions on':'AI reference on; predictions off'}</p></div><div class="language-actions"><button class="secondary-button" data-language-edit="${pack.id}">Edit <span class="sr-only">${escapeHtml(pack.name)}</span></button><button class="secondary-button" data-language-export="${pack.id}">Export</button><button class="secondary-button" data-language-remove="${pack.id}">Remove</button></div></div>`).join(''):'<p class="info-note">No custom languages installed. Add your language or start with the Nomix example.</p>'}
    <p class="info-note">These packs provide editor support and reference material for AI. Compiler errors, type checking, formatting, Run and debugging require separate tooling. Documentation URLs are not downloaded automatically.</p></section>`;
  $('#language-add').onclick=()=>showLanguageEditor();
  $('#language-nomix').onclick=async()=>{
    try{const response=await fetch('language-packs/nomix.json');if(!response.ok)throw Error('Could not load the Nomix example.');showLanguageEditor(window.BlueGayLanguages.validatePack(await response.json()),true);}
    catch(error){$('#language-list-status').textContent=error.message;}
  };
  $('#language-import').onclick=()=>$('#language-import-file').click();
  $('#language-import-file').onchange=async event=>{
    try{const file=event.target.files[0];if(!file)return;if(file.size>65536)throw Error('Choose a language pack smaller than 64 KB.');showLanguageEditor(window.BlueGayLanguages.validatePack(JSON.parse(await file.text())),true);}
    catch(error){$('#language-list-status').textContent='Could not import language: '+error.message;}
  };
  root.querySelectorAll('[data-language-edit]').forEach(button=>button.onclick=()=>showLanguageEditor(packs.find(p=>p.id===button.dataset.languageEdit)));
  root.querySelectorAll('[data-language-export]').forEach(button=>button.onclick=()=>{const pack=packs.find(p=>p.id===button.dataset.languageExport);downloadBlob(new Blob([JSON.stringify(pack,null,2)+'\n'],{type:'application/json'}),pack.id+'.bluegay-language.json');});
  root.querySelectorAll('[data-language-remove]').forEach(button=>button.onclick=()=>{
    const pack=packs.find(p=>p.id===button.dataset.languageRemove);
    confirmAction('Remove '+pack.name+'?','Remove this language definition from this computer. Source files will be kept.',async()=>{
      try{await saveCustomLanguages(packs.filter(p=>p.id!==pack.id));renderSettingsContent();toast(pack.name+' removed.');}
      catch(error){toast('Could not save languages: '+error.message,'error');}
    },'Remove language');
  });
}
function showLanguageEditor(value=null,imported=false){
  const pack=value||{schemaVersion:1,id:'',name:'',version:'',extensions:[],filenames:[],keywords:[],builtins:[],lineComment:'//',blockComment:[],brackets:[['{','}'],['[',']'],['(',')']],quotes:['"',"'"],stringPrefixes:[],snippets:[],ai:{enabled:true,inline:false,reference:'',examples:''}};
  const existing=customLanguages.packs.find(p=>p.id===pack.id),editing=!!existing&&!imported;
  const input=(id,label,content,placeholder='')=>`<label>${label}<input id="language-${id}" value="${escapeHtml(content)}" placeholder="${escapeHtml(placeholder)}"></label>`;
  const area=(id,label,content,rows=4)=>`<label>${label}<textarea id="language-${id}" rows="${rows}" spellcheck="false">${escapeHtml(content)}</textarea></label>`;
  openModal(`<div class="modal-header"><h2>${editing?'Edit':'Add'} custom language</h2><button class="icon-button" data-action="closeModal" aria-label="Close">×</button></div>
    <form id="language-form" class="modal-body language-form"><p>Start with the file extensions and syntax. Add a language guide and examples so AI can work with your language.</p>
    ${existing&&imported?'<p class="info-note">A language with this ID is installed. Saving will replace its definition.</p>':''}
    <div class="language-grid">${input('name','Language name',pack.name,'Nomix')}${input('id','Language ID',pack.id,'nomix')}${input('version','Language version',pack.version||'','Optional')}${input('extensions','File extensions (comma separated)',pack.extensions.join(', '),'.nx')}${input('filenames','Special filenames (comma separated)',(pack.filenames||[]).join(', '),'Optional')}${input('comment','Line comment',pack.lineComment||'','//')}</div>
    ${area('keywords','Keywords (space or comma separated)',(pack.keywords||[]).join(' '),2)}${area('builtins','Built-in names (space or comma separated)',(pack.builtins||[]).join(' '),2)}
    <details><summary>Brackets, strings and snippets</summary><div class="language-grid">${input('block-open','Block comment opening',pack.blockComment?.[0]||'')}${input('block-close','Block comment closing',pack.blockComment?.[1]||'')}${input('prefixes','String prefixes (comma separated)',(pack.stringPrefixes||[]).join(', '),'f')}</div>
    ${area('brackets','Bracket pairs (JSON)',JSON.stringify(pack.brackets||[['{','}'],['[',']'],['(',')']]),2)}${area('quotes','String quotes (JSON)',JSON.stringify(pack.quotes||['"',"'"],null,2),3)}
    ${area('snippets','Snippets (JSON)',JSON.stringify(pack.snippets||[],null,2),7)}<p>Each snippet has a prefix, description and body. Use &#36;{1:name} for a Tab placeholder and &#36;0 for the final cursor position.</p></details>
    <h3>AI language context</h3><label class="language-check"><input type="checkbox" id="language-ai" ${pack.ai?.enabled!==false?'checked':''}> Include this reference with attached code and predictions</label>
    ${area('reference','Language guide (up to 24,000 characters)',pack.ai?.reference||'',7)}${area('examples','Working examples (up to 12,000 characters)',pack.ai?.examples||'',5)}
    <label class="language-check"><input type="checkbox" id="language-inline" ${pack.ai?.inline?'checked':''}> Enable AI inline predictions for this language</label>
    <p>Chat stays available. Inline predictions also require the global Code prediction setting and a connected AI account. Without a reference, suggestions may be unreliable. Enabled reference text is sent to OpenAI with matching code.</p>
    <p id="language-edit-status" role="status"></p><div class="modal-footer"><button type="button" class="secondary-button" data-action="closeModal">Cancel</button><button class="primary-button" id="language-save" type="submit">${existing?'Save language':'Add language'}</button></div></form>`,'language-modal');
  $('#language-id').disabled=editing;
  $('#language-form').onsubmit=async event=>{
    event.preventDefault();const save=$('#language-save'),status=$('#language-edit-status');save.disabled=true;status.textContent='';
    const get=id=>$('#language-'+id).value.trim(),split=(id,words=false)=>get(id).split(words?/[\s,]+/:/[,\n]+/).map(s=>s.trim()).filter(Boolean);
    try{
      const open=get('block-open'),close=get('block-close');if(!!open!==!!close)throw Error('Enter both block comment delimiters.');
      const next=window.BlueGayLanguages.validatePack({schemaVersion:1,id:get('id'),name:get('name'),version:get('version'),extensions:split('extensions'),filenames:split('filenames'),keywords:split('keywords',true),builtins:split('builtins',true),lineComment:get('comment'),blockComment:open?[open,close]:[],brackets:JSON.parse(get('brackets')),quotes:JSON.parse(get('quotes')),stringPrefixes:split('prefixes'),snippets:JSON.parse(get('snippets')),ai:{enabled:$('#language-ai').checked,inline:$('#language-inline').checked,reference:$('#language-reference').value,examples:$('#language-examples').value}});
      const others=customLanguages.packs.filter(p=>p.id!==(editing?pack.id:next.id));
      if(!editing&&!imported&&customLanguages.packs.some(p=>p.id===next.id))throw Error('That language ID is already installed. Edit it from the Languages list.');
      await saveCustomLanguages([...others,next]);closeModal();prefTab='languages';switchTab('preferences');renderPreferences();toast(next.name+' language installed.');
    }catch(error){status.textContent='Could not save language: '+error.message;save.disabled=false;}
  };
  $('#language-name').focus();
}
