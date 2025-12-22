const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

  // catch target="_blank"
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

}

ipcMain.on('open-external', (event, urlToOpen) => {
  if (urlToOpen) {
    shell.openExternal(urlToOpen).catch(err => {
      console.error('Failed to open external URL:', err);
    });
  }
});




app.on('ready', createWindow);
