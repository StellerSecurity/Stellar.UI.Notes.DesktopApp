const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers-sumo");

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
    throw new Error(`Unsupported manifest signing platform: ${platform}`);
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

  const skB64 = process.env.STELLAR_RELEASE_ED25519_SK_BASE64;
  if (!skB64) throw new Error("Missing STELLAR_RELEASE_ED25519_SK_BASE64");

  const manifestBytes = fs.readFileSync(manifestPath);
  const sk = Buffer.from(skB64.trim(), "base64");

  if (sk.length !== 64) {
    throw new Error(`Bad private key length: ${sk.length} bytes (expected 64)`);
  }

  const sig = sodium.crypto_sign_detached(manifestBytes, sk);
  fs.writeFileSync(sigPath, Buffer.from(sig).toString("base64"), "utf8");

  console.log("Signed:", path.basename(manifestPath));
  console.log("Wrote:", path.basename(sigPath));
})();
