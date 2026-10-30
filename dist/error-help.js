/* Prepare an inspectable draft; never trigger a model request automatically. */
function explainError(detail){
  if(chat.request)return toast('Wait for the current ChatLGBT reply or stop it first.','info');
  const file=detail.file||files.find(f=>f.path===detail.path);
  if(file&&chatCore.sensitivePath(file.path))return toast('Secret/configuration credential files cannot be attached.','error');
  toggleChatLGBT(true);const prompt=$('#chat-prompt');
  if(prompt.value.trim())return toast('Your ChatLGBT draft is still there. Send or clear it before explaining an error.','info');
  try{
    const context=window.BlueGayPreviewCore.sourceContext(file,detail.line);
    const attachment=context?chatCore.snapshot(file,context):null;
    chat.attachments=attachment?[attachment]:[];renderChatAttachments();
    prompt.value=window.BlueGayPreviewCore.errorPrompt({...detail,path:detail.path||file?.path});updateChatEstimate();
    chatNotice('Review the error and attached code, then select Send.');prompt.focus();
  }catch(error){chatNotice(error.message);}
}
function explainCurrentError(){
  const ed=focusedEditor(),model=ed?.getModel();if(!model)return toast('Open a file with a reported problem first.','info');
  const position=ed.getPosition();const markers=monaco.editor.getModelMarkers({resource:model.uri}).filter(m=>m.severity>=4).sort((a,b)=>Math.abs(a.startLineNumber-position.lineNumber)-Math.abs(b.startLineNumber-position.lineNumber));
  const marker=markers[0];if(!marker)return toast('No diagnostic is available for this file.','info');
  explainError({file:files.find(f=>models.get(f.id)===model),line:marker.startLineNumber,message:marker.message});
}
function installErrorHelp(ed){ed.addAction({id:'bluegay.explainError',label:'Explain this error with ChatLGBT',contextMenuGroupId:'navigation',contextMenuOrder:3,run:explainCurrentError});}
