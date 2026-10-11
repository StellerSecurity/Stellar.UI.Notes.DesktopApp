'use strict';
// Validate unsigned CI artifacts as data; sign OTA metadata only on the signing Mac.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { signingKey, artifactInfo } = require('./finalize-mac-release.cjs');

function layout(platform, version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      version.split('.').some(n => !Number.isSafeInteger(Number(n)))) throw Error('Invalid version');
  if (platform === 'win') return { manifest: 'latest.yml', binary: `Stellar Notes-${version}-x64.exe`, blockmap: true };
  if (platform === 'linux') return { manifest: 'latest-linux.yml', binary: `Stellar Notes-${version}.AppImage`, blockmap: false };
  throw Error('Expected win or linux');
}

function regular(file, limit) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size >= limit) throw Error(`Unsafe or missing file: ${path.basename(file)}`);
}

function validateWindowsUpdater(file) {
  regular(file, 32769);
  const text = fs.readFileSync(file, 'utf8');
  // NsisUpdater skips its custom verifier when publisherName is absent.
  // This enables Stellar's Ed25519/hash verifier; it is not Authenticode signing.
  if (!/^publisherName:\r?\n  - Stellar Security\r?$/m.test(text) ||
      !/^provider: generic\r?$/m.test(text) ||
      !/^url: https:\/\/desktopreleasesassetsprod\.stellarsecurity\.com\/notes\/win\/\r?$/m.test(text)) {
    throw Error('Packaged Windows updater must enable the Stellar signature verifier and use the Windows update URL');
  }
}

function parseManifest(bytes) {
  if (bytes.length > 32768) throw Error('Manifest too large');
  const result = { files: [] }, seen = new Set();
  let file, inFiles = false;
  const scalar = value => {
    if (/^'[^']*'$/.test(value)) return value.slice(1, -1);
    if (value.startsWith('"')) {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') throw Error('Expected string');
      return parsed;
    }
    if (!value || /[\x00-\x1f\x7f#!&*{}\[\]<>|`]/.test(value)) throw Error('Unsupported manifest value');
    return value;
  };
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let match;
    if ((match = /^  - url: (.+)$/.exec(line))) {
      if (!inFiles) throw Error('Unexpected artifact');
      file = { url: scalar(match[1]) }; result.files.push(file);
    } else if ((match = /^    (sha512|size|blockMapSize): (.+)$/.exec(line))) {
      if (!inFiles || !file || Object.hasOwn(file, match[1])) throw Error('Duplicate or misplaced artifact field');
      file[match[1]] = scalar(match[2]);
    } else if ((match = /^(version|files|path|sha512|releaseDate):(?: (.*))?$/.exec(line))) {
      if (seen.has(match[1])) throw Error('Duplicate manifest field');
      seen.add(match[1]); inFiles = match[1] === 'files'; file = undefined;
      if (inFiles) { if (match[2]) throw Error('Unsupported files syntax'); }
      else result[match[1]] = scalar(match[2] || '');
    } else throw Error('Unsupported manifest syntax');
  }
  return result;
}

async function inspect(directory, platform, version) {
  const spec = layout(platform, version);
  regular(path.join(directory, spec.manifest), 32769);
  const bytes = fs.readFileSync(path.join(directory, spec.manifest));
  const manifest = parseManifest(bytes);
  const info = await artifactInfo(path.join(directory, spec.binary));
  if (manifest.version !== version || manifest.files.length !== 1 || manifest.files[0].url !== spec.binary ||
      manifest.path !== spec.binary || manifest.sha512 !== info.sha512 ||
      manifest.files[0].sha512 !== info.sha512 || String(info.size) !== manifest.files[0].size) {
    throw Error('Artifact version, platform, checksum or size does not match build metadata');
  }
  const names = [spec.manifest, spec.binary];
  if (spec.blockmap) {
    regular(path.join(directory, spec.binary + '.blockmap'), 32 * 1024 ** 2);
    names.push(spec.binary + '.blockmap');
  }
  return { spec, names, bytes };
}

async function stage(input, output, platform, version) {
  const checked = await inspect(input, platform, version);
  if (fs.existsSync(output)) throw Error('Output already exists; preserve it before retrying');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temp = fs.mkdtempSync(path.join(path.dirname(output), '.notes-stage-'));
  try {
    for (const name of checked.names) fs.copyFileSync(path.join(input, name), path.join(temp, name), fs.constants.COPYFILE_EXCL);
    await inspect(temp, platform, version);
    fs.renameSync(temp, output);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

async function finalize(input, output, platform, version, keys) {
  const checked = await inspect(input, platform, version);
  if (JSON.stringify(fs.readdirSync(input).sort()) !== JSON.stringify([...checked.names].sort())) {
    throw Error('Input must contain only the platform build artifacts');
  }
  if (fs.existsSync(output)) throw Error('Output already exists; preserve it before retrying');
  const temp = fs.mkdtempSync(path.join(path.dirname(output), '.notes-final-'));
  try {
    for (const name of checked.names) fs.copyFileSync(path.join(input, name), path.join(temp, name), fs.constants.COPYFILE_EXCL);
    const copied = await inspect(temp, platform, version);
    const signature = crypto.sign(null, copied.bytes, keys.privateKey);
    if (!crypto.verify(null, copied.bytes, keys.publicKey, signature)) throw Error('Signature verification failed');
    fs.writeFileSync(path.join(temp, copied.spec.manifest + '.sig'), signature.toString('base64'), { flag: 'wx' });
    fs.renameSync(temp, output);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (require.main === module) {
  (async () => {
    const [command, platform, inputArg, outputArg] = process.argv.slice(2);
    if (command === 'check-updater' && platform === 'win' && inputArg) {
      validateWindowsUpdater(path.resolve(inputArg));
      console.log('Packaged Windows updater enables the Stellar signature verifier');
      return;
    }
    if (!['stage', 'finalize'].includes(command) || !inputArg || (command === 'stage' && !outputArg)) {
      throw Error('Usage: node tools/finalize-desktop-release.cjs stage|finalize win|linux INPUT [OUTPUT], or check-updater win APP_UPDATE_YML');
    }
    const root = path.resolve(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw Error('Package versions disagree');
    layout(platform, pkg.version);
    const input = path.resolve(inputArg);
    const output = outputArg ? path.resolve(outputArg) : path.join(path.dirname(input), `ota-${platform}-${pkg.version}`);
    if (command === 'stage') await stage(input, output, platform, pkg.version);
    else await finalize(input, output, platform, pkg.version, signingKey(process.env.STELLAR_RELEASE_ED25519_SK_BASE64));
    console.log(`${command === 'stage' ? 'Unsigned build artifacts' : 'OTA-signed release files'} ready: ${output}`);
    console.log('Nothing was published.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { layout, parseManifest, inspect, stage, finalize, validateWindowsUpdater };
