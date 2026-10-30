import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPrivateKey,sign,verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function releaseToken({exe,version,url,key,notes='',now=Math.floor(Date.now()/1000)}){
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Use a stable major.minor.patch version.');
  const address=new URL(url);if(address.protocol!=='https:'||address.username||address.password||address.hash)throw Error('Use an HTTPS executable URL without credentials.');
  const bytes=fs.readFileSync(exe);if(bytes.length<2||bytes.length>128*1024*1024||bytes.subarray(0,2).toString()!=='MZ')throw Error('Not a supported Windows executable.');
  const claims={iss:'bluegay-updates',aud:'bluegay-windows-x64',iat:now,exp:now+365*86400,version,url,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,notes};
  const input=[{alg:'RS256',typ:'JWT'},claims].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),createPrivateKey(fs.readFileSync(key))).toString('base64url');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=Object.fromEntries(process.argv.slice(2).reduce((all,item,i,items)=>i%2?all:[...all,[item.replace(/^--/,''),items[i+1]]],[]));
  const token=releaseToken({...args,notes:args.notes?fs.readFileSync(args.notes,'utf8'):''});
  const parts=token.split('.');
  if(!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),fs.readFileSync('src-tauri/updater-public.pem'),Buffer.from(parts[2],'base64url')))throw Error('The signing key does not match the public key embedded in BlueGay.');
  fs.writeFileSync(args.output||'release/latest.jwt',token+'\n');console.log('Signed update manifest written. Keep the private signing key out of releases and source control.');
}
