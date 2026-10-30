const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const harness=require('./ui-harness.cjs');

// Exercise the actual shipped HTML formatter, not a stub that always returns
// indentation matching the expected test result.
let htmlWorker;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/vendor/vs/language/html/htmlWorker.js'),'utf8'),{
  define(name,deps,factory){htmlWorker=factory(()=>{});},console,setTimeout,clearTimeout
});

function applyEdits(text,edits){
  const lines=text.split(/\r\n|\n|\r/),eol=text.includes('\r\n')?'\r\n':'\n';
  const offset=(line,column)=>lines.slice(0,line-1).reduce((n,s)=>n+s.length+eol.length,0)+column-1;
  return edits.map(edit=>({start:offset(edit.range.startLineNumber,edit.range.startColumn),end:offset(edit.range.endLineNumber,edit.range.endColumn),text:edit.text}))
    .sort((a,b)=>b.start-a.start).reduce((value,edit)=>value.slice(0,edit.start)+edit.text+value.slice(edit.end),text);
}

function setup(source,{tabSize=4,insertSpaces=true,fail=false,pause}={}){
  const h=harness();h.context.source=source;
  h.run("newFile('indent.html',source);prefs.fixIndentationOnSave=true;prefs.finalNewline=false;");
  h.run(`prefs.tabSize=${tabSize};prefs.insertSpaces=${insertSpaces}`);
  const file=h.run('currentFile()');let version=1,preview,disposed=0;
  const original={getValue:()=>file.content,getLanguageId:()=> 'html',getVersionId:()=>version,isDisposed:()=>false,pushStackElement(){},pushEditOperations(_,edits){file.content=applyEdits(file.content,edits);version++;}};
  h.context.targetModel=original;
  h.context.monaco={languages:{html:{htmlDefaults:{options:{format:{indentInnerHtml:false,contentUnformatted:'pre',preserveNewLines:true}}}},getLanguages:()=>[]},editor:{
    createModel(text){preview={text,uri:{toString:()=> 'inmemory://indent.html'},version:1,getValue(){return this.text;},updateOptions(){},applyEdits(edits){this.text=applyEdits(this.text,edits);},dispose(){disposed++;}};return preview;},
    create(){throw Error('HTML save must not depend on a focused editor action or lazy provider registration');},
    createWebWorker(options){
      const worker=htmlWorker.create({getMirrorModels:()=>[preview]},options.createData);
      return {async getProxy(){if(pause)await pause;if(fail)throw Error('worker failed');return worker;},async withSyncedResources(uris){assert.equal(uris[0],preview.uri);},dispose(){disposed++;}};
    }
  }};
  h.run('monacoReady=true;modelFor=()=>targetModel');
  return {h,file,disposed:()=>disposed,edit(text){file.content=text;version++;}};
}

const flat='<html>\n<header></header>\n<body>\n<p></p>\n</body>\n</html>';
const indented=indent=>`<html>\n${indent}<header></header>\n${indent}<body>\n${indent.repeat(2)}<p></p>\n${indent}</body>\n</html>`;

for(const [label,tabSize,insertSpaces,indent] of [['four spaces',4,true,'    '],['two spaces',2,true,'  '],['tabs',4,false,'\t']]){
  test(`HTML save fixes the user's exact nesting example with ${label}, on first save and repeatedly`,async()=>{
    const {h,file,disposed}=setup(flat,{tabSize,insertSpaces});
    assert.equal(await h.run('saveFile(currentFile())'),true);
    assert.equal(file.saved,indented(indent));assert.equal(disposed(),2);
    assert.equal(await h.run('saveFile(currentFile())'),true);
    assert.equal(file.saved,indented(indent));assert.equal(disposed(),4);
  });
}

test('HTML indentation preserves CRLF, blank lines, inline tags, void elements and literal pre content',async()=>{
  const source='<html>\r\n<body>\r\n\r\n<section>\r\n<img src="photo.png">\r\n<p>Hello <em>there</em>!</p>\r\n<pre>\r\n  literal   spacing\r\n    stays here\r\n</pre>\r\n</section>\r\n</body>\r\n</html>';
  const {h,file}=setup(source);await h.run('saveFile(currentFile())');
  assert.equal(file.saved, '<html>\r\n    <body>\r\n\r\n        <section>\r\n            <img src="photo.png">\r\n            <p>Hello <em>there</em>!</p>\r\n            <pre>\r\n  literal   spacing\r\n    stays here\r\n</pre>\r\n        </section>\r\n    </body>\r\n</html>');
  assert.equal(file.saved.split('\r\n').length,source.split('\r\n').length);
});

test('HTML worker failure keeps edits unsaved and disposes temporary resources',async()=>{
  const {h,file,disposed}=setup(flat,{fail:true});file.saved='previous version';
  assert.equal(await h.run('saveFile(currentFile())'),false);
  assert.equal(file.saved,'previous version');assert.equal(file.content,flat);assert.equal(disposed(),2);
});

test('HTML edits arriving during formatting are preserved and never saved as the older version',async()=>{
  let finish;const pause=new Promise(resolve=>{finish=resolve;});
  const {h,file,edit,disposed}=setup(flat,{pause});file.saved='previous version';
  const saving=h.run('saveFile(currentFile())');edit(flat+'\n<!-- newer edit -->');finish();
  assert.equal(await saving,false);assert.equal(file.content,flat+'\n<!-- newer edit -->');
  assert.equal(file.saved,'previous version');assert.equal(disposed(),2);
});
