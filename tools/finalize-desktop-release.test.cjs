'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { layout, parseManifest, inspect, stage, finalize, validateWindowsUpdater } = require('./finalize-desktop-release.cjs');

function fixture(t, platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-platform-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'build'); fs.mkdirSync(input);
  const spec = layout(platform, '0.1.3');
  const bytes = Buffer.from('Synthetic installer, never executed');
  const hash = crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(path.join(input, spec.binary), bytes);
  if (spec.blockmap) fs.writeFileSync(path.join(input, spec.binary + '.blockmap'), 'synthetic blockmap');
  const manifest = Buffer.from(`version: 0.1.3\nfiles:\n  - url: ${spec.binary}\n    sha512: ${hash}\n    size: ${bytes.length}\n    blockMapSize: 12\npath: ${spec.binary}\nsha512: ${hash}\nreleaseDate: '2026-10-11T00:00:00.000Z'\n`);
  fs.writeFileSync(path.join(input, spec.manifest), manifest);
  return { root, input, spec, manifest, output: path.join(root, 'final') };
}

for (const platform of ['win', 'linux']) {
  test(`${platform}: stages only public files and signs unchanged builder metadata`, async t => {
    const f = fixture(t, platform);
    fs.writeFileSync(path.join(f.input, 'builder-effective-config.yaml'), 'not a release asset');
    const staged = path.join(f.root, 'staged');
    await stage(f.input, staged, platform, '0.1.3');
    assert.ok(!fs.existsSync(path.join(staged, 'builder-effective-config.yaml')));
    const keys = crypto.generateKeyPairSync('ed25519');
    await finalize(staged, f.output, platform, '0.1.3', keys);
    const bytes = fs.readFileSync(path.join(f.output, f.spec.manifest));
    const signature = Buffer.from(fs.readFileSync(path.join(f.output, f.spec.manifest + '.sig'), 'utf8'), 'base64');
    assert.deepEqual(bytes, f.manifest);
    assert.ok(crypto.verify(null, bytes, keys.publicKey, signature));
    assert.equal(fs.readdirSync(f.output).length, platform === 'win' ? 4 : 3);
    await assert.rejects(finalize(staged, f.output, platform, '0.1.3', keys), /already exists/);
    assert.deepEqual(fs.readFileSync(path.join(f.output, f.spec.manifest)), bytes);
  });
  test(`${platform}: corrupt payload cannot be finalized`, async t => {
    const f = fixture(t, platform);
    fs.appendFileSync(path.join(f.input, f.spec.binary), 'changed');
    await assert.rejects(finalize(f.input, f.output, platform, '0.1.3', crypto.generateKeyPairSync('ed25519')), /checksum or size/);
    assert.ok(!fs.existsSync(f.output));
  });
  test(`${platform}: extra files cannot be included with signed artifacts`, async t => {
    const f = fixture(t, platform);
    fs.writeFileSync(path.join(f.input, 'synthetic-key.p8'), 'not a real key');
    await assert.rejects(finalize(f.input, f.output, platform, '0.1.3', crypto.generateKeyPairSync('ed25519')), /only the platform/);
    assert.ok(!fs.existsSync(f.output));
  });
  test(`${platform}: mismatched signing key leaves no partial output`, async t => {
    const f = fixture(t, platform);
    const keys = crypto.generateKeyPairSync('ed25519');
    keys.publicKey = crypto.generateKeyPairSync('ed25519').publicKey;
    await assert.rejects(finalize(f.input, f.output, platform, '0.1.3', keys), /Signature verification failed/);
    assert.deepEqual(fs.readdirSync(f.root), ['build']);
  });
  test(`${platform}: rejects symlinks, wrong versions and switched platforms`, async t => {
    const f = fixture(t, platform);
    await assert.rejects(inspect(f.input, platform, '0.1.4'));
    await assert.rejects(inspect(f.input, platform === 'win' ? 'linux' : 'win', '0.1.3'));
    const file = path.join(f.input, f.spec.binary);
    fs.unlinkSync(file); fs.symlinkSync(f.spec.manifest, file);
    await assert.rejects(inspect(f.input, platform, '0.1.3'), /Invalid release file/);
  });
}
test('Windows requires its differential update blockmap', async t => {
  const f = fixture(t, 'win');
  fs.unlinkSync(path.join(f.input, f.spec.binary + '.blockmap'));
  await assert.rejects(inspect(f.input, 'win', '0.1.3'));
});
test('manifest parser rejects aliases, duplicates and executable YAML', () => {
  for (const text of ['files: &alias', 'version: !!str 0.1.3', 'version: 0.1.3\nversion: 0.1.4']) {
    assert.throws(() => parseManifest(Buffer.from(text)));
  }
});
test('platform and version cannot inject paths or shell commands', () => {
  for (const platform of ['mac', '../win', '__proto__', 'win;id']) assert.throws(() => layout(platform, '0.1.3'));
  for (const version of ['../0.1.3', '0.1.3-beta', '01.1.3', '0.1.9007199254740992']) assert.throws(() => layout('win', version));
});
test('unsigned Windows package must retain its custom OTA verifier configuration', t => {
  const f = fixture(t, 'win');
  const file = path.join(f.root, 'app-update.yml');
  const text = 'provider: generic\nurl: https://desktopreleasesassetsprod.stellarsecurity.com/notes/win/\nupdaterCacheDirName: stellar-notes-updater\npublisherName:\n  - Stellar Security\n';
  fs.writeFileSync(file, text); validateWindowsUpdater(file);
  for (const changed of [text.replace('publisherName:\n  - Stellar Security\n', ''), text.replace('/notes/win/', '/notes/mac/'), text.replace('Stellar Security', 'Other Publisher')]) {
    fs.writeFileSync(file, changed); assert.throws(() => validateWindowsUpdater(file), /signature verifier/);
  }
});
