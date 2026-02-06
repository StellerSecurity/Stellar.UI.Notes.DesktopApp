const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const url = require("url");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const yaml = require("js-yaml");
const sodium = require("libsodium-wrappers-sumo");
const { spawn } = require("child_process");

let mainWindow;

// Public key only (Ed25519)
const STELLAR_RELEASE_PUBKEY_B64 = "OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=";

const UPDATE_BASE_URL = "https://desktopreleasesassetsprod.stellarsecurity.com/notes/linux/";
const MANIFEST_NAMES = ["latest-linux.yml", "latest.yml"];

/* ================= SMALL UI: UPDATE PROGRESS WINDOW ================= */

function createUpdateProgressWindow(parent) {
  const win = new BrowserWindow({
    width: 440,
    height: 170,
    resizable: false,
    minimizable: false,
    maximizable: false,
    modal: !!parent,
    parent: parent || undefined,
    show: false,
    backgroundColor: "#111111",
    title: "Updating…",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif; background:#111; color:#eee; }
  .wrap { padding:16px; }
  .title { font-size:14px; opacity:0.95; margin-bottom:10px; }
  .bar { width:100%; height:10px; background:#2a2a2a; border-radius:999px; overflow:hidden; }
  .fill { height:100%; width:0%; background:#ffffff; opacity:0.92; transition: width 80ms linear; }
  .meta { margin-top:10px; font-size:12px; opacity:0.75; display:flex; justify-content:space-between; gap:12px; }
  .left { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .indet .fill { width:40%; animation: slide 0.9s infinite ease-in-out; }
  @keyframes slide {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(260%); }
  }
</style>
</head>
<body>
  <div class="wrap" id="root">
    <div class="title" id="phase">Preparing…</div>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="meta">
      <div class="left" id="detail"></div>
      <div id="pct"></div>
    </div>
  </div>

<script>
  window.__setProgress = (phase, percent, detail) => {
    document.getElementById('phase').textContent = phase || '';
    document.getElementById('detail').textContent = detail || '';
    const root = document.getElementById('root');
    const fill = document.getElementById('fill');
    const pct = document.getElementById('pct');

    if (percent === null || percent === undefined || isNaN(percent)) {
      root.classList.add('indet');
      pct.textContent = '';
      fill.style.width = '40%';
    } else {
      root.classList.remove('indet');
      const p = Math.max(0, Math.min(100, Math.floor(percent)));
      fill.style.width = p + '%';
      pct.textContent = p + '%';
    }
  };
</script>
</body>
</html>`.trim();

  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  win.once("ready-to-show", () => win.show());
  return win;
}

function setUpdateProgress(win, phase, percent, detail) {
  if (!win || win.isDestroyed()) return;
  const safePhase = JSON.stringify(String(phase || ""));
  const safeDetail = JSON.stringify(String(detail || ""));
  const pct = percent === null || percent === undefined ? "null" : String(Number(percent));
  win.webContents.executeJavaScript(`window.__setProgress(${safePhase}, ${pct}, ${safeDetail});`, true).catch(() => {});
}

function setMainProgress(p) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Electron: -1 removes progress bar
  mainWindow.setProgressBar(p);
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/* ================= NETWORK HELPERS ================= */

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

function httpsDownloadToFileWithProgress(urlToGet, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath, { mode: 0o600 });

    https.get(urlToGet, { headers: { "User-Agent": "StellarNotesUpdater/1.0" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${urlToGet} failed: ${res.statusCode}`));
        res.resume();
        return;
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      let transferred = 0;

      res.on("data", (chunk) => {
        transferred += chunk.length;
        if (onProgress) onProgress({ transferred, total });
      });

      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      res.on("error", reject);
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

/* ================= CRYPTO HELPERS ================= */

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
  if (pk.length !== 32) throw new Error(`Bad public key length: ${pk.length} bytes (expected 32)`);

  const sig = Buffer.from(sigB64.trim(), "base64");
  const ok = sodium.crypto_sign_verify_detached(sig, manifestBytes, pk);
  if (!ok) throw new Error("Manifest signature verification failed");
}

async function fetchSignedManifest(progressWin) {
  let lastErr = null;

  for (const name of MANIFEST_NAMES) {
    const manifestUrl = normalizeUrl(UPDATE_BASE_URL, name);
    const sigUrl = manifestUrl + ".sig";

    try {
      setUpdateProgress(progressWin, "Fetching update manifest…", null, name);
      const manifestBytes = await httpsGetBuffer(manifestUrl);

      setUpdateProgress(progressWin, "Fetching manifest signature…", null, name + ".sig");
      const sigText = (await httpsGetBuffer(sigUrl)).toString("utf8");

      setUpdateProgress(progressWin, "Verifying manifest signature…", null, "");
      await verifyManifestOrThrow(manifestBytes, sigText);

      return { manifestBytes, manifestUrl };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to fetch signed manifest");
}

/* ================= SECURE LINUX UPDATE FLOW ================= */

async function secureLinuxUpdateFlow() {
  if (process.platform !== "linux") return;
  if (!app.isPackaged) return;

  // Only run secure OTA for AppImage builds (not .deb installs)
  if (!process.env.APPIMAGE) return;

  let progressWin = null;

  try {
    progressWin = createUpdateProgressWindow(mainWindow);
    setMainProgress(0.05);
    setUpdateProgress(progressWin, "Checking for updates…", null, "");

    const { manifestBytes } = await fetchSignedManifest(progressWin);
    const manifestText = manifestBytes.toString("utf8");
    const { version: remoteVersion, fileUrl, sha512Base64: expectedSha512 } =
      parseElectronBuilderYaml(manifestText);

    const localVersion = app.getVersion();
    if (compareVersions(remoteVersion, localVersion) <= 0) {
      setMainProgress(-1);
      if (progressWin && !progressWin.isDestroyed()) progressWin.close();
      return;
    }

    if (progressWin && !progressWin.isDestroyed()) progressWin.close();
    progressWin = null;
    setMainProgress(-1);

    const choice = dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Update", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `Update available: ${localVersion} → ${remoteVersion}`,
      detail: "Update is verified (Ed25519 signed manifest + sha512 file hash) before launch."
    });
    if (choice !== 0) return;

    progressWin = createUpdateProgressWindow(mainWindow);
    setUpdateProgress(progressWin, "Preparing download…", null, "");
    setMainProgress(0.01);

    const fullFileUrl = normalizeUrl(UPDATE_BASE_URL, fileUrl);

    const updatesDir = path.join(app.getPath("userData"), "updates");
    fs.mkdirSync(updatesDir, { recursive: true });

    const outPath = path.join(updatesDir, `StellarPrivateNotes-${remoteVersion}.AppImage`);

    await httpsDownloadToFileWithProgress(fullFileUrl, outPath, ({ transferred, total }) => {
      if (total && total > 0) {
        const pct = (transferred / total) * 100;
        setUpdateProgress(
          progressWin,
          "Downloading update…",
          pct,
          `${formatMB(transferred)} / ${formatMB(total)}`
        );
        setMainProgress(Math.max(0.01, Math.min(0.99, transferred / total)));
      } else {
        setUpdateProgress(progressWin, "Downloading update…", null, `${formatMB(transferred)}`);
        setMainProgress(0.15);
      }
    });

    setUpdateProgress(progressWin, "Verifying download…", null, "sha512 check");
    setMainProgress(0.99);

    const actualSha512 = await sha512Base64(outPath);
    if (actualSha512 !== expectedSha512) {
      try { fs.unlinkSync(outPath); } catch (_) {}
      throw new Error("Downloaded AppImage sha512 mismatch");
    }

    fs.chmodSync(outPath, 0o755);

    setUpdateProgress(progressWin, "Launching update…", 100, "");
    setMainProgress(-1);

    spawn(outPath, [], { detached: true, stdio: "ignore", env: process.env }).unref();
    app.quit();
  } finally {
    setMainProgress(-1);
    try { if (progressWin && !progressWin.isDestroyed()) progressWin.close(); } catch (_) {}
  }
}

/* ================= WINDOW / APP ================= */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "dist/StellerPhoneNotesApp/index.html"),
      protocol: "file:",
      slashes: true
    })
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("ready-to-show", async () => {
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

    autoUpdater.checkForUpdatesAndNotify();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ================= OTA EVENTS (Win/mac only) ================= */

if (process.platform !== "linux") {
  autoUpdater.on("checking-for-update", () => console.log("Checking for updates..."));
  autoUpdater.on("update-available", () => console.log("Update available"));
  autoUpdater.on("update-not-available", () => console.log("No update available"));
  autoUpdater.on("error", (err) => console.error("AutoUpdater error:", err));
  autoUpdater.on("update-downloaded", () => {
    console.log("Update downloaded, restarting...");
    autoUpdater.quitAndInstall();
  });
}

/* ================= IPC ================= */

ipcMain.on("open-external", (event, urlToOpen) => {
  if (urlToOpen) {
    shell.openExternal(urlToOpen).catch((err) => {
      console.error("Failed to open external URL:", err);
    });
  }
});

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
