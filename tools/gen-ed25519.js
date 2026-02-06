// tools/gen-ed25519.js
const sodium = require("libsodium-wrappers-sumo");

(async () => {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  console.log("PUBLIC_KEY_BASE64=", Buffer.from(kp.publicKey).toString("base64"));
  console.log("SECRET_KEY_BASE64=", Buffer.from(kp.privateKey).toString("base64"));
})();
