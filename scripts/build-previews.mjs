import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const out='dist/vendor/previews';fs.mkdirSync(out,{recursive:true});
const markdown=await build({stdin:{contents:"import MarkdownIt from 'markdown-it';window.BlueGayMarkdown=new MarkdownIt({html:false,linkify:true,breaks:false});",resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(out,'markdown.js'),minify:true,metafile:true,legalComments:'eof'});
const packages=new Map();
for(const input of Object.keys(markdown.metafile.inputs)){
  if(input==='<stdin>')continue;
  let directory=path.dirname(path.resolve(input));
  while(directory!==path.dirname(directory)){
    const manifest=path.join(directory,'package.json');
    if(fs.existsSync(manifest)){const metadata=JSON.parse(fs.readFileSync(manifest));if(metadata.name){packages.set(metadata.name,{directory,...metadata});break;}}
    directory=path.dirname(directory);
  }
}
let notices='# Bundled Markdown dependencies\n\nThese components retain their individual licenses.\n\n';
for(const [name,pkg]of packages){
  const license=['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','LICENSE-MIT.txt'].find(file=>fs.existsSync(path.join(pkg.directory,file)));if(!license)throw Error('Missing dependency license: '+name);
  const target=name.replace(/[^a-zA-Z0-9.-]/g,'-')+'-LICENSE.txt';fs.copyFileSync(path.join(pkg.directory,license),path.join(out,target));notices+=`- ${name} ${pkg.version}: ${pkg.license}; ${target}\n`;
}
fs.writeFileSync(path.join(out,'DEPENDENCY-LICENSES.md'),notices);
for(const file of ['pdf.mjs','pdf.worker.mjs'])fs.copyFileSync('node_modules/pdfjs-dist/build/'+file,path.join(out,file));
for(const dir of ['cmaps','standard_fonts','wasm'])fs.cpSync('node_modules/pdfjs-dist/'+dir,path.join(out,dir),{recursive:true});
for(const [pkg,name]of [['pdfjs-dist','PDF.js-LICENSE'],['markdown-it','markdown-it-LICENSE']])fs.copyFileSync('node_modules/'+pkg+'/LICENSE',path.join(out,name));
console.log('Bundled offline Markdown and PDF preview libraries.');
