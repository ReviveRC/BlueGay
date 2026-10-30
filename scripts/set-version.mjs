import fs from 'node:fs';
const next=process.argv[2];if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(next||''))throw Error('Usage: node scripts/set-version.mjs 1.0.1');
const current=JSON.parse(fs.readFileSync('package.json','utf8')).version;
for(const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json']){
  const data=JSON.parse(fs.readFileSync(file,'utf8'));data.version=next;if(data.packages?.[''])data.packages[''].version=next;fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}
for(const file of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock','dist/updates.js','dist/app.js']){
  let source=fs.readFileSync(file,'utf8');
  if(file.endsWith('Cargo.lock'))source=source.replace(/(name = "bluegay"\r?\nversion = ")[^"]+"/,(_,prefix)=>prefix+next+'"');
  else if(file.endsWith('Cargo.toml'))source=source.replace('version = "'+current+'"','version = "'+next+'"');
  else if(file.endsWith('updates.js'))source=source.replace("version:'"+current+"'","version:'"+next+"'");
  else source=source.replaceAll('Version '+current,'Version '+next).replaceAll('BlueGay '+current,'BlueGay '+next);
  fs.writeFileSync(file,source);
}
console.log('Version set to '+next+'. Rebuild and sign a new release before publishing.');
