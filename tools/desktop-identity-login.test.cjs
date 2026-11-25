'use strict';
require('./verify-identity-runtime.cjs')();
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),{of}=require('rxjs');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){
 file=path.resolve(root,file);if(!file.endsWith('.ts'))file+='.ts';if(cache.has(file))return cache.get(file).exports;
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);const original=m.require.bind(m);
 m.require=name=>{if(name==='@angular/core')return {Injectable:()=>x=>x,Component:()=>x=>x};if(name==='@angular/forms')return {Validators:{required(){},email(){}}};if(name==='@angular/common/http'||name==='@stellarsecurity/stellar-crypto')return {};if(name.endsWith('/i18n'))return {translateText:x=>x};if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));if(name.startsWith('src/'))return load(name);return original(name)};
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,file);return m.exports;
}
const {AuthService}=load('src/app/services/auth.service.ts'),{LoginComponent}=load('src/app/profile/login/login.component.ts'),{sessionToken}=load('src/app/utils/session-token.ts');
function store(values={}){const map=new Map(Object.entries(values));return {map,getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{map.set(k,v)},removeItem:async k=>{map.delete(k)}}}
test('signed legacy mode retains the existing password request',async()=>{
 const requests=[],auth=new AuthService({post(url,body){requests.push({url,body});return of({response_code:200})}},store(),{assertAccount:async()=>{},method:async()=>'legacy'});
 await auth.signIn('legacy@example.invalid','synthetic');assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/api/v1/logincontroller/auth'));assert.deepEqual(requests[0].body,{username:'legacy@example.invalid',password:'synthetic'});
});
test('OPAQUE success and proof/signature failures never use password login',async()=>{
 let requests=0;const id={assertAccount:async()=>{},method:async()=>'opaque',login:async()=>({token:'2|synthetic',rootKey:new Uint8Array(32)}),sessionResponse:s=>({response_code:200,token:s.token})};
 const auth=new AuthService({post(){requests++;throw Error('plaintext')}},store(),id);
 assert.equal((await auth.signIn('qa@example.invalid','synthetic')).identity.token,'2|synthetic');
 id.login=async()=>{throw Error('bad proof')};await assert.rejects(()=>auth.signIn('qa@example.invalid','synthetic'),/bad proof/);
 id.method=async()=>{throw Error('bad signature')};await assert.rejects(()=>auth.signIn('qa@example.invalid','synthetic'),/bad signature/);assert.equal(requests,0);
});
test('V2 expiry and token binding; V1 token remains compatible',async()=>{
 const s=store({ssToken:'2|synthetic',ssAuthVersion:'2'});assert.equal(await sessionToken(s),null);
 await s.setItem('ssIdentitySession',JSON.stringify({tokenId:'2',expiresAt:new Date(Date.now()+60000).toISOString()}));assert.equal(await sessionToken(s),'2|synthetic');
 await s.setItem('ssIdentitySession',JSON.stringify({tokenId:'2',expiresAt:new Date(Date.now()-1).toISOString()}));assert.equal(await sessionToken(s),null);
 await s.setItem('ssToken','3|other');assert.equal(await sessionToken(s),null);await s.setItem('ssAuthVersion','1');assert.equal(await sessionToken(s),'3|other');
});
function fixture(previousKey){
 const rootKey=Uint8Array.from({length:32},(_,i)=>i+1),secure=store(previousKey?{ssToken:'1|previous',ssUser:JSON.stringify({id:'7',email:'qa@example.invalid'}),ssEakB64:previousKey}:{});
 const identity={rootKey,token:'2|synthetic',accountId:'7',email:'qa@example.invalid',expiresAt:new Date(Date.now()+60000).toISOString(),keyEnvelope:'wrapped'},revoked=[],imported=[],routes=[];
 const auth={signIn:async()=>({identity,response:{response_code:200,token:identity.token,user:{id:'7',email:identity.email,crypto_version:'opaque-v1'}}}),rememberSession:async()=>{},revokeIdentity:async token=>revoked.push(token),setLoggedInState(){}};
 const component=new LoginComponent({navigate:async r=>routes.push(r)},{},auth,{},secure,{appHasPasswordChallenge:()=>false,getDecryptedNotes:()=>null,getNotes:()=>'[]'},{upload:async()=>{}},{setForceDownloadOnHome(){}},{},{importEAK:async k=>imported.push(k),clearRuntimeKeys(){}},{});
 const values={email:'qa@example.invalid',password:'synthetic',notesPassword:''};component.loginForm={valid:true,get:k=>({value:values[k],reset:v=>{values[k]=v}})};
 return {component,secure,rootKey,revoked,imported,routes};
}
test('V2 login imports the unwrapped root and clears temporary bytes',async()=>{
 const f=fixture();await f.component.login();assert.equal(f.secure.map.get('ssToken'),'2|synthetic');assert.equal(f.secure.map.get('ssEakB64'),Buffer.from(Array.from({length:32},(_,i)=>i+1)).toString('base64'));assert.equal(f.imported.length,1);assert.equal(f.routes.length,1);assert.equal(f.revoked.length,0);assert.ok(f.rootKey.every(x=>x===0));
});
test('V2 reauthentication preserves offline notes when the root differs',async()=>{
 const f=fixture(Buffer.alloc(32,99).toString('base64'));await f.component.login();assert.equal(f.component.vaultErrorKey,'notesKeyMissing');assert.equal(f.secure.map.get('ssToken'),'1|previous');assert.equal(f.imported.length,0);assert.deepEqual(f.revoked,['2|synthetic']);assert.ok(f.rootKey.every(x=>x===0));
});
test('failed session storage restores previous local state and revokes the issued V2 token',async()=>{
 const f=fixture(),original=f.secure.setItem;let failed=false;
 f.secure.setItem=async(k,v)=>{if(k==='ssToken'&&!failed){failed=true;throw Error('synthetic storage failure')}return original(k,v)};
 await f.component.login();assert.equal(f.secure.map.get('ssToken'),undefined);assert.equal(f.secure.map.get('ssEakB64'),undefined);assert.equal(f.secure.map.get('ssUser'),undefined);assert.deepEqual(f.revoked,['2|synthetic']);assert.ok(f.rootKey.every(x=>x===0));assert.equal(f.routes.length,0);
});

test('failed reauthentication restores the existing key and session metadata',async()=>{
 const key=Buffer.from(Array.from({length:32},(_,i)=>i+1)).toString('base64'),f=fixture(key);
 await f.secure.setItem('ssAuthVersion','1');const original=f.secure.setItem;let failed=false;
 f.secure.setItem=async(k,v)=>{if(k==='ssToken'&&!failed){failed=true;throw Error('synthetic storage failure')}return original(k,v)};
 await f.component.login();assert.equal(f.secure.map.get('ssToken'),'1|previous');assert.equal(f.secure.map.get('ssEakB64'),key);assert.equal(f.secure.map.get('ssAuthVersion'),'1');assert.deepEqual(f.revoked,['2|synthetic']);assert.equal(f.imported.at(-1),key);
});
