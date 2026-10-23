const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const mobile = fs.existsSync(path.join(root, 'plugins/background-notes-sync'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/stellar-crypto-1.0.2.json'), 'utf8'));
const uri = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const sdkPath = path.join(root, 'node_modules/@stellarsecurity/stellar-crypto/dist');
const vaultSource = fs.readFileSync(path.join(sdkPath, 'vault.js'), 'utf8');
const b64Source = fs.readFileSync(path.join(sdkPath, 'b64.js'), 'utf8');
const sdkPromise = import(uri(vaultSource.replace("'./b64'", JSON.stringify(uri(b64Source)))));
function sourceModule(relative, imports = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Uint8Array, TextEncoder, TextDecoder,
    Error, crypto: webcrypto, atob, btoa, console, navigator: { onLine: false },
    require: name => { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error('Unexpected import: ' + name); }
  }, { filename: relative });
  return module.exports;
}
const v2 = sourceModule('src/app/utils/vault-envelope-v2.ts');
const context = { account_id: '11', vault_id: '210a4221-c9c5-4f2b-93bf-962900d4a800',
  key_epoch: 1, envelope_id: 'eb4c6514-d342-4a4a-812a-a29092d87b24' };
const master = () => new Uint8Array(Buffer.from(fixture.master_key_b64, 'base64'));
const user = () => ({ id: 11, crypto_version: 'v1', kdf_params: fixture.bundle.kdf_params,
  eak_b64: fixture.bundle.eak, kdf_salt_b64: fixture.bundle.kdf_salt });
async function legacy() { return sourceModule('src/app/utils/legacy-vault-access.ts', { '@stellarsecurity/stellar-crypto': await sdkPromise }); }

test('fixture originates from the unchanged installed legacy SDK 1.0.2', () => {
  assert.equal(createHash('sha256').update(vaultSource).digest('hex'), fixture.provenance.vault_js_sha256);
  assert.equal(createHash('sha256').update(b64Source).digest('hex'), fixture.provenance.b64_js_sha256);
});
test('legacy password unlocks genuine SDK envelope and text/title/folder serialization', async () => {
  const sdk = await sdkPromise;
  const unlocked = await sdk.extractPlainEAK(fixture.password, fixture.bundle);
  assert.equal(unlocked.eakB64, fixture.master_key_b64);
  for (const [field, aad] of [['text', fixture.plaintext.id], ['title', fixture.plaintext.id + '#title'], ['folder', 'fixture-folder#folder-name']]) {
    assert.equal(await sdk.decryptTextWithMK(unlocked.eakBytes,
      { ...sdk.unpackCipherBlob(fixture.note[field]), aad_b64: btoa(aad) }), fixture.plaintext[field]);
  }
});
test('legacy, prepared and dual remain readable without changing wire data', async () => {
  const access = await legacy();
  for (const state of [undefined, 'legacy', 'prepared', 'dual']) {
    assert.equal(await access.unlockLegacyNotesKey({ ...user(), notes_crypto_state: state }, fixture.password), fixture.master_key_b64);
  }
});
test('missing/partial/corrupt/unknown/future metadata never creates an empty vault', async () => {
  const access = await legacy();
  for (const changes of [{ eak_b64: null }, { eak_b64: '' }, { kdf_salt_b64: null }, { kdf_params: null },
    { kdf_params: { ...fixture.bundle.kdf_params, iters: 999999999 } },
    { crypto_version: 'v2' }, { notes_crypto_state: 'v2_only' }, { notes_crypto_state: 'surprise' }]) {
    await assert.rejects(access.unlockLegacyNotesKey({ ...user(), ...changes }, fixture.password), access.VaultAccessError);
  }
});
test('password reset leaves the original key recoverable using the previous Notes password', async () => {
  const access = await legacy();
  await assert.rejects(access.unlockLegacyNotesKey(user(), 'new-login-password'), access.VaultAccessError);
  assert.equal(await access.unlockLegacyNotesKey(user(), fixture.password), fixture.master_key_b64);
});
test('V2 rewrap preserves old key and ciphertext; wrong secret cannot decrypt', async () => {
  const secret = v2.createNotesRecoverySecret();
  const original = master();
  const envelope = await v2.wrapExistingMasterKey(original, secret, context);
  await v2.verifyRewrappedMasterKey(JSON.parse(JSON.stringify(envelope)), secret, context, original);
  assert.deepEqual(await v2.unwrapMasterKey(envelope, secret, context), original);
  assert.deepEqual(original, master(), 'caller key is not zeroed or replaced');
  await assert.rejects(v2.unwrapMasterKey(envelope, v2.createNotesRecoverySecret(), context));
  await assert.rejects(v2.verifyRewrappedMasterKey(envelope, secret, context, v2.createNotesRecoverySecret()), /MISMATCH/);
});
test('V2 binds account, vault, epoch and envelope ID; extra secret fields are rejected', async () => {
  const secret = v2.createNotesRecoverySecret();
  const envelope = await v2.wrapExistingMasterKey(master(), secret, context);
  for (const changes of [{ account_id: '12' }, { key_epoch: 2 },
    { vault_id: '310a4221-c9c5-4f2b-93bf-962900d4a800' },
    { envelope_id: 'fb4c6514-d342-4a4a-812a-a29092d87b24' }]) {
    await assert.rejects(v2.unwrapMasterKey({ ...envelope, ...changes }, secret, context));
    // Even if the attacker also changes the untrusted expected metadata, GCM AAD rejects it.
    await assert.rejects(v2.unwrapMasterKey({ ...envelope, ...changes }, secret, { ...context, ...changes }));
  }
  for (const changes of [{ v: 1 }, { suite: 'AES-CBC' }, { secret: 'must-not-upload' },
    { iv_b64: '' }, { salt_b64: envelope.salt_b64 + '\n' }, { wrapped_key_b64: 'A'.repeat(64) }]) {
    await assert.rejects(v2.unwrapMasterKey({ ...envelope, ...changes }, secret, context));
  }
});
test('all single-bit ciphertext/tag corruptions fail authentication', async () => {
  const secret = v2.createNotesRecoverySecret();
  const envelope = await v2.wrapExistingMasterKey(master(), secret, context);
  for (let byte = 0; byte < 48; byte++) {
    const bytes = Buffer.from(envelope.wrapped_key_b64, 'base64'); bytes[byte] ^= 1;
    await assert.rejects(v2.unwrapMasterKey({ ...envelope, wrapped_key_b64: bytes.toString('base64') }, secret, context));
  }
});
test('context identifiers reject trailing whitespace consistently across runtimes', async () => {
  for (const key of ['account_id', 'vault_id', 'envelope_id']) {
    for (const suffix of ['\n', '\r', ' ']) {
      await assert.rejects(v2.wrapExistingMasterKey(master(), v2.createNotesRecoverySecret(),
        { ...context, [key]: context[key] + suffix }), /NOTES_INVALID_ENVELOPE/);
    }
  }
});
test('random envelopes use fresh salts/IVs and preserve independent keys', async () => {
  const salts = new Set(), ivs = new Set();
  for (let i = 0; i < 32; i++) {
    const key = v2.createNotesRecoverySecret(), secret = v2.createNotesRecoverySecret();
    const envelope = await v2.wrapExistingMasterKey(key, secret, context);
    salts.add(envelope.salt_b64); ivs.add(envelope.iv_b64);
    assert.deepEqual(await v2.unwrapMasterKey(envelope, secret, context), key);
  }
  assert.equal(salts.size, 32); assert.equal(ivs.size, 32);
});

async function loginHarness(changes = {}, previous = '', fault = '', initial = {}) {
  const sdk = await sdkPromise, access = await legacy();
  const localKey = sourceModule('src/app/utils/' + (mobile ? 'vault-envelope-v2.ts' : 'local-app-key.ts'));
  const { LoginComponent } = sourceModule('src/app/profile/login/login.component.ts', {
    '../../i18n': { translateText: key => key },
    '../../utils/legacy-vault-access': access, '../../utils/local-app-key': localKey,
    '@angular/core': { Component: () => value => value },
    '@angular/forms': { Validators: { required: () => null, email: () => null } },
    rxjs: { firstValueFrom: value => Promise.resolve(value) },
    '@stellarsecurity/stellar-crypto': sdk,
    '@capacitor/preferences': { Preferences: { set: async () => {} } },
  });
  const writes = [], requests = [], uploads = [], values = new Map(Object.entries(initial)), imports = [];
  const secure = { getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (key === fault) throw new Error('Synthetic disk failure'); writes.push(key); values.set(key, value); },
    removeItem: async key => { values.delete(key); } };
  const auth = { loginHandling: data => { requests.push({ ...data }); return { response_code: 200, token: 'synthetic-token', user: { ...user(), ...changes } }; },
    updateEak: () => { throw new Error('Forbidden key replacement'); },
    initializeAuthState: async () => {}, clearAuthenticationState: () => {}, setLoggedInState: () => {} };
  const notes = { appHasPasswordChallenge: () => false, getNotes: () => '[]', getDecryptedNotes: () => null };
  const api = { upload: async (...args) => { uploads.push(args); return {}; } };
  const router = { navigate: async () => {} }, toast = { showError: async () => {} };
  const data = { setForceDownloadOnHome: () => {} }, keys = { importEAK: async key => imports.push(key), clearRuntimeKeys: () => {} };
  const component = mobile ? new LoginComponent(router, {}, notes, api, auth, toast, data, {}, secure, keys,
      { success: async () => {} }, {}, { logEvent: async () => {}, booleanLabel: x => String(!!x) })
    : new LoginComponent(router, {}, auth, toast, secure, notes, api, data, {}, keys, {});
  component.syncNotesAfterLogin = async () => {};
  const controls = { email: { value: 'synthetic@example.test' }, password: { value: previous ? 'new-login-password' : fixture.password }, notesPassword: { value: previous } };
  for (const control of Object.values(controls)) control.reset = value => { control.value = value; };
  component.loginForm = { valid: true, get: name => controls[name] };
  await component.login();
  return { component, writes, requests, uploads, values, imports };
}
test('real login component refuses missing keys and never persists token or uploads', async () => {
  const h = await loginHarness({ eak_b64: null });
  assert.equal(h.component.vaultErrorKey, 'notesKeyMissing'); assert.equal(h.writes.length, 0);
  assert.equal(h.imports.length, 0); assert.equal(h.uploads.length, 0);
});
test('real login component keeps previous Notes password out of authentication payload', async () => {
  const h = await loginHarness({}, fixture.password);
  assert.deepEqual(h.requests, [{ username: 'synthetic@example.test', password: 'new-login-password' }]);
  assert.equal(h.imports[0], fixture.master_key_b64);
  assert.ok(h.writes.indexOf('ssToken') > h.writes.indexOf('ssEakB64'));
  assert.ok(h.writes.indexOf('ssToken') > h.writes.indexOf('ssUser'));
  assert.equal(h.component.vaultErrorKey, '');
});
test('crashes at each key/account/token persistence boundary keep sync unpublished', async () => {
  for (const fault of ['ssEakB64', 'ssUser', 'ssToken']) {
    const h = await loginHarness({}, '', fault);
    assert.equal(h.values.has('ssToken'), false); assert.equal(h.uploads.length, 0);
  }
});
test('real login rejects V2-only account even if server supplies a legacy envelope', async () => {
  const h = await loginHarness({ notes_crypto_state: 'v2_only' });
  assert.equal(h.component.vaultErrorKey, 'notesClientUpgradeRequired'); assert.equal(h.writes.length, 0);
});


test('same-account reauthentication preserves the saved key and replaces an expired session', async () => {
  const initial = {ssToken: 'expired-synthetic', ssUser: JSON.stringify(user())};
  const h = await loginHarness({}, '', '', initial);
  assert.equal(h.component.vaultErrorKey, '');
  assert.equal(h.values.get('ssToken'), 'synthetic-token');
  assert.equal(h.imports[0], fixture.master_key_b64);
});
test('different account cannot overwrite a pending authenticated vault', async () => {
  const initial = {ssToken: 'existing-synthetic', ssUser: JSON.stringify({...user(), id: 12})};
  const h = await loginHarness({}, '', '', initial);
  assert.equal(h.component.vaultErrorKey, 'notesSignOutFirst');
  assert.equal(h.writes.length, 0); assert.equal(h.imports.length, 0);
  assert.equal(h.values.get('ssToken'), 'existing-synthetic');
});
test('reauthentication refuses a different master key even for the same owner', async () => {
  const sdk = await sdkPromise;
  const {header} = await sdk.createVault(fixture.password);
  const bundle = sdk.exportServerBundleFromHeader(header);
  const oldUser = {...user(), eak_b64: bundle.eak, kdf_salt_b64: bundle.kdf_salt, kdf_params: bundle.kdf_params};
  const initial = {ssToken: 'existing-synthetic', ssUser: JSON.stringify(oldUser)};
  const h = await loginHarness({}, '', '', initial);
  assert.equal(h.component.vaultErrorKey, 'notesKeyMissing');
  assert.equal(h.writes.length, 0); assert.equal(h.imports.length, 0);
  assert.equal(h.values.get('ssToken'), 'existing-synthetic');
});
