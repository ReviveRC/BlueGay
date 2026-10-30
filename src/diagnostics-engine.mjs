import init, { Workspace, PositionEncoding } from '@astral-sh/ruff-wasm-web';
import { parseAllDocuments, LineCounter } from 'yaml';
import { parse as parseToml, TomlError } from 'smol-toml';
import { XMLValidator } from 'fast-xml-parser';
import { createSyntaxAnalyzer, syntaxLanguages } from './syntax-diagnostics.mjs';

let python;
let syntaxAnalyzer;
export function initPython(moduleOrPath) {
  return python ??= init({ module_or_path: moduleOrPath }).then(() =>
    new Workspace({ lint: { select: ['E9', 'F'] } }, PositionEncoding.Utf16));
}
const marker = (source, message, line, column, endLine = line, endColumn = column + 1, severity = 8, code) =>
  ({ source, message, startLineNumber: line, startColumn: column, endLineNumber: endLine, endColumn, severity, ...(code ? { code } : {}) });

export async function analyze(language, text, wasmPath) {
  if (Object.hasOwn(syntaxLanguages, language)) {
    syntaxAnalyzer ??= createSyntaxAnalyzer(async name => {
      const response = await fetch(new URL(name, wasmPath));
      if (!response.ok) throw Error(`Could not load ${name}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    return syntaxAnalyzer(language, text);
  }
  if (language === 'python') {
    const workspace = await initPython(wasmPath);
    return workspace.check(text).map(d => ({
      ...marker('Ruff', d.message, d.start_location.row, d.start_location.column,
        d.end_location.row, d.end_location.column,
        !d.code || d.code === 'invalid-syntax' || /^F(?:63|7|82)/.test(d.code) ? 8 : 4, d.code),
      ...(d.tags.includes('unnecessary') ? { tags: [1] } : {})
    }));
  }
  if (language === 'yaml') {
    const lineCounter = new LineCounter();
    return parseAllDocuments(text, { lineCounter, prettyErrors: false }).flatMap(doc =>
      [...doc.errors.map(error => [error, 8]), ...doc.warnings.map(error => [error, 4])].map(([error, severity]) => {
        const start = lineCounter.linePos(error.pos[0]), end = lineCounter.linePos(error.pos[1]);
        return marker('YAML', error.message, start.line, start.col, end.line, end.col, severity, error.code);
      }));
  }
  if (language === 'toml') {
    try { parseToml(text); return []; }
    catch (error) {
      if (!(error instanceof TomlError)) throw error;
      return [marker('TOML', error.message.split('\n')[0], error.line, error.column)];
    }
  }
  if (language === 'xml') {
    const result = XMLValidator.validate(text);
    return result === true ? [] : [marker('XML', result.err.msg, result.err.line, result.err.col, undefined, undefined, 8, result.err.code)];
  }
  return [];
}
