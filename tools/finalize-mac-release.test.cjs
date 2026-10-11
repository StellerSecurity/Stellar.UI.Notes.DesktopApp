'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { releaseNames, signingKey, artifactInfo, writeMetadata } = require('./finalize-mac-release.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-release-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of releaseNames('0.1.3')) {
    fs.writeFileSync(path.join(dir, name), `Final stapled bytes for ${name}`);
    fs.writeFileSync(path.join(dir, `${name}.blockmap`), 'synthetic blockmap');
  }
  return dir;
}

function testKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { encoded: Buffer.concat([seed, rawPublic]).toString('base64'), public: rawPublic.toString('base64'), publicKey };
}

test('existing libsodium seed/public-key format produces a valid Ed25519 signature', () => {
  const keys = testKeys();
  const derived = signingKey(keys.encoded, keys.public);
  const bytes = Buffer.from('final OTA manifest');
  assert.ok(crypto.verify(null, bytes, keys.publicKey, crypto.sign(null, bytes, derived.privateKey)));
});

test('rejects a valid but different OTA signing key before producing files', () => {
  assert.throws(() => signingKey(testKeys().encoded), /does not match/);
});

test('rejects malformed keys and a damaged public-key half', () => {
  for (const value of [undefined, '', 'garbage', Buffer.alloc(32).toString('base64')]) {
    assert.throws(() => signingKey(value));
  }
  const keys = testKeys();
  const damaged = Buffer.from(keys.encoded, 'base64');
  damaged[63] ^= 1;
  assert.throws(() => signingKey(damaged.toString('base64'), keys.public), /does not match/);
  assert.throws(() => signingKey(`${keys.encoded}!`, keys.public), /64-byte/);
});

test('rejects unsafe or non-stable versions', () => {
  for (const value of ['../0.1.3', '0.1.3-beta', '00.1.3', '0.1.9007199254740992', undefined]) {
    assert.throws(() => releaseNames(value));
  }
});

test('hashes final bytes and signs exactly the manifest on disk', async t => {
  const dir = fixture(t);
  const keys = testKeys();
  const [zip, dmg] = releaseNames('0.1.3');
  fs.appendFileSync(path.join(dir, dmg), '\nnew stapling ticket');
  await writeMetadata(dir, '0.1.3', signingKey(keys.encoded, keys.public));
  assert.equal(fs.readdirSync(dir).length, 6);
  const bytes = fs.readFileSync(path.join(dir, 'latest-mac.yml'));
  const signature = Buffer.from(fs.readFileSync(path.join(dir, 'latest-mac.yml.sig'), 'utf8'), 'base64');
  assert.ok(crypto.verify(null, bytes, keys.publicKey, signature));
  assert.ok(!crypto.verify(null, Buffer.concat([bytes, Buffer.from('changed')]), keys.publicKey, signature));
  for (const name of [zip, dmg]) {
    const content = fs.readFileSync(path.join(dir, name));
    const hash = crypto.createHash('sha512').update(content).digest('base64');
    assert.ok(bytes.toString().includes(`  - url: ${name}\n    sha512: ${hash}\n    size: ${content.length}`));
  }
  assert.ok(bytes.toString().includes(`\npath: ${zip}\n`));
  await assert.rejects(writeMetadata(dir, '0.1.3', signingKey(keys.encoded, keys.public)), /exactly/);
});

test('rejects missing blockmaps and unexpected files such as signing keys', async t => {
  const keys = testKeys();
  for (const kind of ['missing', 'extra']) {
    const dir = fixture(t);
    if (kind === 'missing') fs.unlinkSync(path.join(dir, `${releaseNames('0.1.3')[0]}.blockmap`));
    else fs.writeFileSync(path.join(dir, 'test-key.p8'), 'synthetic, not a real key');
    await assert.rejects(writeMetadata(dir, '0.1.3', signingKey(keys.encoded, keys.public)), /exactly/);
    assert.ok(!fs.existsSync(path.join(dir, 'latest-mac.yml')));
  }
});

test('rejects empty artifacts and symlinks', async t => {
  const dir = fixture(t);
  const file = path.join(dir, releaseNames('0.1.3')[0]);
  fs.writeFileSync(file, '');
  await assert.rejects(artifactInfo(file), /Invalid release file/);
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(dir, releaseNames('0.1.3')[1]), file);
  await assert.rejects(artifactInfo(file), /Invalid release file/);
});
