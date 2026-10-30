const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const harness=require('./ui-harness.cjs');
const source=fs.readFileSync('dist/i18n.js','utf8');

test('French Canadian language is saved and restored with preferences',()=>{
  const h=harness(async()=>{});
  h.run(source);
  h.run("prefs.locale='fr-CA';savePreferences()");
  const saved=h.storage.get('bluegay.preferences');
  assert.equal(JSON.parse(saved).locale,'fr-CA');
  const reopened=harness(async()=>{},{'bluegay.preferences':saved});
  reopened.run(source);reopened.run('applyPreferences()');
  assert.equal(reopened.run("window.BlueGayI18n.translate('Preferences')"),'Préférences');
  reopened.run("prefs.locale='en';savePreferences()");
  assert.equal(reopened.run("window.BlueGayI18n.translate('Preferences')"),'Preferences');
});

test('UI translation is reversible and leaves protected content unchanged',()=>{
  const text=(value,protectedContent=false)=>({nodeValue:value,parentElement:{closest:()=>protectedContent}});
  const nodes=[text(' Save '),text('Save',true),text('unknown text')];
  const document={body:{},documentElement:{},querySelectorAll:()=>[],createTreeWalker:()=>{let index=0;return {nextNode:()=>nodes[index++]};}};
  const context=vm.createContext({window:{},document});vm.runInContext(source,context);
  context.window.BlueGayI18n.setLocale('fr-CA');
  assert.equal(nodes[0].nodeValue,' Enregistrer ');
  assert.equal(nodes[1].nodeValue,'Save');assert.equal(nodes[2].nodeValue,'unknown text');
  assert.equal(document.documentElement.lang,'fr-CA');
  context.window.BlueGayI18n.refresh();assert.equal(nodes[0].nodeValue,' Enregistrer ');
  context.window.BlueGayI18n.setLocale('en');assert.equal(nodes[0].nodeValue,' Save ');
});

test('welcome buttons and the desktop labels shown in the report are translated',()=>{
  const context=vm.createContext({window:{},document:{}});vm.runInContext(source,context);
  const i18n=context.window.BlueGayI18n;i18n.setLocale('fr-CA');
  for(const label of ['Open a folder','Open a file','Desktop workspace','Manual save','Editing files on your computer','No symbols found. Use Ctrl Shift O for language-service symbols when available.'])assert.notEqual(i18n.translate(label),label,label);
});

test('every directly emitted literal toast has a French translation',()=>{
  const context=vm.createContext({window:{},document:{}});vm.runInContext(source,context);
  const i18n=context.window.BlueGayI18n;i18n.setLocale('fr-CA');
  for(const file of ['app.js','desktop.js','together.js','agent.js']){
    const script=fs.readFileSync('dist/'+file,'utf8');
    for(const [,message]of script.matchAll(/toast\('([^'\\]*)'\s*[,)]/g))assert.notEqual(i18n.translate(message),message,`${file}: ${message}`);
  }
});

test('dynamic toasts translate the message and preserve paths, counts and error details',()=>{
  const context=vm.createContext({window:{},document:{}});vm.runInContext(source,context);
  const i18n=context.window.BlueGayI18n;i18n.setLocale('fr-CA');
  const path='C:\\Projet\\Save\\Été.js';
  assert.equal(i18n.translate(`Saved ${path} to disk.`,true),`${path} enregistré sur le disque.`);
  assert.equal(i18n.translate(`Could not save ${path}: Access denied`,true),`Impossible d’enregistrer ${path} : Access denied`);
  assert.equal(i18n.translate('Opened 1 file.',true),'1 fichier ouvert.');
  assert.equal(i18n.translate('Opened 12 files.',true),'12 fichiers ouverts.');
  assert.equal(i18n.translate('Opened 12 files.'),'Opened 12 files.');
  i18n.setLocale('en');assert.equal(i18n.translate(`Saved ${path} to disk.`,true),`Saved ${path} to disk.`);
});

test('Code Together dialog text is translated, including permissions and network guidance',()=>{
  const h=harness(async()=>{});h.run(fs.readFileSync('dist/together.js','utf8'));h.run('showCodeTogether()');
  const context=vm.createContext({window:{},document:{}});vm.runInContext(source,context);
  const i18n=context.window.BlueGayI18n;i18n.setLocale('fr-CA');
  const html=h.elements.get('#modal-content').innerHTML;
  for(const [,text]of html.matchAll(/>([^<>]+)</g)){
    const label=text.trim();if(!label||label==='×')continue;
    assert.notEqual(i18n.translate(label),label,label);
  }
});

test('ChatLGBT welcome, billing and settings labels and placeholders translate',()=>{
  const context=vm.createContext({window:{},document:{}});vm.runInContext(source,context);
  const i18n=context.window.BlueGayI18n;i18n.setLocale('fr-CA');
  for(const text of ['A LITTLE PRIDE. A LOT OF CODE.','Omg yesss,','let’s build. 💅','I’m ChatLGBT, your coding bestie. Attach some code and we’ll make it slay.','◇ Explain this file','⌕ Look for bugs','✦ Refactor my selection','You choose the context.','You approve every change.','What are we building, bestie?','OpenAI model','Personality','Full sparkle 💅','Save settings','Loading your ChatGPT models…'])assert.notEqual(i18n.translate(text),text,text);
  assert.equal(i18n.translate('~1,234 input tokens · estimate',true),'~1,234 jetons d’entrée · estimation');
});

test('settings-location translation preserves the exact Windows path and restores English',()=>{
  const path='C:\\Users\\lessa\\AppData\\Roaming\\app.bluegay.ide\\settings.json';
  const context=vm.createContext({window:{},document:{}});vm.runInContext(source,context);
  const i18n=context.window.BlueGayI18n;i18n.setLocale('fr-CA');
  assert.equal(i18n.translate('Settings saved locally: '+path,true),'Paramètres enregistrés localement : '+path);
  i18n.setLocale('en');assert.equal(i18n.translate('Settings saved locally: '+path,true),'Settings saved locally: '+path);
});

test('chat welcome and textarea placeholder translate while conversation text is protected',()=>{
  const welcome={nodeValue:'◇ Explain this file',parentElement:{closest:selector=>selector.includes('#chat-messages')}};
  const message={nodeValue:'Open a file',parentElement:{closest:selector=>selector.includes('.chat-text')}};
  const attrs={placeholder:'What are we building, bestie?'};
  const prompt={closest:selector=>selector.includes('textarea,'),hasAttribute:key=>key in attrs,getAttribute:key=>attrs[key],setAttribute:(key,value)=>{attrs[key]=value;}};
  const document={body:{},documentElement:{},querySelectorAll:()=>[prompt],createTreeWalker:()=>{let index=0;return {nextNode:()=>[welcome,message][index++]};}};
  const context=vm.createContext({window:{},document});vm.runInContext(source,context);
  context.window.BlueGayI18n.setLocale('fr-CA');
  assert.equal(welcome.nodeValue,'◇ Expliquer ce fichier');assert.equal(message.nodeValue,'Open a file');
  assert.equal(attrs.placeholder,'Qu’est-ce qu’on crée ensemble?');
  context.window.BlueGayI18n.setLocale('en');assert.equal(welcome.nodeValue,'◇ Explain this file');assert.equal(attrs.placeholder,'What are we building, bestie?');
});
