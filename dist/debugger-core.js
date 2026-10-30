(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BlueGayDebugCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const normalize=path=>String(path||'').replace(/^\\\\\?\\/,'').replace(/\\/g,'/').replace(/\/$/,'');
  function relativeSource(root,path){const base=normalize(root),source=normalize(path);return source.toLowerCase().startsWith(base.toLowerCase()+'/')?source.slice(base.length+1):source;}
  function mainClassFor(path,content){const source=content.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\r\n]*/g,'');const pkg=/\bpackage\s+([\w.]+)\s*;/.exec(source)?.[1];const name=path.split(/[\\/]/).pop().replace(/\.java$/i,'');return (pkg?pkg+'.':'')+name;}
  function validateConfig(config){
    if(!['python','java'].includes(config.language)||!config.path)throw Error('Choose a Python or Java source file.');
    if(!Array.isArray(config.args)||config.args.length>128||config.args.some(s=>typeof s!=='string'||s.length>8000||s.includes('\0')))throw Error('Arguments must be a JSON array of strings.');
    if(!config.env||typeof config.env!=='object'||Array.isArray(config.env)||Object.keys(config.env).length>128||Object.entries(config.env).some(([k,v])=>!k||/[=\0]/.test(k)||typeof v!=='string'||v.includes('\0')||k.length+v.length>16000))throw Error('Environment must be a JSON object with string values.');
    return config;
  }
  class Engine {
    constructor({transport,onEvent=()=>{},chooseMain=async classes=>classes[0],getBreakpoints=()=>[],pollDelay=150}){Object.assign(this,{transport,onEvent,chooseMain,getBreakpoints,pollDelay});this.pending=new Map();this.waiters=new Map();this.seq=0;this.cursor=0;this.session=null;this.epoch=0;this.paused=false;this.capabilities={};this.frameId=null;this.threadId=null;}
    emit(type,body={}){this.onEvent(type,body);}
    async native(operation,args={}){return this.transport(operation,{...args,...(this.session?{session:this.session.session}:{})});}
    rpc(peer,name,args={},timeout=30000){
      const id=++this.seq,key=peer+':'+id;
      const message=peer==='dap'?{seq:id,type:'request',command:name,arguments:args}:{jsonrpc:'2.0',id,method:name,params:args};
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(key);reject(Error(name+' timed out.'));},timeout);this.pending.set(key,{resolve,reject,timer});this.native('send',{peer,message}).catch(error=>{const entry=this.pending.get(key);if(entry){clearTimeout(timer);this.pending.delete(key);reject(error);}});});
    }
    notify(peer,method,params={}){return this.native('send',{peer,message:{jsonrpc:'2.0',method,params}});}
    waitEvent(name,timeout=30000){const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiters.delete(name);reject(Error('Waiting for '+name+' timed out.'));},timeout);this.waiters.set(name,{resolve,reject,timer});});promise.catch(()=>{});return promise;}
    rejectAll(error){for(const item of [...this.pending.values(),...this.waiters.values()]){clearTimeout(item.timer);item.reject(error);}this.pending.clear();this.waiters.clear();}
    async waitJavaClasspath(content){
      const opened=this.session,library=opened.javaClasspathLibrary;if(!library)return;
      const expected=normalize(library).toLowerCase(),name=mainClassFor(this.config.path,content),deadline=Date.now()+30000;
      this.emit('status',{text:'Waiting for Java test libraries…',phase:'starting'});
      // JDT LS announces ServiceReady before its delayed referenced-library
      // workspace job finishes. Wait for the resolved classpath, not a timer.
      while(this.session===opened){
        const paths=await this.rpc('lsp','workspace/executeCommand',{command:'vscode.java.resolveClasspath',arguments:[name,'','test']},10000);
        if(Array.isArray(paths)&&paths.flat().some(path=>normalize(path).toLowerCase()===expected))return;
        if(Date.now()>=deadline)throw Error('JUnit is installed but its Java project classpath is not ready. Reopen the project and try again.');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw Error('Debug session ended.');
    }
    async prepareJava(content=''){
      const opened=this.session,ready=this.waitEvent('javaReady',180000);
      await this.rpc('lsp','initialize',{},120000);await this.notify('lsp','initialized');await ready;
      await this.notify('lsp','textDocument/didOpen',{textDocument:{uri:opened.programUri,languageId:'java',version:1,text:content}});
      await this.waitJavaClasspath(content);
      this.emit('status',{text:'Importing and building the Java project…',phase:'starting'});
      const built=await this.rpc('lsp','java/buildWorkspace',false,180000);
      this.emit('javaBuild',{success:built===1});
      if(built!==1)throw Error('Java project build failed. Check the compilation errors in the console.');
    }
    async javaTask({root,config,content='',mode='project',sources=[],ids=[]}){
      validateConfig(config);if(config.language!=='java')throw Error('Choose a Java source file.');
      await this.stop();const epoch=++this.epoch;
      this.emit('status',{text:mode==='compile'?'Compiling Java project…':'Preparing Java tests…',phase:'starting'});
      try{
        if(mode!=='compile'||sources.some(s=>/\borg\.junit\b|@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/.test(s.content||''))){
          const info=await this.transport('info',{});if(epoch!==this.epoch)return;
          if(!info.javaTestsReady){this.emit('status',{text:'Setting up JUnit test tools…',phase:'starting'});await this.transport('install',{language:'java-tests'});if(epoch!==this.epoch)return;}
        }
        const opened=await this.transport('open',{root,config});
        if(epoch!==this.epoch){await this.transport('stop',{session:opened.session});return;}
        this.session=opened;this.config=config;this.cursor=0;this.poll(epoch);
        await this.prepareJava(content);if(epoch!==this.epoch)return;
        if(mode==='compile'){this.emit('javaCompileComplete',{success:true});return {compiled:true};}
        const candidates=mode==='class'?[{path:config.path,content}]:sources.filter(source=>/\borg\.junit\b|@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b|extends\s+TestCase\b/.test(source.content||''));
        if(!candidates.length)candidates.push({path:config.path,content});
        const classPaths=new Set(),modulePaths=new Set(),classes=new Set(candidates.map(source=>mainClassFor(source.path,source.content)));
        for(const name of classes){
          const paths=await this.rpc('lsp','workspace/executeCommand',{command:'vscode.java.resolveClasspath',arguments:[name,'','test']},120000);
          if(!Array.isArray(paths)||paths.length<2)throw Error('Java test dependencies could not be resolved.');
          paths[0].forEach(path=>modulePaths.add(path));paths[1].forEach(path=>classPaths.add(path));
        }
        const finished=this.waitEvent('javaTaskFinished',3600000);
        this.emit('status',{text:'Running Java tests…',phase:'running'});
        await this.native('tests',{mode,className:mainClassFor(config.path,content),classPaths:[...classPaths],modulePaths:[...modulePaths],ids});
        const result=await finished;
        if(!result.summary)throw Error('The Java test runner could not finish. Check the test output.');
        return result;
      }catch(error){if(epoch!==this.epoch)return;this.emit('error',{message:error.message||String(error)});throw error;}
      finally{if(epoch===this.epoch)await this.stop();}
    }
    async start({root,config,content='',mainClass='',projectName='',exceptions='uncaught'}){
      validateConfig(config);await this.stop();const epoch=++this.epoch;this.emit('status',{text:'Starting debugger…',phase:'starting'});
      try{
        const opened=await this.transport('open',{root,config});
        if(epoch!==this.epoch){await this.transport('stop',{session:opened.session});return;}
        this.session=opened;this.config=config;this.cursor=0;this.capabilities={};this.poll(epoch);
        let launch={};
        if(config.language==='java'){
          await this.prepareJava(content);
          const classes=await this.rpc('lsp','workspace/executeCommand',{command:'vscode.java.resolveMainClass',arguments:[]},120000);
          if(!Array.isArray(classes)||!classes.length)throw Error('No Java main class was found. Check the project build errors and public static void main method.');
          const inferred=mainClass||mainClassFor(config.path,content);
          let selected=classes.find(c=>c.mainClass===inferred&&(!projectName||c.projectName===projectName));
          if(!selected)selected=classes.length===1?classes[0]:await this.chooseMain(classes);
          if(!selected)throw Error('Java launch cancelled.');
          const paths=await this.rpc('lsp','workspace/executeCommand',{command:'vscode.java.resolveClasspath',arguments:[selected.mainClass,selected.projectName||'']},120000);
          if(!Array.isArray(paths)||paths.length<2)throw Error('Java project dependencies could not be resolved.');
          launch={mainClass:selected.mainClass,projectName:selected.projectName||'',modulePaths:paths[0],classPaths:paths[1]};
          await this.rpc('lsp','workspace/executeCommand',{command:'vscode.java.startDebugSession',arguments:[]});await this.native('connect');
        }
        // Both adapters start noDebug launches without an initialized
        // event/configurationDone handshake.
        if(config.noDebug){
          this.capabilities=await this.rpc('dap','initialize');
          await this.rpc('dap','launch',launch,180000);
          if(epoch===this.epoch)this.emit('status',{text:'Program running',phase:'running'});
          return;
        }
        const initialized=this.waitEvent('initialized');
        this.capabilities=await this.rpc('dap','initialize');
        const launched=this.rpc('dap','launch',launch,180000);
        launched.catch(error=>{const waiting=this.waiters.get('initialized');if(waiting){clearTimeout(waiting.timer);this.waiters.delete('initialized');waiting.reject(error);}});
        await initialized;
        for(const entry of this.getBreakpoints())await this.setBreakpoints(entry.path,entry.breakpoints);
        const filters=this.capabilities.exceptionBreakpointFilters||[];
        await this.rpc('dap','setExceptionBreakpoints',{filters:exceptions==='none'?[]:exceptions==='all'?filters.map(f=>f.filter):filters.filter(f=>f.filter==='uncaught').map(f=>f.filter)});
        if(this.capabilities.supportsConfigurationDoneRequest)await this.rpc('dap','configurationDone');
        await launched;if(epoch!==this.epoch)return;
        if(!this.paused)this.emit('status',{text:config.noDebug?'Program running':'Debugger running',phase:'running'});
      }catch(error){if(epoch!==this.epoch)return;this.emit('error',{message:error.message||String(error)});await this.stop();throw error;}
    }
    async poll(epoch){
      while(this.session&&epoch===this.epoch){
        try{const result=await this.native('poll',{after:this.cursor});if(epoch!==this.epoch)return;
          if(result.first&&this.cursor&&result.first>this.cursor+1)this.emit('output',{category:'console',output:'Earlier console output was truncated.\n'});
          for(const event of result.events||[]){if(epoch!==this.epoch)break;this.cursor=Math.max(this.cursor,event.id);this.consume(event.peer,event.message);}
          if(result.stopped){await this.stop();return;}
        }catch(error){if(epoch===this.epoch){this.emit('error',{message:error.message||String(error)});await this.stop();}return;}
        await new Promise(resolve=>setTimeout(resolve,this.pollDelay));
      }
    }
    consume(peer,message){
      const responseId=peer==='lsp'&&message.id!==undefined&&!message.method?message.id:message.type==='response'?message.request_seq:null;
      if(responseId!==null){const entry=this.pending.get(peer+':'+responseId);if(entry){clearTimeout(entry.timer);this.pending.delete(peer+':'+responseId);if(message.error||message.success===false)entry.reject(Error(message.error?.message||message.message||'Debugger request failed.'));else entry.resolve(peer==='lsp'?message.result:message.body||{});}return;}
      if(peer==='lsp'){
        if(message.method&&message.id!==undefined){
          const result=message.method==='workspace/configuration'?(message.params?.items||[]).map(()=>null):message.method==='workspace/applyEdit'?{applied:false,failureReason:'Apply source changes through the editor.'}:null;
          this.native('send',{peer:'lsp',message:{jsonrpc:'2.0',id:message.id,result}}).catch(()=>{});
        }
        if(message.method==='language/status'){
          this.emit('progress',{text:message.params?.message||message.params?.type||''});
          if([message.params?.type,message.params?.message].some(s=>s==='ServiceReady'||s==='Ready')){const waiting=this.waiters.get('javaReady');if(waiting){clearTimeout(waiting.timer);this.waiters.delete('javaReady');waiting.resolve();}}
        }
        if(message.method==='window/logMessage'||message.method==='window/showMessage')this.emit('output',{category:'console',output:(message.params?.message||'')+'\n'});
        if(message.method==='textDocument/publishDiagnostics')this.emit('diagnostics',message.params||{});
        if(message.method==='$/progress'&&message.params?.value?.message)this.emit('progress',{text:message.params.value.message});
        return;
      }
      if(message.type!=='event')return;
      const body=message.body||{},waiting=this.waiters.get(message.event);if(waiting){clearTimeout(waiting.timer);this.waiters.delete(message.event);waiting.resolve(body);}
      if(message.event==='output'&&body.category==='telemetry')return;
      if(message.event==='stopped'){this.paused=true;this.threadId=body.threadId;this.emit('status',{text:'Paused: '+(body.description||body.reason||'breakpoint'),phase:'paused'});}
      if(message.event==='continued'){this.paused=false;this.frameId=null;this.emit('status',{text:'Debugger running',phase:'running'});}
      if(message.event==='adapterClosed'){this.emit('error',{message:body.message||'The debug adapter closed unexpectedly.'});this.stop().catch(()=>{});return;}
      if(message.event==='output')this.emit('output',body);else this.emit(message.event,body);
      if(message.event==='terminated')this.stop().catch(()=>{});
    }
    setBreakpoints(path,breakpoints){return this.rpc('dap','setBreakpoints',{source:{path},breakpoints,sourceModified:false});}
    control(command,args={}){if(!this.session)throw Error('Start a debugging session first.');return this.rpc('dap',command,{threadId:this.threadId,...args});}
    evaluate(expression,context='watch'){return this.rpc('dap','evaluate',{expression,frameId:this.frameId??undefined,context},10000);}
    async stop(){
      if(this.stopPromise)return this.stopPromise;
      const previous=this.session;this.session=null;this.epoch++;this.paused=false;this.frameId=null;this.threadId=null;this.rejectAll(Error('Debug session ended.'));
      if(!previous){this.emit('ended');return;}
      this.emit('status',{text:'Stopping debugger…',phase:'stopping'});
      this.stopPromise=(async()=>{try{await this.transport('stop',{session:previous.session});}catch{}this.emit('ended');})();
      try{await this.stopPromise;}finally{this.stopPromise=null;}
    }
  }
  return {Engine,normalize,relativeSource,mainClassFor,validateConfig};
});
