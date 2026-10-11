'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspect } = require('./braces-depth-patch.cjs');
// Fail BEFORE importing third-party code if the reviewed patch is absent.
inspect(path.resolve(__dirname, '..'));
const braces = require('braces');
const rejectsDepth = fn => assert.throws(fn, error => error instanceof SyntaxError && error.code === 'STELLAR_BRACES_DEPTH');

test('ordinary build patterns retain expansion and compilation', () => {
  assert.deepEqual(braces.expand('src/{app,assets}/x.{ts,html}'), [
    'src/app/x.ts', 'src/app/x.html', 'src/assets/x.ts', 'src/assets/x.html',
  ]);
  assert.deepEqual(braces.expand('v{01..03}'), ['v01', 'v02', 'v03']);
  assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d');
  assert.equal(braces.stringify(braces.parse('{a,{b,c}}')), '{a,{b,c}}');
  assert.deepEqual(braces.expand('a\\{b,c\\}'), ['a{b,c}']);
});

for (const [open, close] of [['{', '}'], ['(', ')']]) {
  for (const size of [128, 1000, 4000]) {
    test('rejects nested ' + open + ' at depth ' + size + ' below upstream length limit', () => {
      const pattern = open.repeat(size) + 'a' + close.repeat(size);
      assert.ok(pattern.length < 10000);
      for (const call of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) rejectsDepth(() => call(pattern));
      rejectsDepth(() => braces.parse(open.repeat(size) + 'a'));
    });
  }
}

test('quoted, escaped and bracket-class braces remain literal', () => {
  const nested = '{'.repeat(4000) + 'x' + '}'.repeat(4000);
  assert.equal(braces.stringify(braces.parse('"' + nested + '"')), nested);
  assert.equal(braces.stringify(braces.parse('[' + nested + ']')), '[' + nested + ']');
  const escaped = '\\{'.repeat(1000) + 'x' + '\\}'.repeat(1000);
  assert.equal(braces.stringify(braces.parse(escaped)), '{'.repeat(1000) + 'x' + '}'.repeat(1000));
});

test('guards direct AST calls as well as parsed string input', () => {
  for (const method of [braces.compile, braces.expand, braces.stringify]) {
    const root = { type: 'root', nodes: [] };
    let node = root;
    for (let index = 0; index < 1000; index++) {
      const child = { type: 'paren', nodes: [], parent: node };
      node.nodes.push(child); node = child;
    }
    node.nodes.push({ type: 'text', value: 'a' });
    rejectsDepth(() => method(root));
  }
});

test('accepts bounded nesting and still enforces the upstream range limit', () => {
  const pattern = '{'.repeat(30) + 'a,b' + '}'.repeat(30);
  assert.doesNotThrow(() => braces.compile(pattern));
  assert.doesNotThrow(() => braces.expand(pattern));
  assert.throws(() => braces.expand('{1..1000000}'), /range limit/);
});
