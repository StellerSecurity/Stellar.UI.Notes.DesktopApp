// Wait for local IndexedDB commits before closing the renderer. No note data crosses IPC.
const {randomUUID}=require('node:crypto');
function installPersistenceGuard(win,ipcMain,app,{timeoutMs=10000}={}) {
  let ready=false,allowed=false,pending=null,timer=null,quitting=false;
  const trusted=event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame;
  const onReady=event=>{if(trusted(event))ready=true;};
  const onFlushed=(event,id,success)=>{
    if(!trusted(event) || !pending || id!==pending)return;
    clearTimeout(timer);timer=null;pending=null;
    if(success!==true)return;
    allowed=true;if(quitting)app.quit();else win.close();
  };
  const onQuit=()=>{quitting=true;};
  const onClose=event=>{
    if(!ready || allowed)return;
    event.preventDefault();if(pending)return;
    pending=randomUUID();win.webContents.send('stellar-flush-persistence',pending);
    timer=setTimeout(()=>{pending=null;timer=null;},timeoutMs);
  };
  ipcMain.on('stellar-persistence-ready',onReady);
  ipcMain.on('stellar-persistence-flushed',onFlushed);
  app.on('before-quit',onQuit);win.on('close',onClose);
  win.on('closed',()=>{
    clearTimeout(timer);ipcMain.removeListener('stellar-persistence-ready',onReady);ipcMain.removeListener('stellar-persistence-flushed',onFlushed);app.removeListener('before-quit',onQuit);
  });
}
module.exports={installPersistenceGuard};
