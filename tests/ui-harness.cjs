const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const createDisk=require('../dist/desktop-io.js');
function harness(invoke,initialStorage={}){
  const elements=new Map(),storage=new Map(Object.entries(initialStorage)),events={};
  const element=()=>({innerHTML:'',textContent:'',hidden:false,open:false,value:'',childNodes:[],dataset:{},classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},append(){},remove(){},focus(){},select(){},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];},addEventListener(){},setAttribute(){}});
  const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(){return [];},createElement:element,addEventListener(name,handler){events[name]=handler;},documentElement:element(),body:element()};
  const window={BlueGayDisk:createDisk(invoke),__TAURI__:{core:{invoke},event:{listen:async(name,handler)=>{events[name]=handler;return ()=>{};}}},addEventListener(){},dispatchEvent(){}};
  const requireStub=()=>{};requireStub.config=()=>{};
  const context=vm.createContext({window,document,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},crypto:require('node:crypto').webcrypto,console,innerWidth:1280,innerHeight:800,location:{href:'http://127.0.0.1:4173/'},URL,Event:class{},require:requireStub,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,Blob});
  for(const file of ['themes.js','desktop.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context);
  const run=code=>vm.runInContext(code,context);
  return {run,context,events,storage,elements};
}

module.exports=harness;
