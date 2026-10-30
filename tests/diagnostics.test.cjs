const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const engine = import('../src/diagnostics-engine.mjs');
const wasm = fs.readFileSync(require.resolve('@astral-sh/ruff-wasm-web').replace('ruff_wasm.js', 'ruff_wasm_bg.wasm'));
async function analyze(language, text) { return (await engine).analyze(language, text, wasm); }

test('Python catches syntax and indentation errors', async () => {
  for (const text of ['def greet()\n    pass\n', 'if True:\nprint(1)\n']) {
    const markers = await analyze('python', text);
    assert(markers.some(m => m.code === 'invalid-syntax' && m.severity === 8));
  }
});
test('Python distinguishes unused imports/variables from undefined names', async () => {
  const markers = await analyze('python', 'import os\ndef greet():\n    unused = 1\n    print(missing)\n');
  assert(markers.some(m => m.code === 'F401' && m.severity === 4));
  assert(markers.some(m => m.code === 'F841' && m.startLineNumber === 3));
  assert(markers.some(m => m.code === 'F821' && m.severity === 8 && m.startLineNumber === 4));
});
test('Python accepts valid code and returns UTF-16 columns after non-BMP text', async () => {
  assert.deepEqual(await analyze('python', 'def greet(name):\n    return f"Hello {name}"\n'), []);
  const text = 'print("💅", missing)\r\n';
  const marker = (await analyze('python', text)).find(m => m.code === 'F821');
  assert.equal(marker.startColumn, text.indexOf('missing') + 1);
  assert.equal(marker.endColumn, text.indexOf('missing') + 8);
});
test('YAML validates syntax, duplicate keys and multi-document files', async () => {
  assert((await analyze('yaml', 'items: [one\n')).length);
  assert((await analyze('yaml', 'a: 1\na: 2\n')).some(m => m.code === 'DUPLICATE_KEY' && m.startLineNumber === 2));
  assert.deepEqual(await analyze('yaml', 'a: 1\n---\na: 2\n'), []);
});
test('TOML validates syntax and duplicate keys with line numbers', async () => {
  assert.deepEqual(await analyze('toml', '[app]\nname = "BlueGay"\n'), []);
  assert.equal((await analyze('toml', 'a = 1\na = 2\n'))[0].startLineNumber, 2);
  assert((await analyze('toml', 'a =\n')).length);
});
test('XML validates matching tags without fetching external entities', async () => {
  assert.deepEqual(await analyze('xml', '<root><item /></root>'), []);
  assert((await analyze('xml', '<root>\n<item></root>')).length);
});
test('unsupported languages are left to their own providers', async () => {
  assert.deepEqual(await analyze('typescript', 'let x = ;'), []);
});

test('diagnostic lifecycle rejects stale results and clears markers on language changes/disposal', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { BlueGayDiagnostics } = require('../dist/diagnostics.js');
  let language = 'python', version = 1, disposed = false, contentChanged, willDispose, languageChanged, markers;
  const noop = { dispose() {} };
  const model = { getLanguageId: () => language, getVersionId: () => version, isDisposed: () => disposed,
    getValueLength: () => 12, getValue: () => 'print(nope)', validateRange: m => m,
    onDidChangeContent: cb => (contentChanged = cb, noop), onWillDispose: cb => (willDispose = cb, noop) };
  const monaco = { editor: { onDidChangeModelLanguage: cb => (languageChanged = cb, noop), setModelMarkers: (m, o, value) => { markers = value; } } };
  const jobs = [], worker = { postMessage: job => jobs.push(job), terminate() {} };
  const service = BlueGayDiagnostics.install(monaco, () => {}, () => worker);
  service.track(model); t.mock.timers.tick(350);
  const first = jobs[0];
  version++; contentChanged(); t.mock.timers.tick(350);
  worker.onmessage({ data: { id: first.id, markers: [{ message: 'stale' }] } });
  assert.deepEqual(markers, []);
  worker.onmessage({ data: { id: jobs[1].id, markers: [{ message: 'fresh' }] } });
  assert.equal(markers[0].message, 'fresh');
  language = 'plaintext'; languageChanged({ model });
  assert.deepEqual(markers, []); assert.deepEqual(service.status(), []);
  language = 'python'; languageChanged({ model }); t.mock.timers.tick(350);
  willDispose(); disposed = true;
  worker.onmessage({ data: { id: jobs[2].id, markers: [{ message: 'disposed' }] } });
  assert.deepEqual(service.status(), []); service.dispose();
});

test('worker failure is visible instead of reporting clean diagnostics', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { BlueGayDiagnostics } = require('../dist/diagnostics.js');
  const noop = { dispose() {} };
  const model = { getLanguageId: () => 'python', isDisposed: () => false, getValueLength: () => 1,
    onDidChangeContent: () => noop, onWillDispose: () => noop };
  const service = BlueGayDiagnostics.install({ editor: { onDidChangeModelLanguage: () => noop, setModelMarkers() {} } }, () => {}, () => { throw Error('blocked'); });
  service.track(model); t.mock.timers.tick(350);
  assert.match(service.status()[0], /unavailable/); service.dispose();
});
