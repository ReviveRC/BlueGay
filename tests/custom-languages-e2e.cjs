// Rendered editor regression. Uses an isolated settings file and fake AI only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const optional=name=>require(process.env.BLUEGAY_TEST_NODE_MODULES?path.join(process.env.BLUEGAY_TEST_NODE_MODULES,name):name);
const {chromium}=optional('playwright');
(async()=>{
  const {createSettingsHandler}=await import('../settings-server.mjs'),{createAgentHandler}=await import('../agent-server.mjs');
  const artifacts=fs.mkdtempSync(path.resolve('test-artifacts/custom-languages-'));
  const settings=createSettingsHandler({file:path.join(artifacts,'settings.json')}),requests=[];
  const agent=createAgentHandler({getKey:()=> 'fixture-only',fetchImpl:async(_url,options)=>{
    const payload=JSON.parse(options.body),context=JSON.parse(payload.input.at(-1).content);requests.push({payload,context});
    const text=typeof context.before==='string'?(context.selectedSuggestion||'')+'42':'[TEST FIXTURE — no AI call] Language reference received.';
    return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:100,output_tokens:10}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }});
  const root=path.resolve('dist');
  const server=http.createServer(async(req,res)=>{
    if(await agent(req,res)||await settings(req,res))return;
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,page;const errors=[];
  try{
    browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.stack||e.message));
    const open=async()=>{await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.BlueGay?.editor);};
    const setCode=async(code,filename)=>page.evaluate(({code,filename})=>{prefs.autoSave=false;prefs.codePrediction=false;applyPreferences();const existing=filename&&files.find(f=>f.path===filename);if(existing){switchTab(existing.id);editor.getModel().setValue(code);}else if(filename)newFile(filename,code);else editor.getModel().setValue(code);const m=editor.getModel();editor.setPosition(m.getPositionAt(m.getValueLength()));editor.focus();},{code,filename});
    const type=async text=>{await page.keyboard.type(text,{delay:70});};
    await open();const dismiss=page.getByRole('button',{name:'Dismiss',exact:true});if(await dismiss.count())await dismiss.click();await page.evaluate(()=>window.BlueGay.runAction('customLanguages'));
    await page.getByRole('button',{name:'Use Nomix example',exact:true}).click();await page.locator('#language-name').waitFor();
    assert.equal(await page.locator('#language-name').inputValue(),'Nomix');assert.match(await page.locator('#language-reference').inputValue(),/Fetching modules/);
    await page.screenshot({path:path.join(artifacts,'nomix-setup.png')});
    await page.locator('#language-save').click();await page.waitForFunction(()=>customLanguages.packs.length===1&&!document.querySelector('#modal').open);
    await page.screenshot({path:path.join(artifacts,'languages-settings.png')});
    await setCode('','hello.nx');assert.match(await page.locator('#language-status').textContent(),/Nomix/);
    await type('fun');await page.locator('.suggest-widget.visible').waitFor();await page.keyboard.press('Tab');
    assert.match(await page.evaluate(()=>editor.getValue()),/^function name\(args\) \{/);
    assert.equal(await page.evaluate(()=>editor.getModel().getValueInRange(editor.getSelection())),'name');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>editor.getModel().getValueInRange(editor.getSelection())),'args');
    const tokens=await page.evaluate(()=>monaco.editor.tokenize('function run() {\n // note\n print(f"""hello\nworld""")\n}','custom-nomix'));
    assert(tokens[0].some(t=>t.type.startsWith('keyword')));assert(tokens[1].some(t=>t.type.startsWith('comment')));assert(tokens[3].some(t=>t.type.startsWith('string')));
    await setCode('','Demo.java');await type('pub');await page.locator('.suggest-widget.visible').waitFor();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>editor.getValue()),'public');
    await setCode('class Demo {\n  ');await type('sout');await page.locator('.suggest-widget.visible').waitFor();await page.keyboard.press('Tab');assert.match(await page.evaluate(()=>editor.getValue()),/System\.out\.println\(value\);/);
    await setCode('class Demo {\n  ');await type('for');await page.locator('.suggest-widget.visible').waitFor();await page.keyboard.press('Tab');assert.match(await page.evaluate(()=>editor.getValue()),/for \(int i = 0; i < count; i\+\+\)/);
    await page.screenshot({path:path.join(artifacts,'java-tab-snippet.png')});
    await setCode('class Demo {\n  int value = ');
    await page.evaluate(()=>{prefs.codePrediction=true;applyPreferences();editor.focus();return editor.getAction('editor.action.inlineSuggest.trigger').run().catch(error=>{if(error.message!=='Canceled')throw error;});});
    await page.locator('.ghost-text-decoration').first().waitFor({timeout:15000});await page.keyboard.press('Tab');assert.match(await page.evaluate(()=>editor.getValue()),/int value = 42/);
    assert(requests.some(r=>r.context.language==='java'));
    await setCode('class AutoDemo {\n  int value = ','Automatic.java');
    await page.evaluate(()=>{prefs.codePrediction=true;applyPreferences();editor.focus();});
    await type('1 + ');await page.locator('.ghost-text-decoration').first().waitFor({timeout:15000});await page.keyboard.press('Tab');
    assert.match(await page.evaluate(()=>editor.getValue()),/int value = 1 \+ 42/);
    await setCode('value = ','hello.nx');
    await page.evaluate(()=>{prefs.codePrediction=true;applyPreferences();editor.focus();return editor.getAction('editor.action.inlineSuggest.trigger').run().catch(error=>{if(error.message!=='Canceled')throw error;});});
    await page.locator('.ghost-text-decoration').first().waitFor({timeout:15000});
    assert.equal(requests.at(-1).context.languageReference.language,'Nomix');assert.match(requests.at(-1).context.languageReference.reference,/randomInt/);
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>editor.getValue()),'value = 42');
    await page.evaluate(()=>{prefs.codePrediction=false;applyPreferences();attachChatFile(currentFile());toggleChatLGBT(true);});
    await page.locator('#chat-prompt').fill('Explain this Nomix code.');await page.locator('#chat-send').click();
    await page.waitForFunction(()=>document.querySelector('#chat-messages').textContent.includes('Language reference received'));
    assert.equal(requests.at(-1).context.languageReferences[0].language,'Nomix');
    await page.reload();await page.waitForFunction(()=>!!window.BlueGay?.editor);assert.equal(await page.evaluate(()=>customLanguages.packs[0].name),'Nomix');
    await page.evaluate(()=>{prefs.codePrediction=false;applyPreferences();newFile('remove.nx','print(1)');window.BlueGay.runAction('customLanguages');});
    await page.locator('[data-language-remove="nomix"]').click();await page.getByRole('button',{name:'Remove language',exact:true}).click();
    await page.waitForFunction(()=>customLanguages.packs.length===0);assert.equal(await page.evaluate(()=>languageFor(files.find(f=>f.path==='remove.nx'))),'plaintext');
    await page.locator('#language-import-file').setInputFiles('dist/language-packs/nomix.json');await page.locator('#language-save').click();await page.waitForFunction(()=>customLanguages.packs.length===1);
    assert.equal(await page.evaluate(()=>models.get(files.find(f=>f.path==='remove.nx').id).getLanguageId()),'custom-nomix');
    // Rapid synthetic model changes can cancel Monaco's own worker promises.
    // A cancellation is expected; every other uncaught error fails this check.
    assert.deepEqual(errors.filter(error=>!/^Canceled: Canceled(?:\n|$)/.test(error)),[]);console.log('Rendered checks passed: Nomix setup/import/removal/reload, tokenization, snippet placeholders, Java keyword and snippet Tab acceptance, automatic Java predictions, Java/Nomix inline acceptance, and chat reference context.');console.log('Screenshots: '+artifacts);
  }catch(error){if(page){await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({file:currentFile()?.path,language:editor.getModel()?.getLanguageId(),prediction:codePredictions?.status(),chat:document.querySelector('#chat-status')?.textContent,modal:document.querySelector('#modal')?.textContent.slice(0,700),settings:window.BlueGaySettings.state,languages:customLanguages?.packs.map(p=>p.id),toasts:document.querySelector('#toasts')?.textContent,replaceError:window.customReplaceError})).catch(()=>({})));}console.error(errors);console.error('Artifacts: '+artifacts);throw error;}
  finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
