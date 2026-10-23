'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron-start.js'), 'utf8');

function fixture(t, platform = 'win32') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-ota-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'synthetic.exe');
  fs.writeFileSync(file, 'Synthetic payload: never executed');
  let installations = 0;
  const messages = [];
  const context = vm.createContext({
    process: { platform }, fs,
    installingUpdate:false, updateStatus:{set:()=>{}},
    persistenceGuard:{prepareForUpdate:async()=>true,cancelUpdate:()=>{}},
    autoUpdater: { installerPath: file, quitAndInstall: () => installations++ },
    logLine: (...args) => messages.push(args),
    sha512Base64: async file => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
  });
  vm.runInContext(source.slice(source.indexOf('let trustedWindowsUpdateManifest = null;'), source.indexOf('const APP_INDEX_PATH')), context);
  vm.runInContext(source.slice(source.indexOf('async function verifyDownloadedWindowsUpdate('), source.indexOf('/* ================= APP SHELL HELPERS')), context);
  context.trusted = { remoteVersion: '0.1.4', expectedSha512: crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64') };
  vm.runInContext('trustedWindowsUpdateManifest = trusted', context);
  return { file, context, messages, info: { version: '0.1.4', downloadedFile: file }, installs: () => installations };
}

test('cached Windows installer is rehashed even when download-time callback never ran', async t => {
  const f = fixture(t);
  assert.equal(f.context.autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(f.context.autoUpdater.disableWebInstaller, true);
  await f.context.installDownloadedUpdate(f.info);
  assert.equal(f.installs(), 1);
});
test('modified cached installer cannot be installed', async t => {
  const f = fixture(t);
  fs.appendFileSync(f.file, 'changed');
  await f.context.installDownloadedUpdate(f.info);
  assert.equal(f.installs(), 0);
  assert.ok(f.messages.some(m => m[0] === 'AutoUpdater installation refused'));
});
test('missing verified manifest, wrong version, web payload and wrong path are rejected', async t => {
  for (const change of ['unverified', 'version', 'packages', 'path', 'missing']) {
    const f = fixture(t);
    if (change === 'unverified') vm.runInContext('trustedWindowsUpdateManifest = null', f.context);
    if (change === 'version') f.info.version = '0.1.5';
    if (change === 'packages') f.info.packages = { x64: { path: 'untrusted.7z' } };
    if (change === 'path') f.context.autoUpdater.installerPath = path.join(path.dirname(f.file), 'other.exe');
    if (change === 'missing') fs.unlinkSync(f.file);
    await f.context.installDownloadedUpdate(f.info);
    assert.equal(f.installs(), 0, change);
  }
});
test('installer replacement during async verification is rejected', async t => {
  const f = fixture(t);
  const original = f.context.sha512Base64;
  f.context.sha512Base64 = async file => {
    const result = await original(file);
    f.context.autoUpdater.installerPath = 'another.exe';
    return result;
  };
  await f.context.installDownloadedUpdate(f.info);
  assert.equal(f.installs(), 0);
});
test('macOS keeps its existing updater installation behavior', async t => {
  const f = fixture(t, 'darwin');
  assert.equal(f.context.autoUpdater.autoInstallOnAppQuit, false);
  await f.context.installDownloadedUpdate({ version: '0.1.4' });
  assert.equal(f.installs(), 1);
});

test('automatic installation is cancelled when local notes cannot be saved',async t=>{
  const f=fixture(t,'darwin');f.context.persistenceGuard.prepareForUpdate=async()=>false;
  await f.context.installDownloadedUpdate({version:'0.1.4'});assert.equal(f.installs(),0);
});
test('duplicate downloaded events install once after persistence succeeds',async t=>{
  const f=fixture(t,'darwin');let finish;
  f.context.persistenceGuard.prepareForUpdate=()=>new Promise(resolve=>finish=resolve);
  const first=f.context.installDownloadedUpdate({version:'0.1.4'});
  await f.context.installDownloadedUpdate({version:'0.1.4'});assert.equal(f.installs(),0);
  finish(true);await first;assert.equal(f.installs(),1);
});

test('an updater error during local flushing cancels the automatic restart',async t=>{
  const f=fixture(t,'darwin');let finish;
  f.context.persistenceGuard.prepareForUpdate=()=>new Promise(resolve=>finish=resolve);
  const pending=f.context.installDownloadedUpdate({version:'0.1.4'});
  f.context.installingUpdate=false;finish(true);await pending;assert.equal(f.installs(),0);
});
