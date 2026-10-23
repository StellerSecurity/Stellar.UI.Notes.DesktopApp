// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getUpdateStatus: () => ipcRenderer.invoke('stellar-get-update-status'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('stellar-update-status', listener);
    return () => ipcRenderer.removeListener('stellar-update-status', listener);
  },
  persistenceReady: () => ipcRenderer.send('stellar-persistence-ready'),
  persistenceFlushed: (id,success) => { if(typeof id==='string' && id.length<80 && typeof success==='boolean')ipcRenderer.send('stellar-persistence-flushed',id,success); },
  setLanguage: (preference) => ipcRenderer.send('set-app-language', preference),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});

ipcRenderer.on('stellar-flush-persistence',(_event,id)=>{
  if(typeof id==='string' && id.length<80)window.dispatchEvent(new CustomEvent('stellar:flush-persistence',{detail:id}));
});
