const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const ready = import('../src/syntax-diagnostics.mjs').then(({ createSyntaxAnalyzer }) =>
  createSyntaxAnalyzer(name => fs.readFile(path.join(__dirname, '../dist/vendor/diagnostics', name))));
const wrappers = {
  csharp: code => `class Example {\n  void Test() {\n    ${code}\n  }\n}`,
  cpp: code => `int main() {\n  ${code}\n}`,
  java: code => `class Example {\n  void test() {\n    ${code}\n  }\n}`
};

for (const [language, wrap] of Object.entries(wrappers)) {
  test(`${language}: malformed if/else, loops, declarations and missing punctuation are diagnosed`, async () => {
    const analyze = await ready;
    for (const statement of [
      'if ready { work(); }', 'if (ready { work(); }', 'if () { work(); }',
      'if (/* condition missing */) {}', 'if (ready &&) {}',
      'if (ready) { work() }', 'if (ready) { work();',
      'else { work(); }', 'while (ready { work(); }',
      'int count = ;', 'for (int i = 0 i < 5; i++) {}', 'String text = "unterminated;'
    ]) {
      const markers = await analyze(language, wrap(statement));
      assert(markers.length, `${language} should reject: ${statement}`);
      assert(markers.every(m => m.severity === 8 && m.startLineNumber > 0 && m.startColumn > 0));
    }
  });
  test(`${language}: valid control flow, strings/comments, unknown types and empty files are accepted`, async () => {
    const analyze = await ready;
    for (const statement of [
      'if (ready) { work(); } else if (other) work(); else wait();',
      'for (int i = 0; i < 5; i++) { work(); }', 'for (;;) { break; }',
      'while (ready) { work(); }', 'do { work(); } while (ready);',
      '/* if ( ] } */ work(); // if () {\n', 'work("if ( ] } 💅");',
      'UnknownType value; missingFunction(value);'
    ]) assert.deepEqual(await analyze(language, wrap(statement)), [], statement);
    assert.deepEqual(await analyze(language, ''), []);
  });
  test(`${language}: fixing a condition clears results and UTF-16/CRLF locations match the editor`, async () => {
    const analyze = await ready;
    const code = wrap('work("💅"); int value = ;').replaceAll('\n', '\r\n');
    const lines = code.split('\r\n'), line = lines.findIndex(s => s.includes('value'));
    const marker = (await analyze(language, code)).find(m => m.startLineNumber === line + 1);
    assert(marker, 'diagnostic should point at the invalid declaration');
    assert.equal(marker.startColumn, lines[line].indexOf('=') + 1);
    assert((await analyze(language, wrap('if () {}'))).length);
    assert.deepEqual(await analyze(language, wrap('if (ready) {}')), []);
  });
}

test('modern language syntax is accepted without compiler/type resolution', async () => {
  const analyze = await ready;
  assert.deepEqual(await analyze('csharp', 'namespace Demo; public record Person(string Name); class A { int[] data = [1, 2, 3]; }'), []);
  assert.deepEqual(await analyze('cpp', '#include <vector>\ntemplate<typename T> T twice(T x) { return x + x; }\nint main() { auto f = [](int x) { return x; }; if constexpr (true) { f(1); } }'), []);
  assert.deepEqual(await analyze('java', 'record Person(String name) {} class A { int test(int n) { return switch(n) { case 1 -> 2; default -> 0; }; } }'), []);
});

test('repeated edits and switching between grammars do not leak old syntax results', async () => {
  const analyze = await ready;
  for (let i = 0; i < 10; i++) for (const [language, wrap] of Object.entries(wrappers)) {
    assert((await analyze(language, wrap('if () {}'))).length);
    assert.deepEqual(await analyze(language, wrap('if (valid) {}')), []);
  }
});
