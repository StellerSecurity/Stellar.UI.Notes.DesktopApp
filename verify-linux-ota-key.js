const sodium = require("libsodium-wrappers-sumo");

const STELLAR_RELEASE_PUBKEY_B64 =
  "OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=";

const PRIVATE_KEY_B64 = process.env.STELLAR_LINUX_OTA_PRIVATE_KEY_B64;

(async () => {
  await sodium.ready;

  if (!PRIVATE_KEY_B64) {
    throw new Error("Missing STELLAR_LINUX_OTA_PRIVATE_KEY_B64");
  }

  const sk = Buffer.from(PRIVATE_KEY_B64, "base64");

  if (sk.length !== 64) {
    throw new Error(
      `Invalid Ed25519 private key length: ${sk.length} bytes (expected 64)`
    );
  }

  const derivedPk = sodium.crypto_sign_ed25519_sk_to_pk(sk);
  const derivedPkB64 = Buffer.from(derivedPk).toString("base64");

  console.log("Expected public key:");
  console.log(STELLAR_RELEASE_PUBKEY_B64);
  console.log("");

  console.log("Derived public key from private key:");
  console.log(derivedPkB64);
  console.log("");

  const isMatch = derivedPkB64 === STELLAR_RELEASE_PUBKEY_B64;
  console.log("MATCH =", isMatch);

  if (!isMatch) {
    process.exitCode = 1;
  }
})();
