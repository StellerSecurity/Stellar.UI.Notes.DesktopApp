const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const yaml = require("js-yaml");
const sodium = require("libsodium-wrappers-sumo");
const { spawn } = require("child_process");

let mainWindow;
let startupUpdateCheckScheduled = false;

// Public key only (Ed25519)
const STELLAR_RELEASE_PUBKEY_B64 = "OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=";

const UPDATE_BASE_URL = "https://desktopreleasesassetsprod.stellarsecurity.com/notes/linux/";
const MANIFEST_NAMES = ["latest-linux.yml", "latest.yml"];

const APP_INDEX_PATH = path.join(__dirname, "dist/StellerPhoneNotesApp/index.html");

/* ================= LOGGING ================= */

function logLine(...args) {
  const line =
    `[${new Date().toISOString()}] ` +
    args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch (_) {
          return String(arg);
        }
      })
      .join(" ");

  console.log(line);

  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "main.log"), line + "\n", "utf8");
  } catch (_) {}
}

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
  mainWindow.setProgressBar(p);
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/* ================= NETWORK HELPERS ================= */

function httpsGetBuffer(urlToGet) {
  return new Promise((resolve, reject) => {
    https
      .get(urlToGet, { headers: { "User-Agent": "StellarNotesUpdater/1.0" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${urlToGet} failed: ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function httpsDownloadToFileWithProgress(urlToGet, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath, { mode: 0o600 });

    https
      .get(urlToGet, { headers: { "User-Agent": "StellarNotesUpdater/1.0" } }, (res) => {
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
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(outPath);
        } catch (_) {}
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

async function fetchSignedManifest(progressWin = null) {
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
      logLine("Signed manifest fetch failed", {
        name,
        error: String(e && e.message ? e.message : e),
      });
    }
  }

  throw lastErr || new Error("Failed to fetch signed manifest");
}

/* ================= SECURE LINUX UPDATE FLOW ================= */

async function secureLinuxUpdateFlow() {
  if (process.platform !== "linux") return;
  if (!app.isPackaged) return;
  if (!process.env.APPIMAGE) return;

  let progressWin = null;

  try {
    // Silent background check: do NOT show spinner/window here
    const { manifestBytes } = await fetchSignedManifest(null);
    const manifestText = manifestBytes.toString("utf8");
    const {
      version: remoteVersion,
      fileUrl,
      sha512Base64: expectedSha512,
    } = parseElectronBuilderYaml(manifestText);

    const localVersion = app.getVersion();

    if (compareVersions(remoteVersion, localVersion) <= 0) {
      logLine("Linux update check: already up to date", {
        localVersion,
        remoteVersion,
      });
      return;
    }

    const choice = dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Update", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `Update available: ${localVersion} → ${remoteVersion}`,
      detail:
        "Update is verified (Ed25519 signed manifest + sha512 file hash) before launch.",
    });

    if (choice !== 0) return;

    // Only show progress UI AFTER user chooses to update
    progressWin = createUpdateProgressWindow(mainWindow);
    setUpdateProgress(progressWin, "Preparing download…", null, "");
    setMainProgress(0.01);

    const fullFileUrl = normalizeUrl(UPDATE_BASE_URL, fileUrl);
    const updatesDir = path.join(app.getPath("userData"), "updates");
    fs.mkdirSync(updatesDir, { recursive: true });

    const outPath = path.join(
      updatesDir,
      `StellarPrivateNotes-${remoteVersion}.AppImage`
    );

    await httpsDownloadToFileWithProgress(
      fullFileUrl,
      outPath,
      ({ transferred, total }) => {
        if (total && total > 0) {
          const pct = (transferred / total) * 100;
          setUpdateProgress(
            progressWin,
            "Downloading update…",
            pct,
            `${formatMB(transferred)} / ${formatMB(total)}`
          );
          setMainProgress(
            Math.max(0.01, Math.min(0.99, transferred / total))
          );
        } else {
          setUpdateProgress(
            progressWin,
            "Downloading update…",
            null,
            `${formatMB(transferred)}`
          );
          setMainProgress(0.15);
        }
      }
    );

    setUpdateProgress(progressWin, "Verifying download…", null, "sha512 check");
    setMainProgress(0.99);

    const actualSha512 = await sha512Base64(outPath);
    if (actualSha512 !== expectedSha512) {
      try {
        fs.unlinkSync(outPath);
      } catch (_) {}
      throw new Error("Downloaded AppImage sha512 mismatch");
    }

    fs.chmodSync(outPath, 0o755);

    setUpdateProgress(progressWin, "Launching update…", 100, "");
    setMainProgress(-1);

    logLine("Launching downloaded Linux AppImage", { outPath, remoteVersion });
    spawn(outPath, [], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    }).unref();

    app.quit();
  } finally {
    setMainProgress(-1);
    try {
      if (progressWin && !progressWin.isDestroyed()) progressWin.close();
    } catch (_) {}
  }
}

/* ================= APP SHELL HELPERS ================= */

function loadMainApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  logLine("Loading renderer entry", { APP_INDEX_PATH });

  if (!fs.existsSync(APP_INDEX_PATH)) {
    const message = `Renderer entry not found:\n${APP_INDEX_PATH}`;
    logLine("Renderer entry missing", { APP_INDEX_PATH });

    dialog.showErrorBox("App load failed", message);
    return;
  }

  mainWindow.loadFile(APP_INDEX_PATH).then(() => {
    logLine("Renderer entry loaded");
  }).catch((err) => {
    logLine("Failed to load renderer entry", {
      error: String(err && err.message ? err.message : err)
    });
  });
}

function scheduleStartupUpdateCheck() {
  if (startupUpdateCheckScheduled) return;
  startupUpdateCheckScheduled = true;

  setTimeout(async () => {
    try {
      if (process.platform === "linux") {
        logLine("Starting Linux secure update flow");
        await secureLinuxUpdateFlow();
        return;
      }

      if (!app.isPackaged) {
        logLine("Skipping auto update check because app is not packaged");
        return;
      }

      logLine("Starting macOS/Windows update check");
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      logLine("Startup update check failed", { error: String(e && e.message ? e.message : e) });

      if (process.platform === "linux") {
        dialog.showMessageBox({
          type: "warning",
          message: "Update check failed",
          detail: String(e && e.message ? e.message : e)
        });
      }
    }
  }, 4000);
}

function normalizeLocalPathname(pathname) {
  let decoded = decodeURIComponent(pathname || "");
  if (process.platform === "win32" && decoded.startsWith("/")) {
    decoded = decoded.slice(1);
  }
  return path.normalize(decoded);
}

function installNavigationGuards() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const expectedIndexPath = path.normalize(APP_INDEX_PATH);

  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);

      if (parsed.protocol === "file:") {
        const targetPath = normalizeLocalPathname(parsed.pathname);

        if (targetPath !== expectedIndexPath) {
          event.preventDefault();
          logLine("Prevented full file navigation, reloading app shell instead", {
            navigationUrl,
            targetPath,
            expectedIndexPath
          });
          loadMainApp();
        }
      }
    } catch (e) {
      logLine("Navigation guard error", { error: String(e && e.message ? e.message : e) });
    }
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logLine("did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });

      if (isMainFrame && validatedURL && validatedURL.startsWith("file://")) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            logLine("Reloading app shell after did-fail-load");
            loadMainApp();
          }
        }, 300);
      }
    }
  );

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logLine("render-process-gone", details);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    logLine("did-finish-load");
  });

  mainWindow.webContents.on("did-navigate", (_event, navigationUrl) => {
    logLine("did-navigate", { navigationUrl });
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logLine("renderer-console", { level, message, line, sourceId });
  });

  app.on("child-process-gone", (_event, details) => {
    logLine("child-process-gone", details);
  });

  app.on("render-process-gone", (_event, _webContents, details) => {
    logLine("app-render-process-gone", details);
  });
}

/* ================= WINDOW / APP ================= */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  installNavigationGuards();
  loadMainApp();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }

    scheduleStartupUpdateCheck();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ================= OTA EVENTS (Win/mac only) ================= */

if (process.platform !== "linux") {
  autoUpdater.on("checking-for-update", () => logLine("AutoUpdater: checking-for-update"));
  autoUpdater.on("update-available", (info) => logLine("AutoUpdater: update-available", info));
  autoUpdater.on("update-not-available", (info) => logLine("AutoUpdater: update-not-available", info));
  autoUpdater.on("download-progress", (progressObj) => {
    logLine("AutoUpdater: download-progress", {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond
    });
  });
  autoUpdater.on("error", (err) => logLine("AutoUpdater error", { error: String(err && err.message ? err.message : err) }));
  autoUpdater.on("update-downloaded", (info) => {
    logLine("AutoUpdater: update-downloaded", info);
    setTimeout(() => {
      logLine("AutoUpdater: quitAndInstall");
      autoUpdater.quitAndInstall();
    }, 1500);
  });
}

/* ================= IPC ================= */

ipcMain.on("open-external", (_event, urlToOpen) => {
  if (urlToOpen) {
    shell.openExternal(urlToOpen).catch((err) => {
      logLine("Failed to open external URL", { error: String(err && err.message ? err.message : err), urlToOpen });
    });
  }
});

app.whenReady().then(() => {
  logLine("App ready", {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  });
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
