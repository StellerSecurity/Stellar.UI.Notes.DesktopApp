'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loopbackWebSocket, until, stopChild } = require('./packaged-app-test.cjs');

test('debugger cannot attach to remote, browser or non-page endpoints', () => {
  assert.equal(loopbackWebSocket('ws://127.0.0.1:1234/devtools/page/abc-123'), 'ws://127.0.0.1:1234/devtools/page/abc-123');
  for (const url of ['ws://evil.test/devtools/page/abc', 'ws://127.0.0.1:1234/devtools/browser/abc',
    'wss://127.0.0.1/devtools/page/abc', 'file:///devtools/page/abc']) {
    assert.throws(() => loopbackWebSocket(url));
  }
});
test('a failed readiness assertion cannot silently pass', async () => {
  await assert.rejects(until(async () => false, 'missing renderer', 1), /Timed out: missing renderer/);
});
test('readiness preserves application failure instead of retrying forever', async () => {
  await assert.rejects(until(async () => { throw Error('application exited'); }, 'app'), /application exited/);
});

test('cleanup waits for a running QA child to exit before returning', async () => {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter(); child.exitCode=null; child.signalCode=null;
  child.kill=()=>setImmediate(()=>{child.exitCode=0; child.emit('exit',0);});
  await stopChild(child,1000);
  assert.equal(child.exitCode,0);
});
test('cleanup never signals an already exited process', async () => {
  await stopChild({exitCode:0,signalCode:null,kill(){throw Error('must not signal');}});
});
