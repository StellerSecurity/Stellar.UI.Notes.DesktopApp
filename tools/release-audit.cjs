'use strict';
// Approved exact mitigation; never a general advisory allowlist.
// Reports the original advisory and accepts only a verified, tested mitigation.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspect, entries, spec } = require('./braces-depth-patch.cjs');
const advisoryUrl = 'https://github.com/advisories/' + spec.advisory;

function evaluate(report, verified, now = new Date()) {
  if (!verified) throw new Error('Braces mitigation has not been verified');
  if (!Number.isFinite(now.getTime()) || now >= new Date(spec.expires)) throw new Error('Braces mitigation review has expired');
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error('Missing or invalid npm audit report');
  }
  const vulnerabilities = report.vulnerabilities;
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const [name, item] of Object.entries(vulnerabilities)) {
    if (item.name !== name || !Object.hasOwn(counts, item.severity) ||
        !Array.isArray(item.via) || !item.via.length || !Array.isArray(item.nodes) || !item.nodes.length) {
      throw new Error('Malformed audit finding: ' + name);
    }
    counts[item.severity]++;
  }
  for (const [severity, count] of Object.entries(counts)) {
    if (report.metadata.vulnerabilities[severity] !== count) throw new Error('Audit counts do not match findings');
  }
  if (report.metadata.vulnerabilities.total !== Object.values(counts).reduce((a, b) => a + b, 0)) {
    throw new Error('Audit total does not match findings');
  }
  function causes(name, seen = new Set()) {
    if (seen.has(name)) return { safe: false, mitigated: false };
    const item = vulnerabilities[name];
    if (!item) return { safe: false, mitigated: false };
    const visited = new Set([...seen, name]);
    const results = item.via.map(via => {
      if (typeof via === 'string') return causes(via, visited);
      // Preserve the existing high/critical threshold. Lower findings remain
      // visible in the report and are not described as patched or waived.
      if (via && ['info', 'low', 'moderate'].includes(via.severity)) return { safe: true, mitigated: false };
      const mitigated = via && name === 'braces' && via.name === 'braces' && via.dependency === 'braces' &&
        via.url === advisoryUrl && via.severity === 'high' && via.range === '<=3.0.3';
      return { safe: !!mitigated, mitigated: !!mitigated };
    });
    return { safe: results.every(result => result.safe), mitigated: results.some(result => result.mitigated) };
  }
  const mitigated = [], blocked = [];
  for (const [name, item] of Object.entries(vulnerabilities)) {
    if (!['high', 'critical'].includes(item.severity)) continue;
    const cause = causes(name);
    if (item.severity === 'high' && cause.safe && cause.mitigated) mitigated.push(name);
    else blocked.push(name);
  }
  if (blocked.length) throw new Error('Unmitigated high/critical findings: ' + blocked.join(', '));
  return { counts, mitigated, advisory: spec.advisory, expires: spec.expires };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    inspect(root); // Hash-check every executable braces file and every locked copy.
    const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const locked = entries(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')));
    if (report.vulnerabilities?.braces && JSON.stringify([...report.vulnerabilities.braces.nodes].sort()) !== JSON.stringify(locked.sort())) {
      throw new Error('Audited braces locations do not match the verified lockfile');
    }
    const result = evaluate(report, true);
    const tests = spawnSync(process.execPath, ['--test', path.join(__dirname, 'braces-depth-regression.test.cjs')], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    });
    if (tests.error || tests.status !== 0) throw new Error('Braces mitigation regression tests failed: ' + (tests.error?.message || tests.stdout + tests.stderr));
    console.log(JSON.stringify(result, null, 2));
    console.log('Original audit findings remain in ' + process.argv[2] + '. No other advisory is exempted.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { evaluate };
