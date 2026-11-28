'use strict';
const pattern = /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/;
function sessionCredentials(safeStorage, platform = process.platform) {
  function ready() {
    if (!safeStorage.isEncryptionAvailable() || (platform === 'linux' && ['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend()))) {
      throw Error('identitySecureStorageUnavailable');
    }
  }
  return {
    protect(value) {
      if (typeof value !== 'string' || !pattern.test(value)) throw Error('identityVerificationFailed');
      ready(); return safeStorage.encryptString(value).toString('base64');
    },
    open(value) {
      if (typeof value !== 'string' || value.length > 2048 || !value.length) throw Error('identityVerificationFailed');
      const bytes = Buffer.from(value, 'base64');
      if (bytes.toString('base64') !== value) throw Error('identityVerificationFailed');
      ready(); const plain = safeStorage.decryptString(bytes);
      if (!pattern.test(plain)) throw Error('identityVerificationFailed');
      return plain;
    },
  };
}
function installSessionCredentialIPC(ipcMain, getWindow, safeStorage, platform = process.platform) {
  const store = sessionCredentials(safeStorage, platform);
  for (const [channel, action] of [['stellar-protect-session-credential','protect'],['stellar-open-session-credential','open']]) {
    ipcMain.handle(channel, (event, value) => {
      const win = getWindow();
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('identityVerificationFailed');
      return store[action](value);
    });
  }
}
module.exports = {sessionCredentials, installSessionCredentialIPC};
