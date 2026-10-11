'use strict';
// Explicit operation, never an npm lifecycle hook. Does not load package code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const spec = require('./braces-depth-patch.json');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function entries(lock) {
  const found = Object.entries(lock.packages || {}).filter(([name]) =>
    name === 'node_modules/braces' || name.endsWith('/node_modules/braces'));
  if (!found.length) throw new Error('Reviewed braces dependency missing');
  for (const [name, pkg] of found) {
    if (name.includes('\\') || name.split('/').some(part => part === '.' || part === '..') ||
        !/^(node_modules\/(?:@[^/]+\/)?[^/]+\/)*node_modules\/braces$/.test(name) ||
        pkg.version !== spec.version || pkg.integrity !== spec.integrity ||
        pkg.resolved !== 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz' ||
        pkg.dev !== true || pkg.link) throw new Error('Unreviewed or runtime braces dependency: ' + name);
  }
  return found.map(([name]) => name);
}

function transform(name, source) {
  const record = spec.files[name];
  if (!record) throw new Error('Unreviewed braces file');
  if (digest(source) === record.patched) return source;
  if (digest(source) !== record.original) throw new Error('Unexpected braces bytes: ' + name);
  for (const [before, after] of record.replacements) {
    if (source.split(before).length !== 2) throw new Error('Ambiguous patch: ' + name);
    source = source.replace(before, after);
  }
  if (digest(source) !== record.patched) throw new Error('Patch output checksum mismatch');
  return source;
}

function plan(lock, read, patchedOnly = false) {
  const writes = [];
  for (const location of entries(lock)) {
    for (const [name, record] of Object.entries(spec.files)) {
      const file = location + '/' + name;
      const source = read(file);
      if (patchedOnly && digest(source) !== record.patched) throw new Error('Braces patch missing or changed: ' + file);
      const result = transform(name, source);
      if (result !== source) writes.push({ file, source, result });
    }
  }
  return writes;
}

function safeFile(root, relative) {
  const absolute = path.resolve(root, relative);
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(absolute);
  if (real !== path.join(realRoot, relative)) throw new Error('Symlinked dependency rejected: ' + relative);
  if (!fs.statSync(real).isFile()) throw new Error('Dependency is not a regular file');
  return real;
}

function inspect(root, patchedOnly = true) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return plan(lock, file => fs.readFileSync(safeFile(root, file), 'utf8'), patchedOnly);
}

function apply(root) {
  const writes = inspect(root, false); // Validate every file before changing any.
  for (const { file, source } of writes) {
    if (fs.readFileSync(safeFile(root, file), 'utf8') !== source) throw new Error('Dependency changed during validation');
  }
  for (const { file, result } of writes) fs.writeFileSync(safeFile(root, file), result);
  inspect(root, true);
  return writes.length;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const mode = process.argv[2];
    if (mode === '--check') { inspect(root); console.log('Reviewed braces patch hashes verified.'); }
    else if (mode === '--apply') console.log('Reviewed braces files patched: ' + apply(root));
    else throw new Error('Use --check or explicitly approved --apply');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { entries, transform, plan, inspect, digest, spec };
