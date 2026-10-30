import { Parser, Language } from 'web-tree-sitter';

export const syntaxLanguages = {
  csharp: { name: 'C#', asset: 'tree-sitter-c_sharp.wasm' },
  cpp: { name: 'C++', asset: 'tree-sitter-cpp.wasm' },
  java: { name: 'Java', asset: 'tree-sitter-java.wasm' }
};

// Asset loading is supplied by the worker; tests use the same packaged WASM from disk.
export function createSyntaxAnalyzer(readAsset) {
  let initialized;
  const grammars = new Map();
  return async function analyzeSyntax(language, text) {
    const spec = syntaxLanguages[language];
    if (!spec) return [];
    initialized ??= Promise.resolve().then(async () => {
      await Parser.init({ wasmBinary: await readAsset('web-tree-sitter.wasm') });
    }).catch(error => { initialized = undefined; throw error; });
    await initialized;
    if (!grammars.has(language)) {
      grammars.set(language, Promise.resolve().then(async () =>
        Language.load(await readAsset(spec.asset))).catch(error => { grammars.delete(language); throw error; }));
    }
    const grammar = await grammars.get(language);
    const parser = new Parser();
    let tree, cursor;
    try {
      parser.setLanguage(grammar);
      const deadline = performance.now() + 1500;
      tree = parser.parse(text, null, { progressCallback: () => performance.now() > deadline });
      if (!tree) throw Error('Syntax checking timed out');
      const markers = [];
      cursor = tree.walk();
      // Walk only erroneous branches, including unnamed missing punctuation.
      // Report the outer ERROR once instead of cascading overlapping messages.
      for (;;) {
        const node = cursor.currentNode;
        // Some grammars wrap an invisible missing token in a zero-width leaf
        // (notably C#'s identifier); that wrapper hasError but not isMissing.
        const missing = node.isMissing || (node.hasError && node.childCount === 0 && node.startIndex === node.endIndex);
        if (node.isError || missing) {
          const start = node.startPosition, end = node.endPosition;
          const token = missing ? node.type : node.text.split(/\r?\n/, 1)[0].trim().slice(0, 60);
          const message = missing ? token === 'identifier' ? 'Expected an expression or identifier.' : `Expected ${JSON.stringify(token)}.` :
            `Invalid ${spec.name} syntax${token ? ' near ' + JSON.stringify(token) : ''}. Check the statement and its delimiters.`;
          markers.push({ source: `${spec.name} syntax`, code: missing ? 'missing-token' : 'syntax-error',
            message, severity: 8, startLineNumber: start.row + 1, startColumn: start.column + 1,
            endLineNumber: end.row + 1, endColumn: end.column + 1 });
          if (markers.length === 100) break;
        } else if (node.hasError && cursor.gotoFirstChild()) continue;
        while (!cursor.gotoNextSibling()) {
          if (!cursor.gotoParent()) return markers;
        }
      }
      return markers;
    } finally {
      cursor?.delete();
      tree?.delete();
      parser.delete();
    }
  };
}
