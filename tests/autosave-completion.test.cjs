const { test } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./ui-harness.cjs');

test('autosave does not rewrite in-progress abbreviations or invoke formatting', async () => {
  const h = harness();
  h.run(`newFile('completion.html', 'p  ');
    prefs.finalNewline=true; prefs.trimWhitespace=true; prefs.formatOnSave=true;
    editor={getPosition:()=>null, getSelection:()=>null, getAction(){throw new Error('Autosave must not run a formatter');}};
    models.set(currentFile().id, {getEOL:()=> '\\n', pushEditOperations(){throw new Error('Autosave must not rewrite the model');}});`);
  assert.equal(await h.run('saveFile(currentFile(),false,{automatic:true})'), true);
  assert.equal(h.run('currentFile().content'), 'p  ');
  assert.equal(h.run('currentFile().saved'), 'p  ');
});

test('explicit save still applies whitespace and final-newline preferences', async () => {
  const h = harness();
  h.run(`newFile('completion.html', '<p>text</p>  '); prefs.trimWhitespace=true; prefs.finalNewline=true;`);
  assert.equal(await h.run('saveFile(currentFile(),true)'), true);
  assert.equal(h.run('currentFile().saved'), '<p>text</p>\n');
});
