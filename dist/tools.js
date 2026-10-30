/* Local editor tools. Results use current editor text, including unsaved edits. */
function toolContext(selection=true){
  const last=typeof chatLastEditor==='undefined'?null:chatLastEditor;
  const ed=last===splitEditor&&!splitVisible?editor:last||focusedEditor(),model=ed?.getModel();
  const file=model?files.find(f=>models.get(f.id)===model):currentFile();
  if(!file||file.unsupported||file.previewOnly)throw Error('Open a text file to use this tool.');
  const range=selection?ed?.getSelection():null;
  const selected=!!range&&!range.isEmpty();
  return {file,model,text:selected?model.getValueInRange(range):file.content,scope:selected?'Selection':'Entire file'};
}
function toolDialog(title,context,body){
  openModal('<div class="modal-header"><h2>'+escapeHtml(title)+'</h2><button class="icon-button" data-action="closeModal">×</button></div><div class="modal-body"><p id="tool-source">'+escapeHtml(context.file.path)+'</p><p>'+context.scope+'</p>'+body+'<p id="tool-status" role="status" aria-live="polite"></p><div class="modal-footer"><button class="secondary-button" data-action="closeModal">Close</button></div></div>');
  window.BlueGayI18n?.refresh();
}
function textStatistics(text){
  let characters=0;for(const _ of text)characters++;
  return {lines:text?text.split(/\r\n|\r|\n/).length:0,words:(text.match(/\S+/gu)||[]).length,characters,bytes:new TextEncoder().encode(text).length};
}
function showTextStatistics(){
  try{const context=toolContext(),stats=textStatistics(context.text);toolDialog('Text statistics',context,'<dl>'+[['Lines',stats.lines],['Words (separated by whitespace)',stats.words],['Characters (Unicode code points)',stats.characters],['UTF-8 bytes',stats.bytes]].map(([label,value])=>'<dt>'+label+'</dt><dd>'+value.toLocaleString(prefs.locale)+'</dd>').join('')+'</dl>');}
  catch(error){toast(nativeError(error),'error');}
}
async function showChecksum(){
  try{
    const context=toolContext();
    toolDialog('SHA-256 checksum',context,'<p>Calculated from the UTF-8 editor text. Unsaved changes and line endings affect the result.</p><label>SHA-256<textarea id="tool-output" readonly rows="3" style="width:100%" aria-label="SHA-256"></textarea></label>');
    const output=$('#tool-output'),status=$('#tool-status');
    try{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(context.text));output.value=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
    catch{status.textContent='Could not calculate the checksum.';window.BlueGayI18n?.refresh();}
  }catch(error){toast(nativeError(error),'error');}
}
function formatJsonText(text,indent='  '){
  // Validate first, then format the original tokens: large numbers and duplicate
  // keys must survive formatting without JSON.parse/stringify data loss.
  JSON.parse(text);
  const tokens=text.match(/"(?:[^"\\]|\\.)*"|[^\s]/g)||[];
  let depth=0,output='';
  const newline=()=>{output+='\n'+indent.repeat(depth);};
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],previous=tokens[i-1];
    if(token==='{'||token==='['){output+=token;depth++;if(tokens[i+1]!=='}'&&tokens[i+1]!==']')newline();}
    else if(token==='}'||token===']'){depth--;if(previous!=='{'&&previous!=='[')newline();output+=token;}
    else if(token===','){output+=token;newline();}
    else if(token===':')output+=': ';
    else output+=token;
  }
  return output+'\n';
}
function showJsonTool(){
  try{
    const context=toolContext(false),before=context.text,model=context.model||modelFor(context.file);
    let formatted;
    try{formatted=formatJsonText(before,prefs.insertSpaces?' '.repeat(prefs.tabSize):'\t');}
    catch(error){toolDialog('Format JSON',context,'<p>Invalid JSON. Fix the syntax before formatting.</p><pre id="tool-json-error"></pre>');$('#tool-json-error').textContent=error.message;return;}
    if(model.getEOL()==='\r\n')formatted=formatted.replace(/\n/g,'\r\n');
    toolDialog('Format JSON',context,'<p>Valid JSON. Review the formatted text, then apply it to the file. Use Undo to reverse the change.</p><textarea id="tool-output" aria-label="Formatted JSON preview" readonly rows="14" style="width:100%"></textarea><button id="tool-apply" class="primary-button">Apply to file</button>');
    $('#tool-output').value=formatted;
    const status=$('#tool-status');
    $('#tool-apply').disabled=!!window.BlueGayTogether?.readOnly();
    $('#tool-apply').onclick=()=>{
      if(!files.includes(context.file)||context.file.content!==before||models.get(context.file.id)!==model||model.isDisposed())status.textContent='The file changed. Open the tool again to refresh the preview.';
      else if(context.file.previewOnly||window.BlueGayTogether?.readOnly()||window.BlueGayTogether&&!window.BlueGayTogether.allowed(false))status.textContent='This file is read-only.';
      else{model.pushStackElement();model.pushEditOperations([],[{range:model.getFullModelRange(),text:formatted}],()=>null);model.pushStackElement();closeModal();return;}
      window.BlueGayI18n?.refresh();
    };
  }catch(error){toast(nativeError(error),'error');}
}
