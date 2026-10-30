const { test } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./ui-harness.cjs');

test('F2 renames the focused Explorer file, even when another file is active', () => {
  const h = harness(async () => ({}));
  h.run('files=[{id:"first",path:"a.py"},{id:"second",path:"b.py"}]');
  const id = h.run('files[1].id');
  h.run('window.renamed=null;renameFile=f=>window.renamed=f.id;sidebarView="explorer";activeId=files[0].id');
  let prevented = false, stopped = false;
  h.events.keydown({ key: 'F2', target: { closest: selector => selector === '#sidebar-content [data-file]' ? { dataset: { file: id } } : null }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(h.context.window.renamed, id); assert(prevented && stopped);
});
test('F2 preserves editor symbol renaming and ignores dialogs or modifier chords', () => {
  const h = harness(async () => ({}));
  h.run('files=[{id:"first",path:"a.py"},{id:"second",path:"b.py"}]');
  h.run('renameFile=()=>{throw Error("unexpected rename")};sidebarView="explorer"');
  const id = h.run('files[0].id');
  const base = { key: 'F2', target: { closest: () => null }, preventDefault() { throw Error('intercepted'); } };
  h.events.keydown(base);
  h.events.keydown({ ...base, ctrlKey: true, target: { closest: () => ({ dataset: { file: id } }) } });
  h.elements.get('#modal').open = true;
  h.events.keydown({ ...base, target: { closest: () => ({ dataset: { file: id } }) } });
});

test('keeping the same filename is a no-op and preserves its language override', () => {
  const h = harness();
  h.run('currentFile().language="python";promptValue=(title,help,path,done)=>done(path);models.set(activeId,{dispose(){throw Error("disposed unchanged model")}});renameFile(currentFile())');
  assert.equal(h.run('currentFile().language'), 'python');
});

test('F2 native rename uses the selected disk path and expected version', async () => {
  const calls = [];
  const h = harness(async (command, args) => {
    calls.push({ command, args });
    return { absolutePath: args.destination, content: 'print(1)', version: 'v2' };
  });
  h.run('nativeRoot="C:/project";files=[{id:"target",path:"old.py",content:"print(1)",saved:"print(1)",baseline:"print(1)",disk:{path:"C:/project/old.py",version:"v1"}}];sidebarView="explorer";promptValue=(title,help,path,done)=>{window.renameDone=done("new.py")}');
  h.events.keydown({ key: 'F2', target: { closest: () => ({ dataset: { file: 'target' } }) }, preventDefault() {}, stopPropagation() {} });
  await h.context.window.renameDone;
  assert.equal(calls[0].command, 'rename_document');
  assert.equal(calls[0].args.path, 'C:/project/old.py');
  assert.equal(calls[0].args.destination.replaceAll('\\', '/'), 'C:/project/new.py');
  assert.equal(calls[0].args.expectedVersion, 'v1');
  assert.equal(h.run('files[0].path'), 'new.py');
});
