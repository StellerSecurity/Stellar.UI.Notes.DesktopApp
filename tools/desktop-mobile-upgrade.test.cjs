'use strict';
// Real clients and crypto; isolated synthetic User API/SQLite fixture, never production.
require('./verify-identity-runtime.cjs')();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { randomBytes } = require('node:crypto');
const ts = require('typescript');
const desktop = path.resolve(__dirname, '..');
const mobile = process.env.STELLAR_MOBILE_TEST_ROOT;
const api = process.env.STELLAR_USER_API_TEST_ROOT;
if (!mobile || !api || !process.env.STELLAR_TEST_AUTOLOAD) throw Error('Supply reviewed mobile/API checkout and isolated test autoloader paths.');
require(path.join(mobile, 'scripts/verify-identity-runtime.cjs'))();
function load(root, relative) {
  const file = path.join(root, relative);
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(root);
  const original = m.require.bind(m);
  m.require = name => name === '@angular/core' ? { Injectable: () => x => x } : original(name);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText, file);
  return m.exports;
}
const DesktopClient = load(desktop, 'src/app/utils/stellar-id-client.ts').StellarIdClient;
const MobileClient = load(mobile, 'src/app/utils/stellar-id-client.ts').StellarIdClient;
const DesktopRenewal = load(desktop, 'src/app/utils/identity-renewal.ts').IdentityRenewal;
const MobileRenewal = load(mobile, 'src/app/utils/identity-renewal.ts').IdentityRenewal;
const DesktopCrypto = load(desktop, 'src/app/services/crypto-key.service.ts').CryptoKeyService;
const MobileCrypto = load(mobile, 'src/app/services/crypto-key.service.ts').CryptoKeyService;
const opaque = require('../identity-runtime/node_modules/@serenity-kit/opaque/cjs/index.js');
const child = spawn(process.env.STELLAR_TEST_PHP || 'php', [
  '-d', 'allow_url_fopen=0', '-d', 'zend.exception_ignore_args=1',
  '-d', 'disable_functions=curl_exec,curl_multi_exec,fsockopen,pfsockopen,stream_socket_client,socket_connect,mail',
  path.join(api, 'tests/opaque-account-rpc.php'),
], { env: { PATH: process.env.PATH, STELLAR_RUNTIME_TEST: '1', STELLAR_TEST_AUTOLOAD: process.env.STELLAR_TEST_AUTOLOAD }, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '', exited = false, checks = 0; const pending = [];
child.stderr.on('data', value => { stderr += value; });
child.on('error', () => { for (const p of pending.splice(0)) p.reject(Error('Fixture unavailable')); });
child.on('exit', code => { exited = true; if (code !== 0) process.exitCode = 1; for (const p of pending.splice(0)) p.reject(Error('Fixture closed')); });
readline.createInterface({ input: child.stdout }).on('line', line => {
  const p = pending.shift(); if (!p) throw Error('Unexpected fixture response');
  try { const r = JSON.parse(line); r.ok === true ? p.resolve(r.result) : p.reject(Error('Fixture rejected test operation')); }
  catch { p.reject(Error('Malformed fixture response')); }
});
const rpc = (operation, value = {}) => new Promise((resolve, reject) => {
  if (exited) return reject(Error('Fixture closed'));
  pending.push({ resolve, reject }); child.stdin.write(JSON.stringify({ operation, ...value }) + '\n');
});
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
let challenge; const wires = [];
async function transport(operation, body) {
  wires.push({ operation, body: structuredClone(body) });
  if (operation === 'method') return rpc('loginMethod', { body });
  if (operation === 'start') return rpc('loginStart', { body });
  if (operation === 'finish') return rpc('loginFinish', { body });
  if (operation === 'finish-renewable') return rpc('loginFinishRenewable', { body });
  if (operation === 'refresh') return rpc('renew', { body });
  if (operation === 'logout') return rpc('logout', { token: body.token });
  const [, flow, step] = operation.split('/');
  const result = await rpc(step, { flow, body });
  if (operation === 'account/enroll/start') challenge = result.challengeId;
  return result;
}
const deadline = setTimeout(() => { child.kill(); process.exitCode = 1; }, 180000);
(async () => {
  await opaque.ready;
  const setup = opaque.server.createSetup(), realm = 'https://id.stellarsecurity.com';
  await rpc('initialize', { node: process.execPath, setup, publicKey: opaque.server.getPublicKey(setup), realm, storageKey: randomBytes(32).toString('base64') });
  const pins = { issuer: realm, opaqueKey: opaque.server.getPublicKey(setup), methodKey: await rpc('methodKey') };
  const phone = new MobileClient(pins, transport, async () => opaque);
  const computer = new DesktopClient(pins, transport, async () => opaque);
  const root = new Uint8Array(randomBytes(32));
  const originalRoot = Buffer.from(root).toString('base64');
  const local = { notes: [{ id: 'original-note', title: 'Before upgrade', body: '\nOriginal paragraph\n\nIntentional empty line\n', folder_id: 'original-folder', locked: true }], folders: [{ id: 'original-folder', name: 'Original folder' }] };
  const before = JSON.stringify(local);
  const phoneCrypto = new MobileCrypto(), desktopCrypto = new DesktopCrypto();
  await phoneCrypto.importEAK(originalRoot);
  const storedNote = await phoneCrypto.encryptText(before, 'preserved-library');
  const legacy = await rpc('legacyCreate', { email: 'desktop-migration@example.invalid', storedEmail: 'Desktop-Migration@Example.Invalid', password: 'synthetic-old-password' });
  await rpc('legacyPatch', { id: legacy.id, token: legacy.token, envelope: randomBytes(60).toString('base64') });
  check(await computer.method('desktop-migration@example.invalid'), 'legacy', 'desktop selects existing legacy account before migration');
  const password = 'Fresh8!x';
  const migrated = await phone.enroll({ accountId: legacy.id, email: 'Desktop-Migration@Example.Invalid', token: legacy.token }, password, root,
    () => rpc('enrollmentCode', { challengeId: challenge }), async bundle => { check(typeof bundle.eak, 'string', 'mobile checks authoritative old envelope'); });
  check(migrated.accountId, legacy.id, 'mobile upgrade retains account ID');
  check(migrated.rootKey, root, 'mobile upgrade retains content root');
  check((await rpc('resolveToken', { body: { token: legacy.token } })).status, 401, 'old desktop session is revoked');
  check(await computer.method('desktop-migration@example.invalid'), 'opaque', 'desktop discovers upgraded account');
  await assert.rejects(() => computer.login('desktop-migration@example.invalid', 'synthetic-old-password')); checks++;
  const session = await computer.login('Desktop-Migration@Example.Invalid', password);
  check(session.rootKey, root, 'desktop receives original content root');
  check(session.accountId, legacy.id, 'desktop retains account ownership');
  check((await rpc('resolveToken', { body: { token: session.token } })).status, 200, 'new desktop session can authorize Notes');
  await desktopCrypto.importEAK(Buffer.from(session.rootKey).toString('base64'));
  check(await desktopCrypto.decryptText(storedNote, 'preserved-library'), before, 'desktop opens original notes, folder IDs, locks and blank lines');
  const mobileChange = await phoneCrypto.encryptText('Phone after upgrade\n\nLast line\n', 'roundtrip-note');
  check(await desktopCrypto.decryptText(mobileChange, 'roundtrip-note'), 'Phone after upgrade\n\nLast line\n', 'mobile ciphertext opens on desktop');
  const desktopChange = await desktopCrypto.encryptText('\nDesktop response\n\n', 'roundtrip-note');
  check(await phoneCrypto.decryptText(desktopChange, 'roundtrip-note'), '\nDesktop response\n\n', 'desktop ciphertext opens on mobile');
  check(JSON.stringify(local), before, 'upgrade and new login leave offline notes untouched');
  let renewalClock = Date.now();
  function renewableStore(authenticated) {
    const {accountId,email,keyEnvelope,expiresAt,refreshToken,refreshExpiresAt,token}=authenticated;
    const values=new Map([['ssToken',token],['ssAuthVersion','2'],['ssUser',JSON.stringify({id:accountId,email})],
      ['ssIdentitySession',JSON.stringify({accountId,email,keyEnvelope,expiresAt,refreshToken,refreshExpiresAt,tokenId:token.split('|')[0]})],['notes',before],['outbox','retained synthetic queue']]);
    return {values,getItem:async key=>values.get(key)||null,setItem:async(key,value)=>{values.set(key,value);}};
  }
  const desktopStore=renewableStore(session),mobileStore=renewableStore(migrated);
  const renew=(refreshToken,requestId)=>transport('refresh',{refreshToken,requestId});
  await rpc('advance',{seconds:901});renewalClock+=901000;
  const [desktopAccess,mobileAccess]=await Promise.all([
    new DesktopRenewal(desktopStore,renew,()=>renewalClock).ensure(),
    new MobileRenewal(mobileStore,renew,()=>renewalClock).ensure()]);
  check(typeof desktopAccess,'string','desktop renews after fifteen-minute access expiry without a password');
  check(typeof mobileAccess,'string','mobile renews after fifteen-minute access expiry without a password');
  check((await rpc('resolveToken',{body:{token:desktopAccess}})).status,200,'renewed desktop access authorizes Notes');
  check((await rpc('resolveToken',{body:{token:mobileAccess}})).status,200,'renewed mobile access authorizes Notes');
  await rpc('advance',{seconds:901});renewalClock+=901000;
  const restartedDesktop=await new DesktopRenewal(desktopStore,renew,()=>renewalClock).ensure();
  const restartedMobile=await new MobileRenewal(mobileStore,renew,()=>renewalClock).ensure();
  check(restartedDesktop!==desktopAccess,true,'desktop restart renews from durable session state');
  check(restartedMobile!==mobileAccess,true,'mobile restart renews from durable session state');
  for(const store of [desktopStore,mobileStore]){check(store.values.get('notes'),before,'renewal leaves persisted notes and folders intact');check(store.values.get('outbox'),'retained synthetic queue','renewal leaves offline queue intact');}
  check(await phoneCrypto.decryptText(await desktopCrypto.encryptText('\nAfter renewal\n\n','renewed-roundtrip'),'renewed-roundtrip'),'\nAfter renewal\n\n','renewed clients preserve cross-device encryption and intentional blank lines');
  const reopened = await computer.login('desktop-migration@example.invalid', password);
  check(reopened.rootKey, root, 'desktop relogin preserves the same key');
  for (const secret of [password, originalRoot, local.notes[0].body, local.folders[0].name]) check(JSON.stringify(wires).includes(secret), false, 'identity transport does not disclose notes/password/root');
  const wrongPins = new DesktopClient({ ...pins, opaqueKey: 'incorrect' }, transport, async () => opaque);
  await assert.rejects(() => wrongPins.login('desktop-migration@example.invalid', password)); checks++;
  check(stderr, '', 'no private fixture diagnostics');
  root.fill(0); migrated.rootKey.fill(0); session.rootKey.fill(0); reopened.rootKey.fill(0);
  phoneCrypto.clearRuntimeKeys(); desktopCrypto.clearRuntimeKeys();
  console.log(`PASS: ${checks} mobile-upgrade/desktop protocol and ciphertext compatibility checks. Synthetic SQLite; native UI/network sync still requires device validation.`);
})().catch(() => { console.error('FAIL: mobile-upgrade/desktop compatibility check; private values suppressed.'); process.exitCode = 1; })
  .finally(() => { clearTimeout(deadline); child.stdin.end(); });
