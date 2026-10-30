import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
const defaults=JSON.parse(await fs.readFile(new URL('./settings-defaults.json',import.meta.url),'utf8'));
export const settingsPath=path.join(process.env.APPDATA||path.join(os.homedir(),'.config'),'app.bluegay.ide','settings.json');
export function validateSettings(value){
  if(!value||value.version!==1||Object.keys(value).some(k=>!['version','preferences','chat'].includes(k)))throw Error('Invalid settings format.');
  for(const group of ['preferences','chat']){
    const values=value[group];
    if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid settings group.');
    for(const [key,item]of Object.entries(values)){
      if(!Object.hasOwn(defaults[group],key)||typeof item!==typeof defaults[group][key]||typeof item==='string'&&(item.length>200||/[\x00-\x1f]/.test(item))||typeof item==='number'&&(!Number.isInteger(item)||item<1||item>16000)||key==='accent'&&!/^#[a-f\d]{6}$/i.test(item))throw Error('Invalid setting: '+key);
    }
  }
  return value;
}
export function createSettingsHandler({file=settingsPath}={}){
  const token=randomBytes(32).toString('hex');let writes=Promise.resolve();
  return async(req,res)=>{
    if(req.url!=='/api/settings')return false;
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'')||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site'){json(403,{error:'Same-origin access only.'});return true;}
    try{
      if(req.method==='GET'){
        await writes;
        let settings=null;
        try{const text=await fs.readFile(file,'utf8');if(text.length>16000)throw Error('Settings too large');settings=validateSettings(JSON.parse(text));}catch(error){if(error.code!=='ENOENT')throw error;}
        json(200,{settings,path:file,token});
      }else if(req.method==='PUT'){
        if(req.headers['x-bluegay-settings']!==token||req.headers['content-type']!=='application/json'){json(403,{error:'Reload BlueGay before saving settings.'});return true;}
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16000)throw Error('Settings too large');chunks.push(chunk);}
        const value=validateSettings(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const write=async()=>{
          await fs.mkdir(path.dirname(file),{recursive:true});
          const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';
          try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
        };
        const pending=writes.then(write);writes=pending.catch(()=>{});await pending;
        json(200,{path:file});
      }else json(405,{error:'Method not allowed.'});
    }catch{json(400,{error:'Could not read or save settings.json. Check its format and folder permissions; the existing file has been preserved.'});}
    return true;
  };
}
