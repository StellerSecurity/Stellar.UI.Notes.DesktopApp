'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { inspect: verifyBracesPatch, entries: verifyBracesLock } = require('./braces-depth-patch.cjs');

// Reviewed candidate versions. The lockfile and installation must agree;
// future upgrades require updating this contract alongside their review.
const versions = Object.freeze({
  electron: ['44.7.0'],
  'electron-builder': ['26.15.3'],
  'app-builder-lib': ['26.15.3'],
  piscina: ['5.3.2', '4.9.4'],
  'proxy-addr': ['2.0.8'],
  'websocket-driver': ['0.7.5'],
  'shell-quote': ['1.11.0'],
  'form-data': ['2.5.6', '3.0.5', '4.0.6'],
  '@angular/core': ['21.2.25'],
  '@angular/compiler-cli': ['21.2.25'],
  '@angular-devkit/build-angular': ['21.2.26'],
  typescript: ['5.9.3'],
  quill: ['2.0.3'],
  'ngx-quill': ['30.1.3'],
  'electron-updater': ['6.8.10'],
});

function validate(pkg, lock, readInstalled) {
  const errors = [];
  try { verifyBracesLock(lock); } catch (error) { errors.push(error.message); }
  const entries = Object.entries(lock.packages || {});
  for (const [name, allowed] of Object.entries(versions)) {
    const matches = entries.filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
    if (!matches.length) errors.push(`${name}: missing from lockfile`);
    for (const [key, value] of matches) {
      if (!allowed.includes(value.version)) errors.push(`${key}: unreviewed version ${value.version}`);
      if (readInstalled) {
        try {
          const installed = readInstalled(key);
          if (installed.version !== value.version) errors.push(`${key}: installed version differs from lockfile`);
        } catch { errors.push(`${key}: installed manifest unavailable`); }
      }
    }
  }
  for (const [name, section] of Object.entries({
    electron: 'devDependencies', 'electron-builder': 'devDependencies',
    '@angular/core': 'dependencies', '@angular/compiler-cli': 'devDependencies',
    '@angular-devkit/build-angular': 'devDependencies', typescript: 'devDependencies',
    quill: 'dependencies', 'ngx-quill': 'dependencies', 'electron-updater': 'dependencies',
  })) {
    if (pkg[section]?.[name] !== versions[name][0] || lock.packages?.['']?.[section]?.[name] !== versions[name][0]) {
      errors.push(`${name}: manifest and lock root must pin the reviewed version`);
    }
  }
  if (!Array.isArray(pkg.build?.linux?.executableArgs) || pkg.build.linux.executableArgs.length !== 0) errors.push('Linux must not inject launcher arguments');
  if (pkg.build?.afterPack !== 'tools/linux-after-pack.cjs') errors.push('Linux sandbox launcher hook missing');
  if (errors.length) throw new Error(errors.join('\n'));
}

function validateNode(version) {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !((major === 22 && minor >= 12) || major >= 24)) {
    throw new Error(`Node ${version} is unsupported by the release tools; Node 22.12+ (22.x) or >=24 is required.`);
  }
}

if (require.main === module) {
  try {
    validateNode(process.versions.node);
    const root = path.resolve(__dirname, '..');
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const lockOnly = process.argv.includes('--lock-only');
    validate(read(path.join(root, 'package.json')), read(path.join(root, 'package-lock.json')),
      lockOnly ? null : key => read(path.join(root, key, 'package.json')));
    if (!lockOnly) verifyBracesPatch(root);
    console.log('Release toolchain versions and Linux launcher configuration checked.');
  } catch (error) {
    console.error(`Release toolchain rejected:\n${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { validate, validateNode, versions };
