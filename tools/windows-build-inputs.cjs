'use strict';
// Explicit reviewed Windows inputs, no package code or installer is executed here.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const spec=require('./windows-build-inputs.json');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function verify(bytes,item){
  if(bytes.length!==item.size || digest(bytes)!==item.sha256)throw Error('Windows input checksum/size rejected: '+item.name);
}
function safeMembers(text){
  if(text.length>3000000)throw Error('Archive index too large');
  for(const name of text.split(/\r?\n/).filter(Boolean)){
    const portable=name.replace(/\\/g,'/');
    if(portable.startsWith('/') || portable.includes(':') || portable.includes('\0') || portable.split('/').includes('..'))throw Error('Unsafe Windows input path');
  }
}
function verifySevenZip(bytes){
  verify(bytes,{name:'7za.exe',size:spec.sevenZip.binarySize,sha256:spec.sevenZip.binarySha256});
  const offset=bytes.readUInt32LE(60);
  if(bytes.subarray(0,2).toString()!=='MZ' || bytes.subarray(offset,offset+4).toString()!=='PE\0\0' || bytes.readUInt16LE(offset+4)!==0x8664)throw Error('7-Zip must be the reviewed Windows x64 binary');
}
async function download(item,dir){
  const target=path.join(dir,item.name),part=target+'.partial';
  const response=await fetch(item.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('Windows input download failed: '+response.status);
  const final=new URL(response.url);
  if(final.protocol!=='https:' || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname))throw Error('Unexpected Windows input origin');
  const handle=fs.openSync(part,'wx',0o600);let length=0;const h=crypto.createHash('sha256');
  try{for await(const bytes of response.body){length+=bytes.length;if(length>item.size)throw Error('Oversized Windows input');h.update(bytes);fs.writeFileSync(handle,bytes);}}finally{fs.closeSync(handle);}
  if(length!==item.size || h.digest('hex')!==item.sha256)throw Error('Downloaded Windows input integrity mismatch');
  fs.renameSync(part,target);return target;
}
function verifyBootstrap(bytes){
  verify(bytes,spec.bootstrap);
  const offset=bytes.readUInt32LE(60);
  if(bytes.subarray(0,2).toString()!=='MZ' || bytes.subarray(offset,offset+4).toString()!=='PE\0\0' || ![0x14c,0x8664].includes(bytes.readUInt16LE(offset+4)))throw Error('Expected reviewed Windows 7-Zip bootstrap');
}
function verifyNsis(dir){
  for(const [relative,wanted]of Object.entries(spec.nsis.files)){
    const file=path.join(dir,relative),stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || digest(fs.readFileSync(file))!==wanted)throw Error('NSIS extracted bytes changed: '+relative);
  }
}
async function prepare(base){
  if(process.platform!=='win32' || process.arch!=='x64')throw Error('Prepare only on Windows x64 CI');
  if(!path.isAbsolute(base) || !fs.statSync(base).isDirectory())throw Error('Expected existing absolute CI temporary directory');
  const systemRoot=process.env.SystemRoot;
  if(!systemRoot || !/^[A-Za-z]:[\\/]/.test(systemRoot))throw Error('Expected absolute Windows SystemRoot');
  const tar=path.join(systemRoot,'System32','tar.exe');if(!fs.statSync(tar).isFile())throw Error('System archive reader unavailable');
  const dir=fs.mkdtempSync(path.join(base,'notes-reviewed-windows-'));
  const electron=await download(spec.electron,dir),nsis=await download(spec.nsis,dir),seven=await download(spec.sevenZip,dir);
  const bootstrap=await download(spec.bootstrap,dir);verifyBootstrap(fs.readFileSync(bootstrap));
  safeMembers(execFileSync(tar,['-tf',nsis],{encoding:'utf8',timeout:30000,maxBuffer:4000000}));
  execFileSync(tar,['-xf',nsis,'-C',dir],{timeout:30000,maxBuffer:1000000});verifyNsis(dir);
  // Windows system tar lacks LZMA: use only the reviewed vendor bootstrap,
  // with a fixed, checksum-verified archive/member and stdout output.
  const bytes=execFileSync(bootstrap,['x','-so','-bd',seven,spec.sevenZip.member],{timeout:30000,maxBuffer:4000000});verifySevenZip(bytes);
  const exe=path.join(dir,'7za.exe');fs.writeFileSync(exe,bytes,{flag:'wx'});
  const paths={electronZip:electron,nsisDirectory:path.join(dir,'nsis-bundle'),sevenZip:exe};
  fs.writeFileSync(path.join(dir,'prepared.json'),JSON.stringify(paths,null,2)+'\n');
  return paths;
}
if(require.main===module)prepare(path.resolve(process.argv[2]||'')).then(p=>console.log(JSON.stringify(p))).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={verify,safeMembers,verifySevenZip,verifyNsis,verifyBootstrap,prepare,spec};
