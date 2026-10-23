const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {installPersistenceGuard}=require('../desktop-persistence.cjs');
function fixture() {
  const win=new EventEmitter(),ipc=new EventEmitter(),app=new EventEmitter();
  const sent=[];win.webContents={mainFrame:{},send:(...args)=>sent.push(args)};
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  let closed=0,quit=0;
  win.close=()=>{let prevented=false;win.emit('close',{preventDefault:()=>prevented=true});if(!prevented){closed++;win.emit('closed');}};
  app.quit=()=>{quit++;app.emit('before-quit');win.close();};
  installPersistenceGuard(win,ipc,app,{timeoutMs:500});
  return {win,ipc,app,event,sent,get closed(){return closed;},get quit(){return quit;}};
}
test('waits for the trusted renderer flush before closing and does not send note data',()=>{
  const f=fixture();f.ipc.emit('stellar-persistence-ready',f.event);f.win.close();f.win.close();assert.equal(f.closed,0);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0][0],'stellar-flush-persistence');assert.match(f.sent[0][1],/^[a-f0-9-]{36}$/);
  f.ipc.emit('stellar-persistence-flushed',f.event,f.sent[0][1],true);assert.equal(f.closed,1);assert.equal(f.ipc.listenerCount('stellar-persistence-flushed'),0);
});
test('ignores untrusted frames and stale acknowledgements, and leaves a failed save open',()=>{
  const f=fixture();f.ipc.emit('stellar-persistence-ready',f.event);f.win.close();const id=f.sent[0][1];
  f.ipc.emit('stellar-persistence-flushed',{...f.event,senderFrame:{}},id,true);
  f.ipc.emit('stellar-persistence-flushed',f.event,'wrong',true);assert.equal(f.closed,0);
  f.ipc.emit('stellar-persistence-flushed',f.event,id,false);assert.equal(f.closed,0);
  f.win.close();assert.equal(f.sent.length,2);f.ipc.emit('stellar-persistence-flushed',f.event,f.sent[1][1],true);assert.equal(f.closed,1);
});
test('preserves application quit intent and permits closing before renderer bootstrap',()=>{
  const early=fixture();early.win.close();assert.equal(early.closed,1);
  const f=fixture();f.ipc.emit('stellar-persistence-ready',f.event);f.app.quit();assert.equal(f.closed,0);f.ipc.emit('stellar-persistence-flushed',f.event,f.sent[0][1],true);assert.equal(f.closed,1);assert.equal(f.quit,2);
});
