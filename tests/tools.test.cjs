const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const harness=require('./ui-harness.cjs');
function setup(){
  const h=harness();h.context.TextEncoder=TextEncoder;h.run(fs.readFileSync('dist/tools.js','utf8'));
  h.run(String.raw`files=[{id:'a',path:'sample.json',content:'{"n":1}',saved:'{"n":1}',history:[]}];activeId='a';var selected=false;var textModel={getValueInRange:()=> 'Hello 😀',getEOL:()=> '\n',isDisposed:()=>false,getFullModelRange:()=>({}),pushStackElement(){},pushEditOperations(_,edits){files[0].content=edits[0].text;}};models.set('a',textModel);editor={getModel:()=>textModel,getSelection:()=>({isEmpty:()=>!selected})};var toolHtml='';openModal=html=>{toolHtml=html;};`);
  return h;
}
test('Tools menu contains project documentation and utilities; File menu has no documentation action',()=>{
  const h=setup();assert(h.run("menuItems('Tools').some(item=>item.label==='Generate Project Documentation…')"));
  assert(!h.run("menuItems('File').some(item=>item.label==='Generate Project Documentation…')"));
  for(const label of ['Format JSON…','Text statistics…','SHA-256 checksum…'])assert(h.run(`menuItems('Tools').some(item=>item.label===${JSON.stringify(label)})`));
  assert.match(h.elements.get('#menus').innerHTML,/data-top-menu="Tools"/);
});
test('JSON formatting preserves exact numeric/string tokens and duplicate keys',()=>{
  const h=setup();
  // Use a literal string value containing punctuation and escaped quotes.
  const source='{"big":9007199254740993123,"big":1e+40,"text":"a,b:{c}","arr":[true,null,{}]}';
  const output=h.run(`formatJsonText(${JSON.stringify(source)},'  ')`);
  assert.match(output,/9007199254740993123/);assert.match(output,/1e\+40/);assert.equal((output.match(/"big"/g)||[]).length,2);
  assert.deepEqual(JSON.parse(output),JSON.parse(source));assert.match(output,/\n  "big"/);
  for(const source of ['{}','[]','null','"a\\\"b"','[1,{"a":[2,3]}]'])assert.deepEqual(JSON.parse(h.run(`formatJsonText(${JSON.stringify(source)})`)),JSON.parse(source));
});
test('JSON preview does not edit until apply and refuses stale previews',()=>{
  const h=setup();h.run('showJsonTool()');assert.equal(h.run('files[0].content'),'{"n":1}');
  assert.equal(h.elements.get('#tool-output').value,'{\n  "n": 1\n}\n');
  h.run("files[0].content='newer text';$('#tool-apply').onclick()");assert.equal(h.run('files[0].content'),'newer text');assert.match(h.elements.get('#tool-status').textContent,/file changed/);
});
test('JSON apply uses undoable editor edits and respects current readonly permission',()=>{
  const h=setup();h.run('showJsonTool();$("#tool-apply").onclick()');assert.equal(h.run('files[0].content'),'{\n  "n": 1\n}\n');
  const locked=setup();locked.run('showJsonTool();window.BlueGayTogether={readOnly:()=>true};$("#tool-apply").onclick()');assert.equal(locked.run('files[0].content'),'{"n":1}');assert.match(locked.elements.get('#tool-status').textContent,/read-only/);
});
test('invalid JSON provides an error and never creates an apply action',()=>{
  const h=setup();h.run("files[0].content='{';showJsonTool()");assert.match(h.run('toolHtml'),/Invalid JSON/);assert.doesNotMatch(h.run('toolHtml'),/tool-apply/);assert.equal(h.run('files[0].content'),'{');
});
test('statistics count Unicode, UTF-8 bytes and CRLF correctly and support selection',()=>{
  const h=setup();assert.deepEqual(JSON.parse(JSON.stringify(h.run('textStatistics("Hi 😀\\r\\nWorld")'))),{lines:2,words:3,characters:11,bytes:14});
  h.run('selected=true;showTextStatistics()');assert.match(h.run('toolHtml'),/Selection/);assert.match(h.run('toolHtml'),/<dd>7<\/dd>/);
  assert.equal(h.run('textStatistics("").lines'),0);
});
test('SHA-256 matches a known digest and uses selection when present',async()=>{
  const h=setup();h.run("files[0].content='abc'");await h.run('showChecksum()');assert.equal(h.elements.get('#tool-output').value,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  h.run('selected=true');await h.run('showChecksum()');assert.equal(h.elements.get('#tool-output').value,require('node:crypto').createHash('sha256').update('Hello 😀').digest('hex'));
});
test('selection tools retain the last focused split pane when a menu takes focus',()=>{
  const h=setup();h.run("splitVisible=true;splitEditor={getModel:()=>textModel,getSelection:()=>({isEmpty:()=>false})};var chatLastEditor=splitEditor");
  assert.equal(h.run('toolContext().text'),'Hello 😀');
  h.run('splitVisible=false');assert.equal(h.run('toolContext().scope'),'Entire file');
});
test('all tool labels and explanations translate into French',()=>{
  const h=setup();h.run(fs.readFileSync('dist/i18n.js','utf8'));h.run("window.BlueGayI18n.setLocale('fr-CA')");
  for(const label of ['Tools','Generate Project Documentation','Generate Project Documentation…','Also add documentation comments inside source files?','No — generate HTML only','Yes — add comments above functions','Format JSON','Text statistics','SHA-256 checksum','Apply to file','Entire file','Lines','UTF-8 bytes'])assert.notEqual(h.run(`window.BlueGayI18n.translate(${JSON.stringify(label)})`),label);
});
