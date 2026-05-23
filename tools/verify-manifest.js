const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers-sumo");

const DEFAULT_PUBKEY_B64 = "OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=";

const PLATFORM_MANIFEST_CANDIDATES = {
  linux: ["latest-linux.yml", "latest.yml"],
  win32: ["latest.yml"],
  windows: ["latest.yml"],
  darwin: ["latest-mac.yml", "latest.yml"],
  mac: ["latest-mac.yml", "latest.yml"]
};

function getArgValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function getPlatform() {
  return getArgValue("--platform") || process.env.STELLAR_RELEASE_PLATFORM || null;
}

function getCandidateManifestNames(platform) {
  if (!platform) {
    return [
      "latest-linux.yml",
      "latest.yml",
      "latest-mac.yml"
    ];
  }

  const candidates = PLATFORM_MANIFEST_CANDIDATES[platform];
  if (!candidates) {
    throw new Error(`Unsupported manifest verification platform: ${platform}`);
  }

  return candidates;
}

(async () => {
  await sodium.ready;

  const distDir = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : "dist";
  const platform = getPlatform();
  const candidates = getCandidateManifestNames(platform);

  const manifestPath = candidates
    .map((name) => path.join(distDir, name))
    .find((candidatePath) => fs.existsSync(candidatePath));

  if (!manifestPath) {
    throw new Error(
      `No manifest found in ${distDir} (expected one of: ${candidates.join(", ")})`
    );
  }

  const sigPath = manifestPath + ".sig";

  if (!fs.existsSync(sigPath)) {
    throw new Error(`Missing signature file: ${sigPath}`);
  }

  const pubkeyB64 = process.env.STELLAR_RELEASE_ED25519_PK_BASE64 || DEFAULT_PUBKEY_B64;
  const manifestBytes = fs.readFileSync(manifestPath);
  const sigB64 = fs.readFileSync(sigPath, "utf8");

  const pk = Buffer.from(pubkeyB64.trim(), "base64");
  const sig = Buffer.from(sigB64.trim(), "base64");

  if (pk.length !== 32) {
    throw new Error(`Bad public key length: ${pk.length} bytes (expected 32)`);
  }

  const ok = sodium.crypto_sign_verify_detached(sig, manifestBytes, pk);
  console.log("Manifest:", path.basename(manifestPath));
  console.log("Signature:", path.basename(sigPath));
  console.log("verify =", ok ? "OK" : "FAIL");

  if (!ok) process.exit(1);
})();
