'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { plan, transform, digest, entries, spec } = require('./braces-depth-patch.cjs');
const { evaluate } = require('./release-audit.cjs');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const readInstalled = file => fs.readFileSync(path.join(root, file), 'utf8');
// Exercise both states even after installation has been patched. This only
// reconstructs known original source as text; no dependency code is executed.
const read = file => {
  let source = readInstalled(file);
  const record = spec.files[file.slice('node_modules/braces/'.length)];
  if (digest(source) === record.patched && record.patched !== record.original) {
    for (const [before, after] of [...record.replacements].reverse()) source = source.replace(after, before);
  }
  assert.equal(digest(source), record.original);
  return source;
};
const now = new Date('2026-10-11T12:00:00Z');

test('builds the four-file patch as text without executing dependency code or changing files', () => {
  const before = Object.fromEntries(Object.keys(spec.files).map(file => [file, readInstalled('node_modules/braces/' + file)]));
  const writes = plan(lock, read);
  assert.equal(writes.length, 4);
  for (const { file, source, result } of writes) {
    assert.equal(read(file), source);
    const name = file.slice('node_modules/braces/'.length);
    assert.equal(digest(result), spec.files[name].patched);
    assert.equal(transform(name, result), result);
    assert.ok(result.includes('STELLAR_BRACES_DEPTH'));
  }
  for (const [file, source] of Object.entries(before)) assert.equal(readInstalled('node_modules/braces/' + file), source);
});

test('verification rejects clean but unpatched installed files', () => {
  assert.throws(() => plan(lock, read, true), /patch missing/);
});

test('verification accepts the exact patch in memory and rejects one changed byte', () => {
  const patchedRead = file => transform(file.slice('node_modules/braces/'.length), read(file));
  assert.deepEqual(plan(lock, patchedRead, true), []);
  assert.throws(() => plan(lock, file => patchedRead(file) + ' ', true), /patch missing/);
});

test('a changed original or manifest fails closed before producing a patch', () => {
  assert.throws(() => plan(lock, file => read(file) + ' '), /Unexpected braces bytes/);
});

for (const change of [{ version: '3.0.4' }, { integrity: 'different' }, { dev: false }, { link: true }, { resolved: 'https://example.com/package.tgz' }]) {
  test('rejects unreviewed lock entry ' + JSON.stringify(change), () => {
    const changed = structuredClone(lock);
    Object.assign(changed.packages['node_modules/braces'], change);
    assert.throws(() => entries(changed), /Unreviewed or runtime/);
  });
}

test('rejects unsafe dependency paths', () => {
  const bad = { packages: { 'node_modules/../node_modules/braces': lock.packages['node_modules/braces'] } };
  assert.throws(() => entries(bad), /Unreviewed/);
});

function report() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { name: 'braces', severity: 'high', nodes: ['node_modules/braces'], via: [{
        name: 'braces', dependency: 'braces', url: 'https://github.com/advisories/' + spec.advisory,
        severity: 'high', range: '<=3.0.3',
      }] },
      micromatch: { name: 'micromatch', severity: 'high', nodes: ['node_modules/micromatch'], via: ['braces'] },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
  };
}

test('proposed audit recognizes only the exact verified mitigation and retains findings', () => {
  const input = report(), before = JSON.stringify(input);
  assert.deepEqual(evaluate(input, true, now).mitigated, ['braces', 'micromatch']);
  assert.equal(JSON.stringify(input), before);
});

test('rejects absent patch verification, expiry and invalid time', () => {
  assert.throws(() => evaluate(report(), false, now), /not been verified/);
  assert.throws(() => evaluate(report(), true, new Date(spec.expires)), /expired/);
  assert.throws(() => evaluate(report(), true, new Date('invalid')), /expired/);
});

test('never accepts another advisory through the mitigated dependency', () => {
  const input = report();
  input.vulnerabilities.braces.via.push({ ...input.vulnerabilities.braces.via[0], url: 'https://github.com/advisories/GHSA-other' });
  assert.throws(() => evaluate(input, true, now), /Unmitigated/);
});

test('retains lower findings while recognizing the sole mitigated high cause', () => {
  const input = report();
  input.vulnerabilities.micromatch.via.push({ name: 'other', severity: 'moderate', url: 'https://example.com/other' });
  assert.deepEqual(evaluate(input, true, now).mitigated, ['braces', 'micromatch']);
  input.vulnerabilities.micromatch.via[1].severity = 'high';
  assert.throws(() => evaluate(input, true, now), /Unmitigated/);
});

test('rejects critical findings even on the same dependency', () => {
  const input = report(); input.vulnerabilities.braces.severity = 'critical';
  input.metadata.vulnerabilities.high--; input.metadata.vulnerabilities.critical++;
  assert.throws(() => evaluate(input, true, now), /Unmitigated/);
});

test('rejects missing dependency causes and cycles', () => {
  for (const cause of ['missing', 'micromatch']) {
    const input = report(); input.vulnerabilities.micromatch.via = [cause];
    assert.throws(() => evaluate(input, true, now), /Unmitigated/);
  }
});

test('rejects network errors, empty reports and inconsistent audit totals', () => {
  assert.throws(() => evaluate({ error: { code: 'ENETUNREACH' } }, true, now), /invalid/);
  assert.throws(() => evaluate({}, true, now), /invalid/);
  const input = report(); input.metadata.vulnerabilities.high++;
  assert.throws(() => evaluate(input, true, now), /counts/);
});

test('rejects a malformed high finding instead of considering an empty cause list safe', () => {
  const input = report(); input.vulnerabilities.braces.via = [];
  assert.throws(() => evaluate(input, true, now), /Malformed/);
});
