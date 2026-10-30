const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../dist/themes.js');
const harness=require('./ui-harness.cjs');
const luminance=hex=>hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test('every theme has readable editor, muted and syntax text with matching Monaco surfaces',()=>{
  for(const theme of catalog.themes){
    const monaco=catalog.monacoTheme(theme.id,theme.accent);
    assert.equal(monaco.colors['editor.background'],theme.colors.bg);
    assert.equal(monaco.base,theme.mode==='light'?'vs':'vs-dark');
    for(const color of [theme.colors.text,theme.colors.muted,...Object.values(theme.syntax)])assert(contrast(color,theme.colors.editor)>=4.5,`${theme.id}: ${color} contrast`);
  }
  for(const {color} of catalog.accents)assert(contrast(color,catalog.contrastInk(color))>=4.5);
});
test('theme and custom accent survive preferences reload and unknown themes recover safely',()=>{
  const h=harness();h.run("prefs.theme='lavender';prefs.accent='#123456';savePreferences()");
  const next=harness(undefined,Object.fromEntries(h.storage));
  assert.equal(next.run('prefs.theme'),'lavender');assert.equal(next.run('prefs.accent'),'#123456');
  next.run("prefs.theme='removed-theme';prefs.accent='invalid';applyPreferences()");
  assert.equal(next.run('prefs.theme'),'dark');assert.equal(next.run('prefs.accent'),catalog.get('dark').accent);
  assert(next.run("renderThemePreferences('forest')").includes('Forest floor'));
  assert(!next.run("renderThemePreferences('forest')").includes('data-theme="lavender"'));
});
