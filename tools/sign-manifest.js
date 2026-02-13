const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers-sumo");

(async () => {
  await sodium.ready;

  const distDir = process.argv[2] || "dist";

  // Support both names
  const candidates = ["latest-linux.yml", "latest.yml"];
  const manifestPath = candidates
    .map((n) => path.join(distDir, n))
    .find((p) => fs.existsSync(p));

  if (!manifestPath) {
    throw new Error(`No manifest found in ${distDir} (expected latest-linux.yml or latest.yml)`);
  }

  const sigPath = manifestPath + ".sig";

  const skB64 = process.env.STELLAR_RELEASE_ED25519_SK_BASE64;
  if (!skB64) throw new Error("Missing STELLAR_RELEASE_ED25519_SK_BASE64");

  const manifestBytes = fs.readFileSync(manifestPath);
  const sk = Buffer.from(skB64.trim(), "base64");

  const sig = sodium.crypto_sign_detached(manifestBytes, sk);
  fs.writeFileSync(sigPath, Buffer.from(sig).toString("base64"), "utf8");

  console.log("Signed:", path.basename(manifestPath));
  console.log("Wrote:", path.basename(sigPath));
})();
