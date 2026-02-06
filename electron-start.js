const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const url = require('url');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const yaml = require('js-yaml');
const sodium = require('libsodium-wrappers-sumo');
const { spawn } = require('child_process');

let mainWindow;

// Public key only (Ed25519)
const STELLAR_RELEASE_PUBKEY_B64 = "OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=";

const UPDATE_BASE_URL = "https://desktopreleasesassetsprod.stellarsecurity.com/notes/linux/";
const MANIFEST_NAMES = ["latest-linux.yml", "latest.yml"]; // fallback (some builders use latest.yml)

/* ================= SECURE LINUX UPDATER ================= */

function httpsGetBuffer(urlToGet) {
  return new Promise((resolve, reject) => {
    https.get(urlToGet, { headers: { "User-Agent": "StellarNotesUpdater/1.0" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${urlToGet} failed: ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function httpsDownloadToFile(urlToGet, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath, { mode: 0o600 });
    https.get(urlToGet, { headers: { "User-Agent": "StellarNotesUpdater/1.0" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${urlToGet} failed: ${res.statusCode}`));
        res.resume();
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      try { fs.unlinkSync(outPath); } catch (_) {}
      reject(err);
    });
  });
}

function normalizeUrl(base, maybeRelative) {
  if (!maybeRelative) throw new Error("Missing url");
  if (maybeRelative.startsWith("http://") || maybeRelative.startsWith("https://")) return maybeRelative;
  return base.replace(/\/+$/, "/") + maybeRelative.replace(/^\/+/, "");
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha512");
    const s = fs.createReadStream(filePath);
    s.on("data", (d) => h.update(d));
    s.on("end", () => resolve(h.digest("base64")));
    s.on("error", reject);
  });
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function parseElectronBuilderYaml(manifestText) {
  const doc = yaml.load(manifestText);
  if (!doc || typeof doc !== "object") throw new Error("Invalid manifest YAML");

  const version = doc.version;
  const files = doc.files;

  if (!version) throw new Error("Manifest missing version");
  if (!Array.isArray(files) || files.length < 1) throw new Error("Manifest missing files[]");

  const file = files[0];
  if (!file.url) throw new Error("Manifest file missing url");
  if (!file.sha512) throw new Error("Manifest file missing sha512");

  return { version, fileUrl: file.url, sha512Base64: file.sha512 };
}

async function verifyManifestOrThrow(manifestBytes, sigB64) {
  await sodium.ready;
  const pk = Buffer.from(STELLAR_RELEASE_PUBKEY_B64, "base64");
  const sig = Buffer.from(sigB64.trim(), "base64");
  const ok = sodium.crypto_sign_verify_detached(sig, manifestBytes, pk);
  if (!ok) throw new Error("Manifest signature verification failed");
}

async function fetchSignedManifest() {
  let lastErr = null;

  for (const name of MANIFEST_NAMES) {
    const manifestUrl = normalizeUrl(UPDATE_BASE_URL, name);
    const sigUrl = manifestUrl + ".sig";

    try {
      const manifestBytes = await httpsGetBuffer(manifestUrl);
      const sigText = (await httpsGetBuffer(sigUrl)).toString("utf8");
      await verifyManifestOrThrow(manifestBytes, sigText);
      return { manifestBytes, manifestUrl };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to fetch signed manifest");
}

async function secureLinuxUpdateFlow() {
  if (process.platform !== "linux") return;
  if (!app.isPackaged) return; // don't update-check in dev

  const { manifestBytes } = await fetchSignedManifest();
  const manifestText = manifestBytes.toString("utf8");
  const { version: remoteVersion, fileUrl, sha512Base64: expectedSha512 } =
    parseElectronBuilderYaml(manifestText);

  const localVersion = app.getVersion();
  if (compareVersions(remoteVersion, localVersion) <= 0) return;

  const choice = dialog.showMessageBoxSync({
    type: "info",
    buttons: ["Update", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `Update available: ${localVersion} → ${remoteVersion}`,
    detail: "Update is verified (Ed25519 signed manifest + sha512 file hash) before launch."
  });
  if (choice !== 0) return;

  const fullFileUrl = normalizeUrl(UPDATE_BASE_URL, fileUrl);

  const updatesDir = path.join(app.getPath("userData"), "updates");
  fs.mkdirSync(updatesDir, { recursive: true });

  const outPath = path.join(updatesDir, `StellarPrivateNotes-${remoteVersion}.AppImage`);
  await httpsDownloadToFile(fullFileUrl, outPath);

  const actualSha512 = await sha512Base64(outPath);
  if (actualSha512 !== expectedSha512) {
    try { fs.unlinkSync(outPath); } catch (_) {}
    throw new Error("Downloaded AppImage sha512 mismatch");
  }

  fs.chmodSync(outPath, 0o755);

  spawn(outPath, [], { detached: true, stdio: "ignore", env: process.env }).unref();
  app.quit();
}

/* ================= WINDOW / APP ================= */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, 'dist/StellerPhoneNotesApp/index.html'),
      protocol: 'file:',
      slashes: true,
    })
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('ready-to-show', async () => {
    // ✅ Linux: secure updater (signed manifest)
    if (process.platform === "linux") {
      try {
        await secureLinuxUpdateFlow();
      } catch (e) {
        dialog.showMessageBox({
          type: "warning",
          message: "Update check failed",
          detail: String(e && e.message ? e.message : e)
        });
      }
      return;
    }

    // ✅ Win/mac: normal electron-updater flow
    autoUpdater.checkForUpdatesAndNotify();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ================= OTA EVENTS (Win/mac only) ================= */

if (process.platform !== "linux") {
  autoUpdater.on('checking-for-update', () => console.log('Checking for updates...'));
  autoUpdater.on('update-available', () => console.log('Update available'));
  autoUpdater.on('update-not-available', () => console.log('No update available'));
  autoUpdater.on('error', (err) => console.error('AutoUpdater error:', err));
  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded, restarting...');
    autoUpdater.quitAndInstall();
  });
}

/* ================= IPC ================= */

ipcMain.on('open-external', (event, urlToOpen) => {
  if (urlToOpen) {
    shell.openExternal(urlToOpen).catch(err => {
      console.error('Failed to open external URL:', err);
    });
  }
});

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
