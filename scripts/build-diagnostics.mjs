import { build } from 'esbuild';
import fs from 'node:fs/promises';

await fs.mkdir('dist/vendor/diagnostics', { recursive: true });
await build({ entryPoints: ['src/diagnostics-worker.mjs'], bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof',
  outfile: 'dist/vendor/diagnostics/worker.js' });
await fs.copyFile('node_modules/@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm', 'dist/vendor/diagnostics/ruff.wasm');
await fs.copyFile('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'dist/vendor/diagnostics/web-tree-sitter.wasm');
for (const [pkg, grammar] of [['c-sharp', 'c_sharp'], ['cpp', 'cpp'], ['java', 'java']]) {
  await fs.copyFile(`node_modules/tree-sitter-${pkg}/tree-sitter-${grammar}.wasm`, `dist/vendor/diagnostics/tree-sitter-${grammar}.wasm`);
}
for (const [pkg, name] of [['@astral-sh/ruff-wasm-web', 'Ruff'], ['yaml', 'YAML'], ['smol-toml', 'TOML'], ['fast-xml-parser', 'XML'],
  ['web-tree-sitter', 'Tree-sitter'], ['tree-sitter-c-sharp', 'CSharp'], ['tree-sitter-cpp', 'CPP'], ['tree-sitter-java', 'Java']]) {
  await fs.copyFile(`node_modules/${pkg}/LICENSE`, `dist/vendor/diagnostics/${name}-LICENSE.txt`);
}
console.log('Bundled offline diagnostics worker and Python, C#, C++, and Java WASM parsers.');
