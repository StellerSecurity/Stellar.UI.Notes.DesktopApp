const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers-sumo");

const PUBKEY_B64 = process.env.STELLAR_RELEASE_ED25519_PK_BASE64;
if (!PUBKEY_B64) throw new Error("Missing STELLAR_RELEASE_ED25519_PK_BASE64");

(async () => {
  await sodium.ready;

  const distDir = process.argv[2] || "dist";
  const manifestPath = path.join(distDir, "latest-linux.yml");
  const sigPath = manifestPath + ".sig";

  const manifestBytes = fs.readFileSync(manifestPath);
  const sigB64 = fs.readFileSync(sigPath, "utf8");

  const pk = Buffer.from(PUBKEY_B64.trim(), "base64");
  const sig = Buffer.from(sigB64.trim(), "base64");

  const ok = sodium.crypto_sign_verify_detached(sig, manifestBytes, pk);
  console.log("verify =", ok ? "OK" : "FAIL");
})();
