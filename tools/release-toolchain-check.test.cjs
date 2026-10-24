'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate, validateNode, versions } = require('./release-toolchain-check.cjs');
const { spec: bracesPatch } = require('./braces-depth-patch.cjs');

test('rejects unsupported build Node before dependency installation', () => {
  for (const version of ['20.20.0', '22.11.0', '23.11.0']) assert.throws(() => validateNode(version), /unsupported/);
  for (const version of ['22.12.0', '24.20.0']) validateNode(version);
});

function fixture() {
  const pkg = { dependencies: {}, devDependencies: {}, build: { linux: { executableArgs: [] }, afterPack: 'tools/linux-after-pack.cjs' } };
  for (const name of ['electron', 'electron-builder', '@angular/compiler-cli', '@angular-devkit/build-angular', 'typescript']) pkg.devDependencies[name] = versions[name][0];
  for (const name of ['@angular/core', 'quill', 'ngx-quill', 'electron-updater']) pkg.dependencies[name] = versions[name][0];
  const lock = { packages: { '': { dependencies: { ...pkg.dependencies }, devDependencies: { ...pkg.devDependencies } } } };
  for (const [name, allowed] of Object.entries(versions)) lock.packages[`node_modules/${name}`] = { version: allowed[0] };
  lock.packages['node_modules/braces'] = { version: '3.0.3', dev: true, integrity: bracesPatch.integrity,
    resolved: 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz' };
  return { pkg, lock };
}
test('reviewed lock and matching installed manifests pass without loading dependency code', () => {
  const { pkg, lock } = fixture();
  validate(pkg, lock, key => lock.packages[key]);
});
test('rejects changed braces identity or runtime use before dependency installation', () => {
  const { pkg, lock } = fixture();
  lock.packages['node_modules/braces'].dev = false;
  assert.throws(() => validate(pkg, lock), /runtime braces/);
});
test('rejects the old toolchain and vulnerable nested copies', () => {
  for (const [name, old] of Object.entries({ electron: '44.7.0', '@modelcontextprotocol/sdk': '1.31.0', zod: '4.3.6', 'body-parser': '2.3.0', undici: '7.29.1', vite: '7.3.6', qs: '6.16.0', 'app-builder-lib': '26.8.1', piscina: '4.0.0', 'form-data': '2.3.3', 'shell-quote': '1.8.4' })) {
    const { pkg, lock } = fixture();
    lock.packages[`node_modules/nested/node_modules/${name}`] = { version: old };
    assert.throws(() => validate(pkg, lock), /unreviewed version/);
  }
});
test('rejects stale node_modules, missing dependencies and manifest drift', () => {
  const { pkg, lock } = fixture();
  assert.throws(() => validate(pkg, lock, () => ({ version: '0.0.0' })), /installed version differs/);
  delete lock.packages['node_modules/piscina'];
  assert.throws(() => validate(pkg, lock), /missing from lockfile/);
  const fresh = fixture();
  fresh.pkg.devDependencies.electron = '^44.9.3';
  assert.throws(() => validate(fresh.pkg, fresh.lock), /must pin/);
});
test('rejects disabled sandbox arguments or missing reviewed launcher', () => {
  const { pkg, lock } = fixture();
  pkg.build.linux.executableArgs = ['--no-sandbox'];
  assert.throws(() => validate(pkg, lock), /must not inject/);
  pkg.build.linux.executableArgs = [];
  delete pkg.build.afterPack;
  assert.throws(() => validate(pkg, lock), /hook missing/);
});
