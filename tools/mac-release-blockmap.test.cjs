'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeBlockmap } = require('./finalize-mac-release.cjs');

test('installed release toolchain builds fresh gzip sidecars without changing final artifact bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-blockmap-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'final-stapled.zip');
  const bytes = crypto.randomBytes(100000);
  fs.writeFileSync(file, bytes);
  await writeBlockmap(file);
  const readMap = () => JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(`${file}.blockmap`)));
  const first = readMap();
  assert.equal(first.version, '2');
  assert.equal(first.files.length, 1);
  assert.equal(first.files[0].sizes.reduce((a, b) => a + b, 0), bytes.length);
  assert.equal(first.files[0].checksums.length, first.files[0].sizes.length);
  assert.deepEqual(fs.readFileSync(file), bytes);
  fs.appendFileSync(file, 'new notarization ticket');
  await writeBlockmap(file);
  const second = readMap();
  assert.equal(second.files[0].sizes.reduce((a, b) => a + b, 0), bytes.length + 23);
  assert.notDeepEqual(second, first);
  assert.deepEqual(fs.readFileSync(file), Buffer.concat([bytes, Buffer.from('new notarization ticket')]));
});

