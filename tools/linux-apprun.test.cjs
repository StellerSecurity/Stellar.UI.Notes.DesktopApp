'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const afterPack = require('./linux-after-pack.cjs');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app with spaces');
  fs.mkdirSync(app);
  await afterPack({ electronPlatformName: 'linux', appOutDir: app });
  // Our synthetic executable only records environment/arguments, never Electron.
  fs.writeFileSync(path.join(app, 'stellar-notes'), '#!/bin/sh\nprintf "%s\\n" "$LD_LIBRARY_PATH" "$XDG_DATA_DIRS" "$GSETTINGS_SCHEMA_DIR" "$@"\n', { mode: 0o755 });
  const run = (args = [], overrides = {}) => spawnSync('/bin/sh', [path.join(app, 'AppRun'), ...args], {
    cwd: root, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...overrides }
  });
  return { root, app, run };
}

test('Linux launcher preserves arguments and excludes the working directory from library search', { skip: process.platform === 'win32' }, async t => {
  const { app, run } = await fixture(t);
  const realApp = fs.realpathSync(app);
  const result = run(['a note with spaces', '$(do-not-execute)', '*'], { LD_LIBRARY_PATH: ':/tmp/unsafe:' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split('\n'), [
    `${realApp}/usr/lib`, `${realApp}/usr/share:/usr/local/share:/usr/share`,
    `${realApp}/usr/share/glib-2.0/schemas`, 'a note with spaces', '$(do-not-execute)', '*'
  ]);
});

test('Linux launcher supports APPDIR without adding sandbox-disabling arguments', { skip: process.platform === 'win32' }, async t => {
  const { app, run } = await fixture(t);
  const result = run([], { APPDIR: app });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trimEnd().split('\n').length, 3);
  assert.ok(!result.stdout.includes('--no-sandbox'));
});

test('Linux launcher refuses explicit sandbox bypasses before starting the app', { skip: process.platform === 'win32' }, async t => {
  const { run } = await fixture(t);
  for (const arg of ['--no-sandbox', '--no-sandbox=true', '--disable-sandbox', '--disable-sandbox=true']) {
    const result = run([arg]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requires sandboxing/);
  }
  const result = run([], { ELECTRON_DISABLE_SANDBOX: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});

test('afterPack installs the exact executable launcher and leaves other platforms alone', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-afterpack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const platform of ['darwin', 'win32']) await afterPack({ electronPlatformName: platform, appOutDir: root });
  assert.deepEqual(fs.readdirSync(root), []);
  await afterPack({ electronPlatformName: 'linux', appOutDir: root });
  assert.deepEqual(fs.readFileSync(path.join(root, 'AppRun')), fs.readFileSync(path.join(__dirname, 'linux-apprun.sh')));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, 'AppRun')).mode & 0o777, 0o755);
});
