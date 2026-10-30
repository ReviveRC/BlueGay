(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BlueGayJavaScript=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const rawTags=new Set('script style textarea title xmp iframe noembed noframes plaintext'.split(' '));
  const blank=text=>text.replace(/[^\r\n]/g,' ');
  function attributes(tag){
    const result={};
    const pattern=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    pattern.lastIndex=/^<[^\s>]+/.exec(tag)?.[0].length||0;
    let match;
    while((match=pattern.exec(tag)))if(!Object.hasOwn(result,match[1].toLowerCase()))result[match[1].toLowerCase()]=match[2]??match[3]??match[4]??'';
    return result;
  }
  function scriptRegions(text){
    const regions=[];
    let index=0;
    while(index<text.length){
      const start=text.indexOf('<',index);
      if(start<0)break;
      if(text.startsWith('<!--',start)){const end=text.indexOf('-->',start+4);if(end<0)break;index=end+3;continue;}
      if(text.startsWith('<![CDATA[',start)){const end=text.indexOf(']]>',start+9);if(end<0)break;index=end+3;continue;}
      let end=start+1,quote='';
      for(;end<text.length;end++){
        const ch=text[end];
        if(quote){if(ch===quote)quote='';}
        else if(ch==='"'||ch==="'")quote=ch;
        else if(ch==='>')break;
      }
      if(end===text.length)break;
      const opening=/^<([a-z][\w:-]*)(?=[\s/>])/i.exec(text.slice(start,end+1));
      index=end+1;
      if(!opening)continue;
      const name=opening[1].toLowerCase();
      if(!rawTags.has(name))continue;
      if(name==='plaintext')break;
      const closing=new RegExp('</'+name+'(?=[\\s/>])','ig');closing.lastIndex=index;
      const close=closing.exec(text),contentEnd=close?.index??text.length;
      if(name==='script'){
        const attrs=attributes(text.slice(start,end+1));
        const type=(attrs.type||'').trim().toLowerCase();
        if(!Object.hasOwn(attrs,'src')&&(!type||type==='module'||/^(?:text|application)\/(?:java|ecma)script(?:\s*;.*)?$/.test(type)))regions.push({start:index,end:contentEnd,module:type==='module'});
      }
      index=close?contentEnd: text.length;
    }
    return regions;
  }
  function embeddedSources(text){
    const regions=scriptRegions(text),masked=blank(text);
    const classic=regions.filter(r=>!r.module);
    const sourceFor=parts=>{
      let result=masked;
      for(const r of [...parts].reverse()){
        result=result.slice(0,r.start)+text.slice(r.start,r.end)+result.slice(r.end);
        // End a trailing line comment before the next script. All edit/hover
        // mappings use UTF-16 offsets, which this replacement preserves.
        if(r.end<result.length-1)result=result.slice(0,r.end)+'\n;'+result.slice(r.end+2);
      }
      return result;
    };
    const sources=classic.length?[{key:'classic',regions:classic,text:sourceFor(classic)}]:[];
    regions.filter(r=>r.module).forEach((r,i)=>sources.push({key:'module-'+i,regions:[r],text:sourceFor([r])+'\nexport {};\n'}));
    return sources;
  }
  function configure(monaco){
    const ts=monaco.languages.typescript;
    const options={target:ts.ScriptTarget.ES2020,allowNonTsExtensions:true,allowJs:true,checkJs:false,moduleResolution:ts.ModuleResolutionKind.NodeJs,module:ts.ModuleKind.ESNext,noEmit:true,jsx:ts.JsxEmit.ReactJSX,lib:['esnext','dom','dom.iterable']};
    ts.typescriptDefaults.setCompilerOptions({...options,strict:true});
    ts.javascriptDefaults.setCompilerOptions(options);
    ts.typescriptDefaults.setEagerModelSync(true);
    ts.javascriptDefaults.setEagerModelSync(true);
  }
  function install(monaco){
    configure(monaco);
    const states=new Map(),virtualOwners=new Map(),providers=[];
    function clearVirtuals(state){for(const model of state.virtuals.values()){virtualOwners.delete(model.uri.toString());model.dispose();}state.virtuals.clear();state.sources=[];}
    function sync(model){
      const state=states.get(model);if(!state)return;
      const language=model.getLanguageId(),text=model.getValue();
      if(state.libraryText!==text||state.libraryLanguage!==language){
        state.libraries.forEach(library=>library.dispose());state.libraries=[];
        state.libraryText=text;state.libraryLanguage=language;
        if(['javascript','typescript'].includes(language)&&text.length<=500000)for(const defaults of [monaco.languages.typescript.javascriptDefaults,monaco.languages.typescript.typescriptDefaults])state.libraries.push(defaults.addExtraLib(text,model.uri.toString()));
      }
      if(model.getLanguageId()!=='html'||model.getValueLength()>500000){clearVirtuals(state);return;}
      state.sources=embeddedSources(model.getValue());
      const keys=new Set(state.sources.map(s=>s.key));
      for(const [key,virtual]of state.virtuals)if(!keys.has(key)){virtualOwners.delete(virtual.uri.toString());virtual.dispose();state.virtuals.delete(key);}
      for(const source of state.sources){
        let virtual=state.virtuals.get(source.key);
        if(!virtual){
          const uri=model.uri.with({path:model.uri.path+'.__bluegay_'+source.key+'.js'});
          virtual=monaco.editor.createModel(source.text,'javascript',uri);state.virtuals.set(source.key,virtual);virtualOwners.set(uri.toString(),model);
        }else if(virtual.getValue()!==source.text)virtual.setValue(source.text);
      }
    }
    function track(model){
      if(states.has(model))return;
      const state={virtuals:new Map(),sources:[],libraries:[]};states.set(model,state);
      state.change=model.onDidChangeContent(()=>sync(model));
      state.dispose=model.onWillDispose(()=>{clearVirtuals(state);state.libraries.forEach(library=>library.dispose());state.change.dispose();state.dispose.dispose();states.delete(model);});
      sync(model);
    }
    function contextAt(model,position){
      const offset=model.getOffsetAt(position),state=states.get(model);
      for(const source of state?.sources||[]){const region=source.regions.find(r=>offset>=r.start&&offset<=r.end);if(region)return {offset,region,virtual:state.virtuals.get(source.key)};}
      return null;
    }
    const textOf=parts=>(parts||[]).map(p=>p.text).join('');
    const rangeFor=(model,start,length=0)=>{const a=model.getPositionAt(start),b=model.getPositionAt(start+length);return {startLineNumber:a.lineNumber,startColumn:a.column,endLineNumber:b.lineNumber,endColumn:b.column};};
    const valid=(model,version,token)=>!model.isDisposed()&&model.getVersionId()===version&&!token?.isCancellationRequested;
    async function service(model,position,token,fn){
      const ctx=contextAt(model,position);if(!ctx||token?.isCancellationRequested)return null;
      const version=model.getVersionId();
      try{const factory=await monaco.languages.typescript.getJavaScriptWorker();const worker=await factory(ctx.virtual.uri);const result=await fn(worker,ctx);return valid(model,version,token)?result:null;}catch{return null;}
    }
    function completionKind(kind){
      const kinds=monaco.languages.CompletionItemKind;
      return kinds[({method:'Method',function:'Function',property:'Property',getter:'Property',setter:'Property',var:'Variable',let:'Variable',const:'Constant',class:'Class',interface:'Interface',module:'Module',enum:'Enum',keyword:'Keyword',alias:'Reference',warning:'Text'})[kind]||'Property'];
    }
    providers.push(monaco.languages.registerCompletionItemProvider('html',{
      triggerCharacters:['.','"',"'",'/','@','<'],
      async provideCompletionItems(model,position,_context,token){
        return await service(model,position,token,async(worker,ctx)=>{
          const result=await worker.getCompletionsAtPosition(ctx.virtual.uri.toString(),ctx.offset);
          const word=model.getWordUntilPosition(position),version=model.getVersionId();
          return {suggestions:(result?.entries||[]).flatMap(entry=>{
            const span=entry.replacementSpan||result.optionalReplacementSpan;
            const start=span?.start??model.getOffsetAt({lineNumber:position.lineNumber,column:word.startColumn});
            const end=span?start+span.length:model.getOffsetAt({lineNumber:position.lineNumber,column:word.endColumn});
            if(start<ctx.region.start||end>ctx.region.end)return [];
            return [{label:entry.name,insertText:entry.insertText||entry.name,kind:completionKind(entry.kind),sortText:entry.sortText,range:rangeFor(model,start,end-start),_bluegay:{model,version,uri:ctx.virtual.uri,offset:ctx.offset,name:entry.name}}];
          })};
        })||{suggestions:[]};
      },
      async resolveCompletionItem(item,token){
        const data=item._bluegay;if(!data||!valid(data.model,data.version,token))return item;
        try{const factory=await monaco.languages.typescript.getJavaScriptWorker(),worker=await factory(data.uri);const detail=await worker.getCompletionEntryDetails(data.uri.toString(),data.offset,data.name);
          if(detail&&valid(data.model,data.version,token))return {...item,detail:textOf(detail.displayParts),documentation:{value:textOf(detail.documentation)}};
        }catch{}
        return item;
      }
    }));
    providers.push(monaco.languages.registerHoverProvider('html',{
      provideHover(model,position,token){return service(model,position,token,async(worker,ctx)=>{const info=await worker.getQuickInfoAtPosition(ctx.virtual.uri.toString(),ctx.offset);if(!info)return null;return {range:rangeFor(model,info.textSpan.start,info.textSpan.length),contents:[{value:'```javascript\n'+textOf(info.displayParts)+'\n```'},{value:textOf(info.documentation)}]};});}
    }));
    providers.push(monaco.languages.registerSignatureHelpProvider('html',{
      signatureHelpTriggerCharacters:['(',','],signatureHelpRetriggerCharacters:[')'],
      provideSignatureHelp(model,position,token){return service(model,position,token,async(worker,ctx)=>{const info=await worker.getSignatureHelpItems(ctx.virtual.uri.toString(),ctx.offset,{triggerReason:{kind:'invoked'}});if(!info)return null;return {value:{activeSignature:info.selectedItemIndex,activeParameter:info.argumentIndex,signatures:info.items.map(item=>({label:textOf(item.prefixDisplayParts)+item.parameters.map(p=>textOf(p.displayParts)).join(textOf(item.separatorDisplayParts))+textOf(item.suffixDisplayParts),documentation:textOf(item.documentation),parameters:item.parameters.map(p=>({label:textOf(p.displayParts),documentation:textOf(p.documentation)}))}))},dispose(){}};});}
    }));
    providers.push(monaco.languages.registerDefinitionProvider('html',{
      provideDefinition(model,position,token){return service(model,position,token,async(worker,ctx)=>(await worker.getDefinitionAtPosition(ctx.virtual.uri.toString(),ctx.offset)||[]).flatMap(item=>{
        const owner=virtualOwners.get(item.fileName),uri=owner?.uri||monaco.Uri.parse(item.fileName),target=owner||monaco.editor.getModel(uri);
        return target?[{uri,range:rangeFor(target,item.textSpan.start,item.textSpan.length)}]:[];
      }));}
    }));
    const languageChange=monaco.editor.onDidChangeModelLanguage(({model})=>sync(model));
    return {track,contextAt,dispose(){languageChange.dispose();providers.forEach(p=>p.dispose());for(const state of states.values()){state.change.dispose();state.dispose.dispose();state.libraries.forEach(library=>library.dispose());clearVirtuals(state);}states.clear();}};
  }
  return {scriptRegions,embeddedSources,configure,install};
});
