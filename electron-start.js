const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const url = require('url');

let mainWindow;

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

  // dev tools
  // mainWindow.webContents.openDevTools();

  // ✅ SAFE: only after window exists
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ✅ SAFE: wait until window is ready
  mainWindow.on('ready-to-show', () => {
    autoUpdater.checkForUpdatesAndNotify();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ================= OTA EVENTS ================= */

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', () => {
  console.log('Update available');
});

autoUpdater.on('update-not-available', () => {
  console.log('No update available');
});

autoUpdater.on('error', (err) => {
  console.error('AutoUpdater error:', err);
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded, restarting...');
  autoUpdater.quitAndInstall();
});

/* ============================================= */

ipcMain.on('open-external', (event, urlToOpen) => {
  if (urlToOpen) {
    shell.openExternal(urlToOpen).catch(err => {
      console.error('Failed to open external URL:', err);
    });
  }
});

app.whenReady().then(createWindow);

// macOS: recreate window on dock click
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit on all windows closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
