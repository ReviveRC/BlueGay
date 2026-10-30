/* Shared theme catalog: workbench, Monaco, and preference previews. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BlueGayThemes=factory();
})(typeof window==='object'?window:globalThis,function(){
  // id, label, mode, background, base, sidebar, raised, hover, border, text, muted, accent
  const rows=[
    ['dark','BlueGay dark','dark','#17191f','#111318','#14161c','#1e212a','#262a35','#343947','#d4d8e4','#9aa3b7','#8aa4ff'],
    ['midnight','Midnight blue','dark','#0c1426','#080f1e','#0a1222','#15203a','#1c2a46','#30435f','#ced8ed','#97aac8','#8aa4ff'],
    ['graphite','Graphite','dark','#222222','#161616','#1c1c1c','#2b2b2b','#363636','#484848','#eeeeee','#aaaaaa','#c0c7d4'],
    ['obsidian','Obsidian','dark','#08090c','#030406','#06070a','#15171e','#242630','#3d414e','#f1f3fa','#a1a8bb','#76d5ff'],
    ['dracula','Vampire violet','dark','#282a36','#191a24','#22232e','#303240','#3d4052','#54586c','#f8f8f2','#b3accd','#bd93f9'],
    ['nord','Arctic night','dark','#242c38','#1b222c','#202733','#2e3847','#3a4658','#4c5c72','#e5edf7','#a3b5cd','#88c0d0'],
    ['forest','Forest floor','dark','#14231d','#0c1712','#101d17','#1e3026','#2b4033','#3b5946','#dbece0','#9bb9a5','#86bca0'],
    ['ocean','Deep ocean','dark','#0c232e','#071922','#0a1e28','#15333e','#204552','#346171','#dbf0f5','#94b8c7','#65d4da'],
    ['rose','Rose quartz','dark','#291c27','#1b121b','#221721','#352634','#483347','#63485f','#f3e3ee','#c3a1bb','#f0a3ce'],
    ['dusk','Purple dusk','dark','#211c34','#151123','#1b172c','#2e2744','#403657','#584b75','#eae2fb','#b4a6ce','#aa8ff0'],
    ['coffee','Coffeehouse','dark','#29211c','#1b1612','#221c17','#382d25','#493a30','#655041','#f0e5d9','#c0ab96','#e4ae77'],
    ['light','Daylight','light','#f7f8fc','#edf0f6','#f0f2f8','#ffffff','#e2e7f1','#c5ccdb','#343b50','#616e85','#405ac2'],
    ['paper','Paper','light','#fffdf6','#eeeadd','#f7f3e8','#ffffff','#e9e2cf','#c9bea6','#3c352a','#76684f','#936232'],
    ['porcelain','Porcelain','light','#ffffff','#f0f1f3','#f7f7f8','#ffffff','#e8e9ee','#c6c9d2','#272b35','#646b7b','#526274'],
    ['mint','Mint cream','light','#f3fbf5','#dfeee3','#eaf5ed','#ffffff','#d6e9dc','#aecbb8','#243c2d','#526f5c','#287652'],
    ['lavender','Lavender milk','light','#f8f4ff','#e9e1f3','#f0eaf8','#ffffff','#e4daf2','#c4b5da','#392e4d','#726185','#7750b5'],
    ['peach','Peach blossom','light','#fff6f1','#f4e4da','#fbeee6','#ffffff','#efd8c9','#d6b8a4','#49342b','#836254','#b44e37'],
    ['sand','Desert sand','light','#faf5e9','#ebe1ca','#f3ebd8','#fffdf7','#e7d9bb','#c9b58c','#433a27','#78694a','#826516']
  ];
  const themes=rows.map(([id,label,mode,bg,base,sidebar,raised,hover,line,text,muted,accent])=>({
    id,label,mode,accent,colors:{bg,base,sidebar,raised,hover,line,text,muted,editor:bg},
    syntax:mode==='light'?{comment:muted,keyword:accent,string:'#34683e',number:'#915c23',type:'#2b638a',delimiter:'#657084'}:{comment:muted,keyword:accent,string:'#a6d5ab',number:'#e7bb86',type:'#8dcddd',delimiter:'#b2bacb'}
  }));
  const accents=[['Periwinkle','#8aa4ff'],['Violet','#aa8ff0'],['Lilac','#bd93f9'],['Rose','#d58fb7'],['Bubblegum','#f0a3ce'],['Coral','#ff8f91'],['Peach','#ffb199'],['Amber','#e4ae77'],['Gold','#e6c86e'],['Lime','#b6d77d'],['Sage','#86bca0'],['Seafoam','#75d5ae'],['Teal','#65d4da'],['Glacier','#79bbc9'],['Sky','#76d5ff'],['Silver','#c0c7d4'],['Cobalt','#405ac2'],['Plum','#7750b5'],['Berry','#a83f78'],['Brick','#b44e37'],['Ochre','#826516'],['Emerald','#287652'],['Lagoon','#16768a'],['Slate','#526274']].map(([label,color])=>({label,color}));
  const get=id=>themes.find(t=>t.id===id)||themes[0];
  function contrastInk(color){
    const rgb=color.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    return luminance>.179?'#000000':'#ffffff';
  }
  function monacoTheme(id,accent){
    const theme=get(id),c=theme.colors;
    return {base:theme.mode==='light'?'vs':'vs-dark',inherit:true,
      rules:Object.entries(theme.syntax).map(([token,color])=>({token:token==='type'?'type.identifier':token,foreground:color.slice(1),...(token==='comment'?{fontStyle:'italic'}:{})})),
      colors:{'editor.background':c.editor,'editor.foreground':c.text,'editorLineNumber.foreground':c.muted,'editorLineNumber.activeForeground':accent,'editorCursor.foreground':accent,'editor.lineHighlightBackground':c.raised,'editor.selectionBackground':accent+'40','editor.inactiveSelectionBackground':accent+'25','editorIndentGuide.background1':c.line,'editorWidget.background':c.raised,'editorWidget.foreground':c.text,'editorSuggestWidget.background':c.raised,'editorSuggestWidget.foreground':c.text,'editorSuggestWidget.border':c.line,'editorSuggestWidget.selectedBackground':c.hover,'editorSuggestWidget.selectedForeground':c.text,'editorHoverWidget.background':c.raised,'editorHoverWidget.foreground':c.text,'editorHoverWidget.border':c.line,'editorGutter.background':c.editor,'minimap.background':c.editor,'scrollbarSlider.background':c.muted+'44','scrollbarSlider.hoverBackground':c.muted+'77'}
    };
  }
  return {themes,accents,get,contrastInk,monacoTheme};
});
