const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');const vm=require('node:vm');
const {createUpdateStatus}=require('../desktop-update-status.cjs');
test('status exposes only fixed phases and bounded rounded percentages, coalescing progress',()=>{
  const sent=[];const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:(...args)=>sent.push(args)}};
  const status=createUpdateStatus(()=>win);
  status.set('downloading',64.2);status.set('downloading',64.4);
  assert.equal(sent.length,1);assert.deepEqual(status.snapshot(),{phase:'downloading',percent:64});
  status.set('downloading',1000);assert.equal(status.snapshot().percent,100);
  status.set('downloading',NaN);assert.equal(status.snapshot().percent,null);
  status.set('private error with credentials');assert.equal(status.snapshot().phase,'downloading');
  const copy=status.snapshot();copy.phase='error';assert.equal(status.snapshot().phase,'downloading');
  status.set('installing',90);assert.deepEqual(status.snapshot(),{phase:'installing',percent:null});
});
test('updater events publish progress and still schedule installation automatically',()=>{
  const source=fs.readFileSync('electron-start.js','utf8'),updater=new EventEmitter(),scheduled=[];
  const status=createUpdateStatus(()=>null);let installs=0;
  const context=vm.createContext({process:{platform:'darwin'},autoUpdater:updater,updateStatus:status,logLine:()=>{},setTimeout:callback=>scheduled.push(callback),clearTimeout:()=>{},downloadedUpdateTimer:null,installDownloadedUpdate:()=>installs++,installingUpdate:false,persistenceGuard:{cancelUpdate:()=>{}}});
  vm.runInContext(source.slice(source.indexOf('/* ================= OTA EVENTS'),source.indexOf('/* ================= IPC')),context);
  updater.emit('update-available',{version:'test'});assert.equal(status.snapshot().phase,'downloading');
  updater.emit('download-progress',{percent:64});assert.equal(status.snapshot().percent,64);
  updater.emit('update-downloaded',{version:'test'});assert.equal(status.snapshot().phase,'verifying');
  assert.equal(installs,0);scheduled[0]();assert.equal(installs,1);
  updater.emit('error',Error('private details'));assert.deepEqual(status.snapshot(),{phase:'error',percent:null});
});
test('only the trusted main frame can read the cached update state',()=>{
  const source=fs.readFileSync('electron-start.js','utf8');let handler;
  const mainWindow={webContents:{mainFrame:{}}};
  const status=createUpdateStatus(()=>null);status.set('downloading',80);
  const context=vm.createContext({mainWindow,updateStatus:status,ipcMain:{handle:(_name,callback)=>handler=callback}});
  vm.runInContext(source.slice(source.indexOf("ipcMain.handle('stellar-get-update-status'"),source.indexOf('ipcMain.handle("app-version"')),context);
  assert.equal(handler({sender:{},senderFrame:{}}),null);
  assert.equal(handler({sender:mainWindow.webContents,senderFrame:{}}),null);
  assert.deepEqual(handler({sender:mainWindow.webContents,senderFrame:mainWindow.webContents.mainFrame}),{phase:'downloading',percent:80});
});
for(const failure of [null,'hash','save'])test(`Linux automatic update retains hash and durable-save checks (${failure || 'success'})`,async()=>{
  const source=fs.readFileSync('electron-start.js','utf8'),calls=[];
  const context=vm.createContext({
    process:{platform:'linux',env:{APPIMAGE:'/synthetic/current.AppImage'}},Buffer,
    app:{isPackaged:true,getVersion:()=> '0.1.3',getPath:()=>'/synthetic',quit:()=>calls.push('quit')},
    fetchSignedManifest:async()=>({manifestBytes:Buffer.from('fixture')}),
    parseElectronBuilderYaml:()=>({version:'0.1.4',fileUrl:'next.AppImage',sha512Base64:'expected'}),
    t:key=>key,compareVersions:()=>1,normalizeUrl:()=> 'https://example.invalid/next.AppImage',getUpdateBaseUrl:()=> 'https://example.invalid',
    updateStatus:{set:(phase)=>calls.push(phase)},setUpdateProgress:()=>{},setMainProgress:()=>{},formatMB:()=>'',
    path:require('node:path'),fs:{mkdirSync:()=>{},chmodSync:()=>calls.push('chmod'),existsSync:()=>false,unlinkSync:()=>calls.push('remove')},
    httpsDownloadToFileWithProgress:async(_url,_file,progress)=>progress({transferred:64,total:100}),
    sha512Base64:async()=>failure==='hash'?'invalid':'expected',
    persistenceGuard:{prepareForUpdate:async()=>{calls.push('flush');return failure!=='save';},cancelUpdate:()=>calls.push('cancel')},
    getLinuxInstallPaths:()=>({appImagePath:'/synthetic/installed'}),isRunningInstalledLinuxAppImage:()=>false,
    spawn:()=>{calls.push('spawn');return {unref:()=>{}};},logLine:()=>{},
    dialog:{showMessageBoxSync:()=>{throw Error('Must not require a manual update click');}}
  });
  vm.runInContext(source.slice(source.indexOf('async function secureLinuxUpdateFlow()'),source.indexOf('/* ================= SECURE WINDOWS')),context);
  if(failure){await assert.rejects(context.secureLinuxUpdateFlow(),failure==='hash'?/sha512 mismatch/:/could not be flushed/);assert.equal(calls.includes('spawn'),false);assert.equal(calls.includes('error'),true);}
  else {await context.secureLinuxUpdateFlow();assert.ok(calls.indexOf('flush')<calls.indexOf('spawn'));assert.equal(calls.at(-1),'quit');}
  if(failure==='hash')assert.equal(calls.includes('flush'),false);
});
