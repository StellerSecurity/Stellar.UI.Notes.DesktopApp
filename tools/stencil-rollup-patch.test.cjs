'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { outputPath, entries, transform, plan, digest, spec } = require('./stencil-rollup-patch.cjs');

for (const [platform, api, root] of [['POSIX', path.posix, '/build/out'], ['Windows', path.win32, 'C:\\build\\out']]) {
  test(platform + ': accepts normal chunks, maps, nested assets and Unicode', () => {
    for (const name of ['main.js', 'main.js.map', '.hidden', 'assets/icon.png', 'assets\\icon.png', 'chunks/a/../b.js', 'tekst/æøå.js', 'folder/my file.js']) {
      assert.equal(outputPath(api, { dir: root }, name), api.resolve(root, name.replace(/\\/g, '/')));
    }
    assert.equal(outputPath(api, { file: api.join(root, 'bundle.js') }, 'bundle.js'), api.join(root, 'bundle.js'));
  });
  for (const name of ['../outside.js', 'x/../../outside.js', '..\\outside.js', 'x\\..\\..\\outside.js',
    '/outside.js', '\\outside.js', 'C:\\outside.js', 'C:outside.js', '\\\\server\\share\\file.js',
    '../out-other/file.js', 'sub/../..', '.', 'sub/..', '', 'bad\0name', 'file:stream',
    '.. /outside.js', 'sub/.. ./outside.js', 'sub/file.', 'sub/file ', 'NUL', 'CON.txt']) {
    test(platform + ': rejects unsafe output ' + JSON.stringify(name), () => {
      assert.throws(() => outputPath(api, { dir: root }, name));
    });
  }
}

test('does not coerce non-string output names', () => {
  for (const name of [null, undefined, 0, {}, { toString() { throw new Error('must not execute'); } }]) {
    assert.throws(() => outputPath(path, { dir: '/out' }, name), /Invalid Rollup output name/);
  }
});

test('the injected guard is the exact first-party function tested above', () => {
  const source = outputPath.toString().replace(/\r\n/g, '\n').replace('function outputPath(', 'function stellarRollupOutputPath(');
  assert.ok(spec.after.startsWith(source + '\nasync function writeOutputFile('));
  assert.ok(spec.after.endsWith('const fileName = stellarRollupOutputPath(import_node_path2, outputOptions, outputFile.fileName);'));
  assert.equal(spec.original, '31e6d332a91886959e0123de44bcf698163c8e31ceff88758dcc4d824bbadcdf');
});

test('transforms only one exact source and verifies its output hash', () => {
  const source = 'fixture: original writer';
  const result = 'fixture: contained writer';
  const record = { before: 'original', after: 'contained', original: digest(source), patched: digest(result) };
  assert.equal(transform(source, record), result);
  assert.equal(transform(result, record), result);
  assert.throws(() => transform(source+'changed', record), /Unexpected Stencil/);
  assert.throws(() => transform(source, { ...record, patched: '0'.repeat(64) }), /output checksum/);
  const ambiguous = source+' original';
  assert.throws(() => transform(ambiguous, { ...record, original: digest(ambiguous) }), /Unexpected Stencil/);
});

function lockEntry() {
  return { version: spec.version, integrity: spec.integrity, resolved: spec.resolved };
}

test('checks every nested Stencil copy and rejects package identity drift', () => {
  const root = 'node_modules/@stencil/core';
  const nested = 'node_modules/example/node_modules/@stencil/core';
  const lock = { packages: { [root]: lockEntry(), [nested]: lockEntry() } };
  assert.deepEqual(entries(lock), [root+'/compiler/stencil.js', nested+'/compiler/stencil.js']);
  for (const change of [{ version: '4.45.4' }, { integrity: 'changed' }, { resolved: 'https://example.invalid/package.tgz' }, { link: true }]) {
    assert.throws(() => entries({ packages: { [root]: { ...lockEntry(), ...change } } }), /Unreviewed Stencil/);
  }
  assert.throws(() => entries({ packages: {} }), /missing/);
  assert.throws(() => entries({ packages: { ['node_modules/../node_modules/@stencil/core']: lockEntry() } }), /Unreviewed Stencil/);
  assert.throws(() => plan(lock, () => 'unpatched'), /patch missing or changed/);
});

test('build and development entry points verify the patch without lifecycle hooks', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const name of ['ng', 'start', 'watch', 'test', 'test:parity', 'lint']) {
    assert.ok(pkg.scripts[name].startsWith('node tools/stencil-rollup-patch.cjs --check && '), name);
  }
  assert.ok(pkg.scripts.build.startsWith('node tools/release-toolchain-check.cjs && '));
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.ok(!pkg.scripts[name]?.includes('stencil-rollup-patch'), name);
  }
});

test('fresh Azure builds apply the reviewed Stencil patch before executing the toolchain', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '..', 'azure-pipelines-desktop-build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const install = pipeline.indexOf('npm ci --ignore-scripts');
  const controls = pipeline.indexOf('node --test tools/braces-patch-plan.test.cjs tools/stencil-rollup-patch.test.cjs');
  const apply = pipeline.indexOf('node tools/stencil-rollup-patch.cjs --apply');
  const verify = pipeline.indexOf('node tools/release-toolchain-check.cjs\n', apply);
  const build = pipeline.indexOf('npm run build', verify);
  const parity = pipeline.indexOf('npm run test:parity', build);
  const packageWindows = pipeline.indexOf('--win nsis', parity);
  assert.ok(install >= 0 && controls > install && apply > controls && verify > apply && build > verify);
  assert.ok(parity > build && packageWindows > parity);
  assert.ok(pipeline.includes("throw 'Reviewed Stencil patch rejected'"));
  assert.ok(pipeline.includes("throw 'Quill and desktop integration tests failed'"));
});
