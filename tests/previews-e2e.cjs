// Explicit rendered integration test. Start serve.mjs on BLUEGAY_PORT first.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const optional=name=>require(process.env.BLUEGAY_TEST_NODE_MODULES?path.join(process.env.BLUEGAY_TEST_NODE_MODULES,name):name);
const {chromium}=optional('playwright'),{PDFDocument,StandardFonts}=optional('pdf-lib');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto('http://127.0.0.1:'+(process.env.BLUEGAY_PORT||4181));await page.waitForFunction(()=>!!window.BlueGay?.editor);
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let n=1;n<=2;n++)pdf.addPage([595,842]).drawText('BlueGay PDF preview - page '+n,{x:50,y:760,size:24,font});const pdfBytes=Array.from(await pdf.save());
    const png=Array.from(fs.readFileSync('dist/assets/bluegay-pride-logo.png'));
    const fixture=path.resolve('test-artifacts/preview project été');fs.mkdirSync(fixture,{recursive:true});fs.writeFileSync(path.join(fixture,'sample.pdf'),Buffer.from(pdfBytes));fs.writeFileSync(path.join(fixture,'logo.png'),Buffer.from(png));fs.writeFileSync(path.join(fixture,'README.md'),'# Native Markdown preview\n\n![Logo](logo.png)\n');fs.writeFileSync(path.join(fixture,'index.html'),'<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Native live preview</h1><img src="logo.png" width="100"><script type="module" src="module.mjs"></script></body></html>');fs.writeFileSync(path.join(fixture,'style.css'),'body { background: #ecf3ff; color: #233a91; font: 24px system-ui; padding: 25px; }');fs.writeFileSync(path.join(fixture,'module.mjs'),'document.body.dataset.module="loaded";');
    await page.evaluate(({pdfBytes,png})=>{
      prefs.codePrediction=false;prefs.autoSave=false;editor.updateOptions({inlineSuggest:{enabled:false}});
      window.BlueGayPreviews.reset();files.forEach(f=>models.get(f.id)?.dispose());models.clear();files=[];tabs=[];activeId=null;
      const entries=[{path:'pages/été #1.html',content:'<!doctype html><html><head><link rel="stylesheet" href="../styles/main.css"></head><body><h1 id="title">Live preview works</h1><img src="../images/logo.png" width="90"><script type="module" src="../scripts/main.mjs"></script></body></html>'},{path:'styles/main.css',content:'body { background: rgb(235, 242, 255); font: 22px system-ui; padding: 24px; } h1 { color: rgb(35, 58, 145); }'},{path:'scripts/main.mjs',content:'import {value} from "./value.mjs"; document.body.dataset.module=value;try { parent.__TAURI__; } catch { window.bridgeBlocked=true; }'}, {path:'scripts/value.mjs',content:'export const value="loaded";'}, {path:'README.md',content:'# Markdown preview\n\n**Bold text**, a table, and an image.\n\n![Logo](images/logo.png)\n\n<script>parent.PREVIEW_ESCAPED=true</script>\n\n[bad](javascript:alert(1))\n'},importedEntry('images/logo.png',new Uint8Array(png)),importedEntry('docs/sample.pdf',new Uint8Array(pdfBytes))];
      files=entries.map(f=>({...f,id:uid(),saved:f.content,baseline:f.content,history:[]}));switchTab(files[0].id);window.BlueGayPreviews.open();
    },{pdfBytes,png});
    await page.waitForFunction(()=>{const f=document.querySelector('#preview-stage iframe');return !!f?.src;});
    const frame=()=>page.frames().find(frame=>frame.url().includes('/__preview/'));
    await page.waitForFunction(()=>document.querySelector('#preview-status').textContent.includes('Updates on save'));
    await new Promise(resolve=>setTimeout(resolve,500));assert(frame());
    await frame().waitForFunction(()=>document.body.dataset.module==='loaded');assert.equal(await frame().locator('h1').textContent(),'Live preview works');
    assert.equal(await frame().locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(235, 242, 255)');
    assert.equal(await frame().locator('img').evaluate(el=>el.naturalWidth>0),true);
    assert.equal(await frame().evaluate(()=>{try{return !!parent.document;}catch{return false;}}),false);
    await page.selectOption('#preview-size','phone');assert.equal(await page.locator('#preview-stage iframe').evaluate(el=>el.style.width),'390px');
    await page.evaluate(async()=>{const css=files.find(f=>f.path.endsWith('main.css'));setDocumentText(css,css.content.replace('235, 242, 255','255, 238, 221'));await saveFile(css);});
    await page.waitForFunction(()=>!document.querySelector('#preview-status').textContent.includes('Updating'));await new Promise(resolve=>setTimeout(resolve,650));
    await frame().waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(255, 238, 221)');
    await page.screenshot({path:'test-artifacts/live-preview.png'});
    await page.evaluate(()=>{switchTab(files.find(f=>f.path==='README.md').id);window.BlueGayPreviews.open();});
    await page.waitForFunction(()=>!!document.querySelector('#preview-stage iframe')?.srcdoc);const markdown=page.frameLocator('#preview-stage iframe');await markdown.locator('h1').waitFor();assert.equal(await markdown.locator('strong').textContent(),'Bold text');assert.equal(await markdown.locator('script').count(),0);assert.equal(await page.evaluate(()=>window.PREVIEW_ESCAPED),undefined);assert.equal(await markdown.locator('a[href^="javascript:"]').count(),0);
    await markdown.locator('img').evaluate(img=>img.complete&&img.naturalWidth?true:new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;}));await page.screenshot({path:'test-artifacts/markdown-preview.png'});
    await page.evaluate(()=>switchTab(files.find(f=>f.path==='images/logo.png').id));await page.waitForFunction(()=>document.querySelector('#asset-view img')?.naturalWidth>0);assert.equal(await page.locator('#asset-view').isVisible(),true);await page.screenshot({path:'test-artifacts/image-preview.png'});
    await page.evaluate(()=>switchTab(files.find(f=>f.path==='docs/sample.pdf').id));await page.waitForFunction(()=>document.querySelector('#asset-view canvas')?.width>0);await page.waitForFunction(()=>document.querySelector('.asset-meta').textContent.includes('1 / 2'));
    await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.asset-meta').textContent.includes('2 / 2'));await page.selectOption('[aria-label="PDF zoom"]','1.5');await page.waitForTimeout(150);await page.screenshot({path:'test-artifacts/pdf-preview.png'});
    await page.evaluate(()=>{switchTab(files.find(f=>f.path==='scripts/main.mjs').id);monaco.editor.setModelMarkers(editor.getModel(),'preview-e2e',[{severity:8,message:'Example failure <unsafe>',startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:7}]);panelView='problems';renderPanel();});
    await page.locator('[data-explain-problem]').first().click();assert.match(await page.locator('#chat-prompt').inputValue(),/Example failure <unsafe>/);assert.equal(await page.locator('.chat-chip').count(),1);assert.equal(await page.locator('.chat-message').count(),0);await page.screenshot({path:'test-artifacts/error-explanation.png'});
    assert.deepEqual(errors,[]);console.log('Rendered HTML/CSS/modules/images, save refresh, phone sizing, sandbox isolation, Markdown safety, image preview, multipage PDF/zoom and error drafts passed.');
  }catch(error){await page.screenshot({path:'test-artifacts/previews-failure.png'});console.error('Browser errors:',errors);throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
