// Source-only validation. This script never invokes Cargo or a native compiler.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const capability=JSON.parse(fs.readFileSync('src-tauri/capabilities/main.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
assert.equal(config.bundle.active,false,'This project produces a standalone executable; installer packaging is disabled.');
assert.equal(config.app.withGlobalTauri,true);
assert.equal(config.app.windows[0].label,'main');
assert.deepEqual(capability.windows,['main']);
assert.equal(pkg.scripts['desktop:build'],'tauri build --no-bundle');
assert(fs.existsSync(path.resolve('src-tauri',config.build.frontendDist,'index.html')));
for(const icon of config.bundle.icon)assert(fs.existsSync(path.join('src-tauri',icon)),`Missing app icon ${icon}`);
const html=fs.readFileSync('dist/index.html','utf8');
for(const [,asset]of html.matchAll(/<script src="([^"]+)"/g))assert(fs.existsSync(path.join('dist',asset)),`Missing script ${asset}`);
assert(html.indexOf('desktop-io.js')<html.indexOf('desktop.js'));
assert(html.indexOf('desktop.js')<html.indexOf('boot.js'));
for(const asset of ['java-tools.js','debugger-core.js','debugger.js','browser-preview.js','javascript-intelligence.js','code-prediction.js','themes.js','agent-core.js','agent.js','html-completions.js','diagnostics.js','vendor/diagnostics/worker.js','vendor/diagnostics/ruff.wasm','vendor/diagnostics/web-tree-sitter.wasm','vendor/diagnostics/tree-sitter-c_sharp.wasm','vendor/diagnostics/tree-sitter-cpp.wasm','vendor/diagnostics/tree-sitter-java.wasm','vendor/vs/loader.js','app.js'])assert(fs.existsSync(path.join('dist',asset)));
assert(html.indexOf('settings-client.js')<html.indexOf('boot.js'));
for(const script of ['dist/java-tools.js','dist/debugger-core.js','dist/debugger.js','dist/browser-preview.js','dist/javascript-intelligence.js','dist/code-prediction.js','dist/tools.js','dist/documentation-core.js','dist/documentation.js','dist/updates.js','scripts/create-release.mjs','dist/i18n.js','dist/together.js','dist/themes.js','dist/boot.js','dist/settings-client.js','settings-server.mjs','dist/html-completions.js','dist/diagnostics.js','src/diagnostics-engine.mjs','src/syntax-diagnostics.mjs','src/diagnostics-worker.mjs','scripts/build-diagnostics.mjs','dist/app.js','dist/desktop.js','dist/desktop-io.js','dist/agent-core.js','dist/agent.js','agent-server.mjs','serve.mjs']){
  const result=spawnSync(process.execPath,['--check',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
const main=fs.readFileSync('src-tauri/src/main.rs','utf8');
const previewRust=['previews','launch'].map(name=>fs.readFileSync('src-tauri/src/'+name+'.rs','utf8')).join('\n');
for(const script of ['dist/preview-core.js','dist/previews.js','dist/error-help.js','preview-server.mjs','scripts/build-previews.mjs'])assert.equal(spawnSync(process.execPath,['--check',script],{encoding:'utf8'}).status,0,script);
for(const asset of ['vendor/previews/markdown.js','vendor/previews/pdf.mjs','vendor/previews/pdf.worker.mjs'])assert(fs.existsSync(path.join('dist',asset)),`Missing preview library ${asset}`);
const rust=fs.readFileSync('src-tauri/src/debugger.rs','utf8')+fs.readFileSync('src-tauri/src/html_preview.rs','utf8')+fs.readFileSync('src-tauri/src/disk.rs','utf8')+fs.readFileSync('src-tauri/src/agent.rs','utf8')+fs.readFileSync('src-tauri/src/settings.rs','utf8')+fs.readFileSync('src-tauri/src/together.rs','utf8')+fs.readFileSync('src-tauri/src/chatgpt.rs','utf8')+fs.readFileSync('src-tauri/src/updater.rs','utf8');
const frontend=fs.readFileSync('dist/debugger.js','utf8')+fs.readFileSync('dist/browser-preview.js','utf8')+fs.readFileSync('dist/settings-client.js','utf8')+fs.readFileSync('dist/desktop.js','utf8')+fs.readFileSync('dist/desktop-io.js','utf8')+fs.readFileSync('dist/app.js','utf8')+fs.readFileSync('dist/agent.js','utf8')+fs.readFileSync('dist/together.js','utf8')+fs.readFileSync('dist/updates.js','utf8');
for(const [,name]of (frontend+fs.readFileSync('dist/previews.js','utf8')).matchAll(/(?:call|invoke|togetherNative)\('([a-z_]+)'/g)){
  assert(main.includes(name),`IPC command ${name} is not registered`);
  assert(new RegExp(`fn ${name}\\b`).test(rust+main+previewRust),`IPC command ${name} has no backend`);
}
console.log('Source checks passed: JavaScript syntax, native configuration, local assets, and IPC registration.');
assert.equal(config.version,pkg.version,'Desktop and npm versions must match.');
assert.equal(JSON.parse(fs.readFileSync('package-lock.json','utf8')).version,pkg.version);
assert(fs.readFileSync('src-tauri/Cargo.toml','utf8').includes(`version = "${pkg.version}"`));
assert(fs.readFileSync('dist/updates.js','utf8').includes(`version:'${pkg.version}'`));
const accountScript=fs.readFileSync('dist/account.js','utf8');
assert.equal(spawnSync(process.execPath,['--check','dist/account.js'],{encoding:'utf8'}).status,0);
assert(fs.readFileSync('dist/boot.js','utf8').includes("'account.js'"));
for(const [,name]of accountScript.matchAll(/call\('([a-z_]+)'/g)){assert(main.includes(name),`Account command ${name} is not registered`);assert(new RegExp(`fn ${name}\\b`).test(rust+main),`Account command ${name} has no backend`);}
