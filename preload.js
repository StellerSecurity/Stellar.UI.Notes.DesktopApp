// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setLanguage: (preference) => ipcRenderer.send('set-app-language', preference),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
