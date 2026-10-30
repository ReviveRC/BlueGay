const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../dist/agent-core.js');
const file={id:'a',path:'src/a.js',content:'const x = 1;\nconsole.log(x);'};
const attached=()=>[core.snapshot(file)];
const proposal=edits=>'Slay queen! 💅\n```bluegay-edits\n'+JSON.stringify({edits})+'\n```';
const replacement=(before='const x = 1;',after='const x = 2;')=>({path:file.path,replacements:[{before,after}]});
test('ChatLGBT request sends only chosen context and keeps cloud response storage off',()=>{
  const payload=core.buildRequest({prompt:'Fix this',attachments:attached(),model:'gpt-6.1-sol'});
  assert.equal(payload.store,false);assert.equal(payload.stream,true);assert(payload.instructions.includes('slay queen'));
  assert.equal(JSON.parse(payload.input[0].content).attachedContext[0].content,file.content);assert(!payload.tools);
});
test('proposal parsing computes exact changes without mutating source',()=>{
  const edits=core.parseProposal(proposal([replacement()]),attached(),[file.path]);
  assert.equal(edits[0].after,'const x = 2;\nconsole.log(x);');assert.equal(file.content,'const x = 1;\nconsole.log(x);');
});
test('selection context cannot be used to edit outside the selected range',()=>{
  const context=[core.snapshot(file,{start:13,end:file.content.length})];
  assert.throws(()=>core.parseProposal(proposal([replacement()]),context,[file.path]),/missing or ambiguous/);
  const edits=core.parseProposal(proposal([replacement('console.log(x);','console.info(x);')]),context,[file.path]);
  assert.equal(edits[0].after,'const x = 1;\nconsole.info(x);');
});
test('ambiguous replacements and unattached edits are rejected',()=>{
  assert.throws(()=>core.parseProposal(proposal([replacement('x','y')]),attached(),[file.path]),/ambiguous/);
  assert.throws(()=>core.parseProposal(proposal([replacement()]),[],[file.path]),/Attach/);
});
test('new files cannot overwrite existing files and traversal is rejected',()=>{
  assert.throws(()=>core.parseProposal(proposal([{path:file.path,content:'overwrite'}]),attached(),[file.path]),/existing/);
  for(const path of ['../secret','C:/evil','/etc/x','src/../x','src\\x','CON','src/a.','.env','key.pem']){
    assert.throws(()=>core.parseProposal(proposal([{path,content:'x'}]),[],[]));
  }
});
test('current-content and file-identity checks protect newer edits and reopened projects',()=>{
  const edits=core.parseProposal(proposal([replacement()]),attached(),[file.path]);
  assert(core.validateCurrent(edits,[file]));
  assert.throws(()=>core.validateCurrent(edits,[{...file,content:'newer edit'}]),/changed/);
  assert.throws(()=>core.validateCurrent(edits,[{...file,id:'reopened'}]),/changed/);
});
test('new file proposals cannot conflict with folders, files or each other',()=>{
  const edit={path:'src',before:null,after:'bad'};
  assert.throws(()=>core.validateCurrent([edit],[file]),/conflicts/);
  assert.throws(()=>core.validateCurrent([edit],[],['src']),/conflicts/);
  assert.throws(()=>core.validateCurrent([edit,{path:'src/a.js',before:null,after:'bad'}],[]),/conflict/);
});
test('malformed and incomplete proposals never become edits',()=>{
  assert.throws(()=>core.parseProposal('```bluegay-edits\n{',attached(),[]),/incomplete/);
  assert.throws(()=>core.parseProposal('```bluegay-edits\nnot json\n```',attached(),[]),/JSON/);
  assert.deepEqual(core.parseProposal('Just an explanation.',attached(),[]),[]);
});
test('duplicate paths and oversized changes fail closed',()=>{
  assert.throws(()=>core.parseProposal(proposal([replacement(),replacement()]),attached(),[]),/duplicate/);
  assert.throws(()=>core.parseProposal(proposal([{path:'big.txt',content:'a'.repeat(200001)}]),[],[]),/too large/);
});
test('SSE parser handles split UTF-8 emoji, CRLF and multiple events per chunk',()=>{
  const events=[];const parser=core.createSSE(e=>events.push(e));
  const encoded=Buffer.from('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"💅"}\r\n\r\ndata: {"type":"response.completed"}\n\n');
  for(const byte of encoded)parser.push(Uint8Array.of(byte));parser.finish();
  assert.equal(events[0].delta,'💅');assert.equal(events[1].type,'response.completed');
});
test('SSE parser rejects truncated event and large unfinished frames',()=>{
  const parser=core.createSSE(()=>{});parser.push(Buffer.from('data: {"type":'));assert.throws(()=>parser.finish(),/ended/);
  const large=core.createSSE(()=>{});assert.throws(()=>large.push(Buffer.from('a'.repeat(1000001))),/oversized/);
});
test('context and output limits are bounded',()=>{
  assert.throws(()=>core.buildRequest({prompt:'help',attachments:[{path:'x',content:'a'.repeat(90001)}],model:'gpt-6.1-sol'}),/large/);
  assert.equal(core.buildRequest({prompt:'help',attachments:[],model:'gpt-6.1-sol',maxOutput:99999}).max_output_tokens,16000);
});

test('API failures show provider details, actionable causes and redact credentials',()=>{
  const message=core.responseFailure({type:'error',code:'invalid_api_key',message:'Rejected sk-proj-fake-secret and Bearer fake-token'});
  assert.match(message,/invalid_api_key/);assert.match(message,/ChatLGBT settings/);
  assert(!message.includes('sk-proj-fake-secret'));assert(!message.includes('fake-token'));
  assert.match(core.responseFailure({type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'}}}),/output limit/);
  const filtered=core.responseFailure({type:'response.incomplete',response:{incomplete_details:{reason:'content_filter'}}});
  assert.match(filtered,/content filter/);assert(!filtered.includes('increase'));
  assert.match(core.responseFailure({type:'response.failed',response:{error:{code:'unknown_code',message:'Specific provider explanation.'}}}),/Specific provider explanation/);
});
