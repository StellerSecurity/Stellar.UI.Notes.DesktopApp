'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uuidv4 } = require('../src/app/utils/uuid.ts');

test('new note and folder IDs keep the UUID v4 wire format using Web Crypto', () => {
  const ids = Array.from({ length: 1000 }, () => uuidv4());
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});

test('failure of the secure random source does not silently create weak IDs', (t) => {
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('random source unavailable'); });
  assert.throws(() => uuidv4(), /random source unavailable/);
});
