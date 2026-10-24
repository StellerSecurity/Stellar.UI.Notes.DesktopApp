'use strict';

// Run on the signing Mac after the app and DMG have been notarized and stapled.
// Only finalized, signed metadata and public release artifacts leave this machine.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PUBLIC_KEY = 'OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=';
const TEAM_ID = '7VYLUCU756';
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function releaseNames(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      version.split('.').some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error('A stable x.y.z release version is required.');
  }
  return ['zip', 'dmg'].map(ext => `Stellar Notes-${version}-arm64.${ext}`);
}

function signingKey(encoded, expectedPublicKey = PUBLIC_KEY) {
  if (typeof encoded !== 'string') throw new Error('Set STELLAR_RELEASE_ED25519_SK_BASE64 locally first.');
  const secret = Buffer.from(encoded.trim(), 'base64');
  try {
    if (secret.length !== 64 || secret.toString('base64') !== encoded.trim()) {
      throw new Error('The OTA key must be the existing 64-byte Ed25519 key in Base64.');
    }
    // libsodium stores seed || public key. Node accepts the seed as PKCS#8.
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, secret.subarray(0, 32)]),
      format: 'der', type: 'pkcs8'
    });
    const publicKey = crypto.createPublicKey(privateKey);
    const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    if (!rawPublicKey.equals(secret.subarray(32)) || rawPublicKey.toString('base64') !== expectedPublicKey) {
      throw new Error('OTA key does not match the key trusted by installed apps.');
    }
    return { privateKey, publicKey };
  } finally {
    secret.fill(0);
  }
}

function regularFile(file, maximum) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size >= maximum) {
    throw new Error(`Invalid release file: ${path.basename(file)}`);
  }
  return stat;
}

async function artifactInfo(file) {
  const stat = regularFile(file, 2 * 1024 ** 3);
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { url: path.basename(file), sha512: hash.digest('base64'), size: stat.size };
}

async function writeMetadata(directory, version, keys) {
  const names = releaseNames(version);
  const expected = names.flatMap(name => [name, `${name}.blockmap`]).sort();
  if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(expected)) {
    throw new Error('Expected exactly the ZIP, DMG and their two fresh blockmaps.');
  }
  const files = [];
  for (const name of names) {
    regularFile(path.join(directory, `${name}.blockmap`), 32 * 1024 ** 2);
    files.push(await artifactInfo(path.join(directory, name)));
  }
  const manifest = Buffer.from([
    `version: ${version}`, 'files:',
    ...files.flatMap(file => [`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`]),
    `path: ${files[0].url}`, `sha512: ${files[0].sha512}`,
    `releaseDate: '${new Date().toISOString()}'`, ''
  ].join('\n'));
  const signature = crypto.sign(null, manifest, keys.privateKey);
  if (!crypto.verify(null, manifest, keys.publicKey, signature)) throw new Error('OTA signature verification failed.');
  fs.writeFileSync(path.join(directory, 'latest-mac.yml'), manifest, { flag: 'wx' });
  fs.writeFileSync(path.join(directory, 'latest-mac.yml.sig'), signature.toString('base64'), { flag: 'wx' });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', maxBuffer: 2 * 1024 ** 2,
    // Blockmap and Apple verification commands do not need signing credentials.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

async function writeBlockmap(file) {
  // Use the same sidecar implementation as the pinned electron-builder 26.15.3.
  // app-builder-bin is no longer part of that toolchain.
  const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');
  const before = await artifactInfo(file);
  const output = `${file}.blockmap`;
  const result = await buildBlockMap(file, 'gzip', output);
  const after = await artifactInfo(file);
  if (result.sha512 !== before.sha512 || result.size !== before.size ||
      after.sha512 !== before.sha512 || after.size !== before.size) {
    throw new Error('Blockmap creation changed the finalized artifact.');
  }
  regularFile(output, 32 * 1024 ** 2);
}

async function finalize() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Finalize this ARM64 release on the Apple Silicon signing Mac.');
  }
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const version = pkg.version;
  const [zipName, dmgName] = releaseNames(version);
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package.json and package-lock.json versions must match.');
  }
  const keys = signingKey(process.env.STELLAR_RELEASE_ED25519_SK_BASE64);
  const dist = path.join(root, 'dist');
  const output = path.join(dist, `ota-${version}`);
  if (fs.existsSync(output)) throw new Error(`${output} already exists; preserve it before creating another release.`);
  const app = path.join(dist, 'mac-arm64', 'Stellar Notes.app');
  const dmg = path.join(dist, dmgName);
  const info = path.join(app, 'Contents', 'Info.plist');
  regularFile(dmg, 2 * 1024 ** 3);
  if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', info]) !== version) {
    throw new Error('The built app version does not match package.json; rebuild first.');
  }
  if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', info]) !== 'stellar.notes.app') {
    throw new Error('Unexpected app bundle identifier.');
  }
  if (run('/usr/bin/lipo', ['-archs', path.join(app, 'Contents', 'MacOS', 'Stellar Notes')]) !== 'arm64') {
    throw new Error('The built app must be ARM64.');
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const identity = run('/usr/bin/codesign', ['--display', '--verbose=4', app]);
  if (!identity.split('\n').includes(`TeamIdentifier=${TEAM_ID}`)) throw new Error('Unexpected Apple signing team.');
  run('/usr/bin/xcrun', ['stapler', 'validate', app]);
  run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', app]);
  const staging = fs.mkdtempSync(path.join(dist, '.ota-staging-'));
  try {
    // The original builder ZIP predates app stapling and must not be reused.
    run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(staging, zipName)]);
    fs.copyFileSync(dmg, path.join(staging, dmgName), fs.constants.COPYFILE_EXCL);
    for (const name of [zipName, dmgName]) {
      const file = path.join(staging, name);
      await writeBlockmap(file);
    }
    await writeMetadata(staging, version, keys);
    fs.renameSync(staging, output);
    console.log(`Prepared six finalized release files in ${output}`);
    console.log('Apple signature, stapling, OTA key and final artifact hashes checked. Nothing was uploaded.');
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  finalize().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { releaseNames, signingKey, artifactInfo, writeMetadata, writeBlockmap, PUBLIC_KEY };
