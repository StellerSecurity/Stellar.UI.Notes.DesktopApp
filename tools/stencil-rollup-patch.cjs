'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const spec = require('./stencil-rollup-patch.json');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function outputPath(pathApi, options, name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) throw new Error('Invalid Rollup output name');
  const portable = name.replace(/\\/g, '/');
  if (portable.startsWith('/') || portable.includes(':')) throw new Error('Absolute Rollup output name rejected');
  let depth = 0;
  for (const part of portable.split('/')) {
    if (part === '..') depth--;
    else if (part && part !== '.') {
      if (/[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
        throw new Error('Non-portable Rollup output name rejected');
      }
      depth++;
    }
    if (depth < 0) throw new Error('Rollup output leaves its directory');
  }
  const root = pathApi.resolve(options.dir || pathApi.dirname(options.file));
  const target = pathApi.resolve(root, portable);
  const relative = pathApi.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(relative)) {
    throw new Error('Rollup output leaves its directory');
  }
  return target;
}

function entries(lock) {
  const found = Object.entries(lock.packages || {}).filter(([name]) =>
    name === 'node_modules/@stencil/core' || name.endsWith('/node_modules/@stencil/core'));
  if (!found.length) throw new Error('Reviewed Stencil dependency missing');
  for (const [name, pkg] of found) {
    if (!/^(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)*node_modules\/@stencil\/core$/.test(name) ||
        name.includes('\\') || name.split('/').some(part => part === '.' || part === '..') ||
        pkg.version !== spec.version || pkg.integrity !== spec.integrity || pkg.resolved !== spec.resolved || pkg.link) {
      throw new Error('Unreviewed Stencil dependency: ' + name);
    }
  }
  return found.map(([name]) => name + '/compiler/stencil.js');
}

function transform(source, record = spec) {
  if (digest(source) === record.patched) return source;
  if (digest(source) !== record.original || source.split(record.before).length !== 2) {
    throw new Error('Unexpected Stencil compiler bytes');
  }
  const result = source.replace(record.before, record.after);
  if (digest(result) !== record.patched) throw new Error('Stencil patch output checksum mismatch');
  return result;
}

function safeFile(root, relative) {
  const actual = fs.realpathSync(path.resolve(root, relative));
  if (actual !== path.join(fs.realpathSync(root), relative) || !fs.statSync(actual).isFile()) {
    throw new Error('Symlinked or non-regular Stencil compiler rejected');
  }
  return actual;
}

function plan(lock, read, patchedOnly = true) {
  return entries(lock).flatMap(file => {
    const source = read(file);
    if (patchedOnly && digest(source) !== spec.patched) throw new Error('Stencil output-path patch missing or changed');
    const result = transform(source);
    return result === source ? [] : [{ file, source, result }];
  });
}

function inspect(root, patchedOnly = true) {
  return plan(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')),
    file => fs.readFileSync(safeFile(root, file), 'utf8'), patchedOnly);
}

function apply(root) {
  const writes = inspect(root, false);
  for (const item of writes) {
    if (fs.readFileSync(safeFile(root, item.file), 'utf8') !== item.source) throw new Error('Stencil changed during validation');
  }
  for (const item of writes) fs.writeFileSync(safeFile(root, item.file), item.result);
  inspect(root);
  return writes.length;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    if (process.argv[2] === '--check') { inspect(root); console.log('Stencil output-path patch verified.'); }
    else if (process.argv[2] === '--apply') console.log('Stencil compiler files patched: ' + apply(root));
    else throw new Error('Use --check or explicitly approved --apply');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { outputPath, entries, transform, plan, inspect, digest, spec };
