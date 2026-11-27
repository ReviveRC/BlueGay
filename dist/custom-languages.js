/* Declarative language packs. Shared by the editor, settings service and tests. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BlueGayLanguages=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const MAX_BYTES=524288,MAX_PACK_BYTES=65536;
  const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const fail=message=>{throw Error(message);};
  function text(value,label,max,multiline=false){
    if(typeof value!=='string'||value.length>max||(!multiline&&/[\x00-\x1f\x7f]/.test(value))||(multiline&&/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)))fail('Invalid '+label+'.');
    return value;
  }
  function keys(value,allowed,label){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Invalid '+label+' fields.');}
  function strings(value,label,count,max,pattern){
    if(!Array.isArray(value)||value.length>count)fail('Invalid '+label+'.');
    return value.map(item=>{text(item,label,max);if(!item||pattern&&!pattern.test(item))fail('Invalid '+label+': '+item);return item;});
  }
  function validatePack(value){
    keys(value,['schemaVersion','id','name','version','extensions','filenames','keywords','builtins','lineComment','blockComment','brackets','quotes','stringPrefixes','snippets','ai'],'language pack');
    if(value.schemaVersion!==1)fail('Language pack schemaVersion must be 1.');
    const optional=(key,fallback)=>value[key]===undefined?fallback:value[key];
    text(value.id,'language ID',40);if(!/^[a-z][a-z0-9-]*$/.test(value.id))fail('Use a lowercase language ID, such as nomix.');
    text(value.name,'language name',64);if(!value.name.trim())fail('Enter a language name.');
    if(value.version!==undefined)text(value.version,'language version',40);
    strings(value.extensions,'extensions',20,32,/^\.[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
    strings(optional('filenames',[]),'filenames',20,80,/^[^\\/:*?"<>|]+$/);
    if(!value.extensions.length&&!value.filenames?.length)fail('Add a file extension or special filename.');
    for(const field of ['keywords','builtins'])strings(optional(field,[]),field,256,80,/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/);
    text(optional('lineComment',''),'line comment',8);
    for(const field of ['blockComment','brackets']){
      if(value[field]!==undefined&&!Array.isArray(value[field]))fail('Invalid '+field+'.');
      const pairs=field==='blockComment'?(value[field]?.length?[value[field]]:[]):value[field]||[];
      if(!Array.isArray(pairs)||pairs.length>8)fail('Invalid '+field+'.');
      for(const pair of pairs)if(!Array.isArray(pair)||pair.length!==2||pair.some(s=>typeof s!=='string'||!s.length||s.length>8||/[\s\w]/.test(s)))fail('Invalid '+field+' pair.');
    }
    strings(optional('quotes',['"',"'"]),'quotes',4,3,/^(?:"|'|"""|''')$/);
    strings(optional('stringPrefixes',[]),'string prefixes',8,4,/^[a-zA-Z]+$/);
    if(!Array.isArray(optional('snippets',[]))||optional('snippets',[]).length>100)fail('Invalid snippets.');
    for(const snippet of value.snippets||[]){
      keys(snippet,['prefix','description','body'],'snippet');text(snippet.prefix,'snippet prefix',40);
      if(!/^[\w.-]+$/.test(snippet.prefix))fail('Invalid snippet prefix.');
      text(snippet.description===undefined?'':snippet.description,'snippet description',160);text(snippet.body,'snippet body',4000,true);
    }
    keys(value.ai===undefined?{}:value.ai,['enabled','inline','reference','examples'],'AI reference');
    if(value.ai?.enabled!==undefined&&typeof value.ai.enabled!=='boolean')fail('Invalid AI enabled setting.');
    if(value.ai?.inline!==undefined&&typeof value.ai.inline!=='boolean')fail('Invalid inline prediction setting.');
    text(value.ai?.reference===undefined?'':value.ai.reference,'AI reference',24000,true);text(value.ai?.examples===undefined?'':value.ai.examples,'AI examples',12000,true);
    if(byteLength(value)>MAX_PACK_BYTES)fail('Language packs must be smaller than 64 KB.');
    return JSON.parse(JSON.stringify(value));
  }
  function validatePacks(values){
    if(!Array.isArray(values)||values.length>16)fail('Install up to 16 custom languages.');
    const packs=values.map(validatePack),ids=new Set(),associations=new Set();
    for(const pack of packs){
      if(ids.has(pack.id))fail('Duplicate language ID: '+pack.id);ids.add(pack.id);
      for(const item of [...pack.extensions,...pack.filenames||[]]){
        const key=item.toLowerCase();if(associations.has(key))fail('Another custom language already uses '+item+'.');associations.add(key);
      }
    }
    if(byteLength(packs)>MAX_BYTES)fail('Custom languages exceed the 512 KB storage limit.');
    return packs;
  }
  const languageId=pack=>'custom-'+pack.id;
  function detect(packs,path){
    const lower=path.toLowerCase(),name=lower.split(/[\\/]/).pop();
    return packs.find(p=>(p.filenames||[]).some(n=>n.toLowerCase()===name))||
      packs.flatMap(p=>p.extensions.map(ext=>({p,ext}))).sort((a,b)=>b.ext.length-a.ext.length).find(({ext})=>lower.endsWith(ext.toLowerCase()))?.p;
  }
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function grammar(pack){
    const root=[],tokenizer={root},brackets=pack.brackets||[['{','}'],['[',']'],['(',')']];
    if(pack.lineComment)root.push([new RegExp(escape(pack.lineComment)+'.*$'),'comment']);
    if(pack.blockComment?.length){root.push([new RegExp(escape(pack.blockComment[0])),'comment','@comment']);tokenizer.comment=[[new RegExp(escape(pack.blockComment[1])),'comment','@pop'],[/./,'comment']];}
    const prefix=(pack.stringPrefixes||[]).length?'(?:'+pack.stringPrefixes.map(escape).join('|')+')?':'';
    [...pack.quotes||['"',"'"]].sort((a,b)=>b.length-a.length).forEach((quote,i)=>{
      const state='string'+i;root.push([new RegExp(prefix+escape(quote)),'string','@'+state]);
      tokenizer[state]=[[/\\./,'string.escape'],[new RegExp(escape(quote)),'string','@pop'],[/./,'string']];
      if(quote.length===1)tokenizer[state].splice(1,0,[/$/,'string','@pop']);
    });
    for(const [open,close]of brackets)root.push([new RegExp('(?:'+escape(open)+'|'+escape(close)+')'),'delimiter.bracket']);
    root.push([/[a-zA-Z_$][\w$]*/,{cases:{'@keywords':'keyword','@builtins':'predefined','@default':'identifier'}}],
      [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,'number'],[/[+\-*\/%=!<>:&|^~]+/,'operator'],[/\s+/,'white'],[/[;,.]/,'delimiter']);
    return {defaultToken:'',keywords:pack.keywords||[],builtins:pack.builtins||[],tokenizer};
  }
  function configuration(pack){
    const brackets=pack.brackets||[['{','}'],['[',']'],['(',')']];
    return {comments:{...(pack.lineComment?{lineComment:pack.lineComment}:{}),...(pack.blockComment?.length?{blockComment:pack.blockComment}:{})},brackets,
      autoClosingPairs:[...brackets.map(([open,close])=>({open,close})),...(pack.quotes||['"',"'"]).filter(q=>q.length===1).map(q=>({open:q,close:q,notIn:['string','comment']}))],
      surroundingPairs:[...brackets.map(([open,close])=>({open,close})),...(pack.quotes||['"',"'"]).filter(q=>q.length===1).map(q=>({open:q,close:q}))]};
  }
  function reference(pack){
    if(pack.ai?.enabled===false)return null;
    return {language:pack.name,version:pack.version||'',extensions:pack.extensions,keywords:pack.keywords||[],builtins:pack.builtins||[],
      comments:{line:pack.lineComment||'',block:pack.blockComment||[]},reference:pack.ai?.reference||'',examples:pack.ai?.examples||''};
  }
  function references(packs,ids){
    const result=[];
    for(const item of packs.filter(p=>ids.includes(languageId(p))).map(reference).filter(Boolean)){
      const next={...item,keywords:item.keywords.slice(0,128),builtins:item.builtins.slice(0,128),reference:'',examples:''};
      if(JSON.stringify([...result,next]).length>36000)break;
      for(const field of ['reference','examples']){
        let low=0,high=item[field].length;
        while(low<high){const mid=Math.ceil((low+high)/2);next[field]=item[field].slice(0,mid);if(JSON.stringify([...result,next]).length<=36000)low=mid;else high=mid-1;}
        next[field]=item[field].slice(0,low);
      }
      result.push(next);
    }
    return result;
  }
  function install(monaco,initial=[]){
    let packs=[],disposables=[];const owned=new Set();
    function replace(values){
      const next=validatePacks(values);
      for(const p of next)if(monaco.languages.getLanguages().some(l=>l.id===languageId(p))&&!owned.has(languageId(p)))fail('Language ID is already registered: '+p.id);
      disposables.forEach(d=>d.dispose());disposables=[];packs=next;
      for(const pack of packs){
        const id=languageId(pack);
        // Older Monaco builds return void from register and keep the ID forever.
        // Own the associations/labels in our registry and reuse these IDs.
        if(!monaco.languages.getLanguages().some(l=>l.id===id)){
          const registration=monaco.languages.register({id,aliases:[pack.name],extensions:pack.extensions,filenames:pack.filenames||[]});
          owned.add(id);if(registration?.dispose)disposables.push(registration);
        }
        disposables.push(monaco.languages.setMonarchTokensProvider(id,grammar(pack)),monaco.languages.setLanguageConfiguration(id,configuration(pack)),
          monaco.languages.registerCompletionItemProvider(id,{provideCompletionItems(model,position){
            const word=model.getWordUntilPosition(position),range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};
            return {suggestions:[...(pack.snippets||[]).map(s=>({label:s.prefix,detail:s.description||pack.name,insertText:s.body,kind:monaco.languages.CompletionItemKind.Snippet,insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,range})),
              ...[...new Set([...(pack.keywords||[]),...(pack.builtins||[])])].map(label=>({label,insertText:label,kind:monaco.languages.CompletionItemKind.Keyword,range}))]};
          }}));
      }
    }
    replace(initial);
    return {replace,get packs(){return JSON.parse(JSON.stringify(packs));},detect:path=>detect(packs,path),getByLanguage:id=>packs.find(p=>languageId(p)===id),references:ids=>references(packs,ids),dispose(){disposables.forEach(d=>d.dispose());packs=[];}};
  }
  return {MAX_BYTES,MAX_PACK_BYTES,validatePack,validatePacks,languageId,detect,grammar,configuration,reference,references,install};
});
