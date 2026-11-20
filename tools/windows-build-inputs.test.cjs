'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {verify,safeMembers,verifySevenZip,prepare,spec}=require('./windows-build-inputs.cjs');
const crypto=require('node:crypto');
test('size and SHA must both match before accepting downloaded bytes',()=>{
 const bytes=Buffer.from('fixture'),item={name:'fixture',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 assert.doesNotThrow(()=>verify(bytes,item));
 assert.throws(()=>verify(bytes,{...item,size:item.size+1}),/rejected/);
 assert.throws(()=>verify(Buffer.from('changed'),item),/rejected/);
});
for(const name of ['../bad','folder/../../bad','C:\\bad','\\\\server\\bad','/bad','folder\\..\\bad','file:stream','bad\0name'])test('reject unsafe archive member '+JSON.stringify(name),()=>assert.throws(()=>safeMembers(name)));
test('ordinary archive paths and Windows line endings are accepted',()=>assert.doesNotThrow(()=>safeMembers('nsis-bundle/windows/Bin/makensis.exe\r\nx64/7za.exe\r\n')));
test('a substituted or old 7-Zip binary cannot pass',()=>assert.throws(()=>verifySevenZip(Buffer.alloc(spec.sevenZip.binarySize)),/rejected/));
test('the preparation command cannot download or execute on a non-Windows host',async t=>{
 if(process.platform==='win32'){t.skip('checked on non-Windows host');return;}
 await assert.rejects(prepare('/private/tmp'),/Windows x64 CI/);
});
