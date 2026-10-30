const {test}=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./ui-harness.cjs');

test('indentation preference defaults off and persists through reload',()=>{
  const h=harness();
  assert.equal(h.run('prefs.fixIndentationOnSave'),false);
  h.run('prefs.fixIndentationOnSave=true;savePreferences()');
  const restored=harness(undefined,Object.fromEntries(h.storage));
  assert.equal(restored.run('prefs.fixIndentationOnSave'),true);
});

test('explicit save applies indentation before persisting, autosave and disabled setting do not',async()=>{
  const h=harness();
  h.run(String.raw`newFile('indent.html','<div>\n<p>hello</p>\n</div>');
    prefs.finalNewline=false;
    var indentCalls=0;
    reindentFile=async f=>{indentCalls++; f.content='<div>\n  <p>hello</p>\n</div>';};`);
  await h.run('saveFile(currentFile())');
  assert.equal(h.run('indentCalls'),0);
  h.run('prefs.fixIndentationOnSave=true');
  await h.run('saveFile(currentFile(),false,{automatic:true})');
  assert.equal(h.run('indentCalls'),0);
  await h.run('saveFile(currentFile())');
  assert.equal(h.run('indentCalls'),1);
  assert.equal(h.run('currentFile().saved'),'<div>\n  <p>hello</p>\n</div>');
});

test('Save All reindents open files even if autosave has already saved them',async()=>{
  const h=harness();
  h.run(`files=[];tabs=[];newFile('one.html','one');newFile('two.js','two');
    prefs.fixIndentationOnSave=true;var paths=[];
    reindentFile=async f=>{paths.push(f.path);f.content='fixed '+f.content;};`);
  assert.equal(await h.run('saveAllFiles()'),true);
  assert.deepEqual(Array.from(h.run('paths')),['one.html','two.js']);
  assert.equal(h.run('files[0].saved'),'fixed one\n');
  assert.equal(h.run('files[1].saved'),'fixed two\n');
});

test('native Save As writes the reindented contents through the shared save path',async()=>{
  const h=harness(async()=>{});
  await h.run('initializeDesktop()');
  h.run(`newFile('new.html','original');prefs.fixIndentationOnSave=true;
    reindentFile=async f=>{f.content='indented';};
    var captured; saveNativeFile=async(f,options)=>{captured={content:f.content,saveAs:options.saveAs};return true;};`);
  await h.run('saveAsCurrentFile()');
  assert.equal(h.run('captured.content'),'indented\n');
  assert.equal(h.run('captured.saveAs'),true);
});

test('failed reindent does not mark edits saved',async()=>{
  const h=harness();
  h.run(`newFile('indent.html','unsaved');currentFile().saved='';prefs.fixIndentationOnSave=true;
    reindentFile=async()=>{throw new Error('failed');};`);
  assert.equal(await h.run('saveFile(currentFile())'),false);
  assert.equal(h.run('fileDirty(currentFile())'),true);
});


test('indentation edits preserve code, blank lines and line structure',()=>{
  const h=harness();
  h.context.source='<div>\r\n<p>Hello</p>\r\n\r\n</div>';
  h.context.formatted='<div>\n    <p>Hello</p>\n</div>';
  const edits=JSON.parse(h.run('JSON.stringify(indentationEdits(source,formatted))'));
  assert.deepEqual(edits,[{range:{startLineNumber:2,startColumn:1,endLineNumber:2,endColumn:1},text:'    '}]);
  h.context.source='function f(){\n   return 1;\n}';
  h.context.formatted='function f() {\n\treturn 1;\n}';
  assert.equal(h.run('indentationEdits(source,formatted)[0].text'),'\t');
  h.context.formatted='function f() {\n\treturn 2;\n}';
  assert.equal(h.run('indentationEdits(source,formatted).length'),0);
});

test('non-HTML reindent formats a private model, applies only indent edits and disposes helpers',async()=>{
  const h=harness();
  h.run("newFile('other.js','function f(){\\nreturn 1;\\n}'); monacoReady=true;prefs.tabSize=4;prefs.insertSpaces=false;");
  let previewText='function f(){\nreturn 1;\n}',options,applied,disposed=0;
  const original={getValue:()=>previewText,getLanguageId:()=> 'javascript',getVersionId:()=>1,isDisposed:()=>false,pushStackElement(){},pushEditOperations(_,edits){applied=edits;}};
  const preview={updateOptions(value){options=value;},getValue:()=>previewText,dispose(){disposed++;}};
  h.context.targetModel=original;
  h.context.monaco={editor:{createModel:()=>preview,create:()=>({
    getAction:id=>({isSupported:()=>true,run:async()=>{assert.equal(id,'editor.action.formatDocument');previewText='function f() {\n\treturn 1;\n}';}}),
    dispose(){disposed++;}
  })}};
  h.run('modelFor=()=>targetModel');
  await h.run('reindentFile(currentFile())');
  assert.equal(options.tabSize,4);assert.equal(options.insertSpaces,false);
  assert.equal(applied.length,1);assert.equal(applied[0].text,'\t');
  assert.equal(disposed,2);
});
