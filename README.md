# Stellar Private Notes – Client App for Desktop

This is the **official client** for Stellar Private Notes – a zero-knowledge, end‑to‑end encrypted notes application by **Stellar Security (Switzerland)**.

The client is built with **Angular** (and Ionic/Capacitor for mobile builds) and talks to the Stellar Notes API over HTTPS.  
All encryption and decryption happen **only on the client**. The server never sees your plaintext notes or encryption keys.

---

## 🔐 Zero‑Knowledge by Design

The client implements the full cryptographic flow:

- User provides a password.
- The client derives a **Password Key (PK)** using **PBKDF2‑SHA256** with a high iteration count and a random salt.
- The PK is used to unwrap a 32‑byte **Master Key (MK)** from the encrypted key blob (**EAK**).
- The MK is kept **only in memory** and is used to encrypt/decrypt all note content with **AES‑GCM (256‑bit)**.
- Only encrypted notes and encrypted key material are sent to the server.

> Not even Stellar can decrypt user notes. Only the user’s devices hold the keys in plaintext.

---

## 🌟 Stellar ID Is Optional

The client supports two flows:

1. **Create a new Stellar ID inside the app**
- During registration, the app creates a fresh E2EE vault and uploads the EAK bundle to the API.

2. **Log in with an existing Stellar ID created elsewhere**
- Some users may have created a Stellar ID on `stellarsecurity.com` or another Stellar product before using Private Notes.
- In that case, the account may **not yet have an EAK** attached.
- On first login, if the API returns a user *without* `eak_b64` / `kdf_salt_b64`, the client:
  - Creates a new vault locally.
  - Generates a new EAK bundle.
  - Calls the API’s `updateEak` endpoint to attach the EAK to the existing account.
  - From that point on, the account is fully E2EE‑enabled.

Stellar ID is therefore **optional** for using notes:  
you can come from the broader Stellar ecosystem or start directly in this app.

## Clean Install & Build (macOS)

Follow these steps to perform a clean setup and build for the MAC OS:

```bash
# Remove existing dependencies and build artifacts
rm -rf node_modules
rm -rf package-lock.json
rm -rf dist

# Verify and clean npm cache
npm cache verify

# Install dependencies
npm install

# Install rollup without running post-install scripts
npm install rollup --ignore-scripts

# Rebuild native modules
npm rebuild

# Build Electron app for macOS
npm run electron:macBuild -- --publish always

# Build Electron app for Window
npm run electron:winBuild -- --publish always
```

Follow these steps to perform a clean setup and build for the Window OS(Command Prompt):

```bash
# Remove existing dependencies and build artifacts
rmdir /s /q node_modules
del /f /q package-lock.json
rmdir /s /q dist

# Verify and clean npm cache
npm cache verify

# Install dependencies
npm install

# Install rollup without running post-install scripts
npm install rollup --ignore-scripts

# Rebuild native modules
npm rebuild

# Build Electron app for Windows
npm run electron:winBuild -- --publish always
```

Follow these steps to perform a clean setup and build for the Linux OS(bash / zsh):

```bash
# Remove existing dependencies and build artifacts
rm -rf node_modules
rm -f package-lock.json
rm -rf dist

# Verify and clean npm cache
npm cache verify

# Install dependencies
npm install

# Install rollup without running post-install scripts
npm install rollup --ignore-scripts

# Rebuild native modules
npm rebuild

# Build Electron app for Linux
npm run electron:linuxBuild -- --publish always
```
