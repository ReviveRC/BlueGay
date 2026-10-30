const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const harness=require('./ui-harness.cjs');
function setup(invoke){const h=harness(invoke);h.run(fs.readFileSync('dist/browser-preview.js','utf8'));return h;}
test('HTML browser action saves and opens the selected document, independently of the current tab',async()=>{
  const calls=[],h=setup(async(command,args)=>{calls.push({command,args});if(command==='save_document')return {absolutePath:args.path,content:args.content,version:'v2'};});
  h.run("files=[{id:'html',path:'pages/a #é.html',content:'<p>new</p>',saved:'<p>old</p>',history:[],disk:{path:'C:/project/pages/a #é.html',version:'v1'}},{id:'other',path:'other.py',content:'pass',saved:'pass',history:[]}];tabs=['other'];activeId='other';prefs.finalNewline=false;nativeReady=true;");
  await h.run('openHtmlInBrowser(files[0])');assert.deepEqual(calls.map(c=>c.command),['save_document','open_html']);assert.equal(calls[1].args.path,'C:/project/pages/a #é.html');assert.equal(h.run('activeId'),'other');
});
test('Ctrl+Alt+B selects the Explorer-focused HTML file and rejects non-HTML input',async()=>{
  const h=setup(async()=>{});h.run("files=[{id:'selected',path:'selected.html'},{id:'active',path:'active.html'}];activeId='active';var picked;openHtmlInBrowser=file=>{picked=file.id};");
  const event={ctrlKey:true,altKey:true,shiftKey:false,key:'b',target:{closest:()=>({dataset:{file:'selected'}})},preventDefault(){},stopPropagation(){}};
  h.events.keydown(event);assert.equal(h.run('picked'),'selected');event.target.closest=()=>null;h.events.keydown(event);assert.equal(h.run('picked'),'active');
});
