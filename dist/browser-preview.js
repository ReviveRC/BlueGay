/* Open the current editor/Explorer HTML selection in the system browser. */
async function openHtmlInBrowser(file=currentFile()){
  if(!file||file.unsupported||! /\.html?$/i.test(file.path))return toast('Select an HTML file to open in your browser.','info');
  try{
    if(disk.available&&window.BlueGayTogether?.mode!=='guest'){
      if(fileDirty(file)&&!await saveFile(file,false))return;
      if(!file.disk){if(!await saveFile(file,false))return;}
      if(file.disk)await disk.call('open_html',{path:file.disk.path});
    }else if(disk.available){
      await disk.call('open_html_preview',{path:file.path,files:files.filter(f=>!f.unsupported&&!chatCore.sensitivePath(f.path)).map(f=>({path:f.path,content:f.content}))});
    }else{
      const url=URL.createObjectURL(new Blob([file.content],{type:'text/html'}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  }catch(error){toast('Could not open HTML in your browser: '+nativeError(error),'error');}
}
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='b'&&!$('#modal').open){
    event.preventDefault();event.stopPropagation();const row=event.target.closest?.('#sidebar-content [data-file]');const file=row?files.find(f=>f.id===row.dataset.file):currentFile();openHtmlInBrowser(file);
  }
},true);
