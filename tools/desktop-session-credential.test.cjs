const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sessionCredentials,installSessionCredentialIPC}=require('../desktop-session-credential.cjs');
const token='a'.repeat(32)+'.'+'b'.repeat(43);
function fake(available=true,backend='gnome_libsecret') {
  return {isEncryptionAvailable:()=>available,getSelectedStorageBackend:()=>backend,
    encryptString:value=>Buffer.from('protected:'+value),decryptString:bytes=>bytes.toString().slice(10)};
}
test('uses the OS encryption API and accepts only bounded renewal credentials',()=>{
  const store=sessionCredentials(fake(),'darwin');const encrypted=store.protect(token);
  assert.equal(store.open(encrypted),token);
  for(const invalid of ['',null,{},'plain password','https://example.invalid',token+'x'])assert.throws(()=>store.protect(invalid));
  for(const invalid of ['',null,{},'not-base64', 'x'.repeat(2049)])assert.throws(()=>store.open(invalid));
});
test('never falls back to plaintext when the OS key store is unavailable',()=>{
  for(const [available,backend] of [[false,'gnome_libsecret'],[true,'basic_text'],[true,'unknown']]) {
    const store=sessionCredentials(fake(available,backend),'linux');
    assert.throws(()=>store.protect(token),/identitySecureStorageUnavailable/);
    assert.throws(()=>store.open(Buffer.from('protected:'+token).toString('base64')),/identitySecureStorageUnavailable/);
  }
});
test('rejects decrypted data that is not a renewal credential',()=>{
  assert.throws(()=>sessionCredentials({...fake(),decryptString:()=> 'wrong-format'},'win32').open(Buffer.from('cipher').toString('base64')));
});
test('accepts credential IPC only from the live main frame',()=>{
  const handlers=new Map();const win={webContents:{mainFrame:{}}};
  installSessionCredentialIPC({handle:(name,fn)=>handlers.set(name,fn)},()=>win,fake(),'darwin');
  const protect=handlers.get('stellar-protect-session-credential');
  const open=handlers.get('stellar-open-session-credential');
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  for(const bad of [{...event,sender:{}},{...event,senderFrame:{}}]) {
    assert.throws(()=>protect(bad,token));assert.throws(()=>open(bad,Buffer.from('protected:'+token).toString('base64')));
  }
  assert.equal(open(event,protect(event,token)),token);
});
test('ships the native credential guard in the packaged app',()=>{
  assert.ok(require('../package.json').build.files.includes('desktop-session-credential.cjs'));
});
