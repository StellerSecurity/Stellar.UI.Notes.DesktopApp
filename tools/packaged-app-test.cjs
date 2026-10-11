'use strict';
// Black-box tests of an installed release. Node built-ins only; never import app code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, label, timeout = 45000) {
  const end = Date.now() + timeout;
  do { const result = await action(); if (result) return result; await delay(200); } while (Date.now() < end);
  throw Error(`Timed out: ${label}`);
}
function loopbackWebSocket(value) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !/^\/devtools\/page\/[\w-]+$/.test(url.pathname)) {
    throw Error('Debug target is not a loopback page');
  }
  return url.href;
}
async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.exceptions = 0;
    socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') this.exceptions++;
      const item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id); clearTimeout(item.timer);
      if (msg.error) item.reject(Error(`CDP ${item.method} failed`)); else item.resolve(msg.result);
    });
    socket.addEventListener('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('Debug session closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(loopbackWebSocket(url));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(Error('Debug connection timeout')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Debug connection failed')); }, { once: true });
    });
    const cdp = new CDP(socket); await cdp.send('Runtime.enable'); return cdp;
  }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP ${method} timeout`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async value(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    // Do not emit exception details: authentication failures can contain secrets.
    if (result.exceptionDetails) throw Error('Renderer test expression failed');
    return result.result.value;
  }
  async click(selector) {
    const point = await until(() => this.value(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e =>
        !e.closest('.ion-page-hidden') && e.getBoundingClientRect().width && e.getBoundingClientRect().height);
      if (!el) return null;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`), `visible control ${selector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  async text(selector, text) { await this.click(selector); await this.send('Input.insertText', { text }); }
  async key(key, code, virtualKey, modifiers = 0) {
    const params = { key, code, windowsVirtualKeyCode: virtualKey, modifiers };
    const text = !modifiers && (key === 'Enter' ? '\r' : key.length === 1 ? key : undefined);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(text ? { text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }
  async screenshot(file) {
    // Never capture credentials, login forms or unexpected user data.
    assert.equal(await this.value(`!!document.querySelector('.desktop-layout') && ![...document.querySelectorAll('input[type=password]')].some(e => !e.closest('.ion-page-hidden') && e.getBoundingClientRect().width && e.getBoundingClientRect().height)`), true);
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  }
}

async function launch(executable, profile) {
  const port = await freePort();
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
  // Consume output but never publish raw application logs (they may contain tokens).
  child.stdout.resume();
  let startupFailure = '';
  child.stderr.on('data', bytes => {
    const text = bytes.toString();
    for (const label of ['No usable sandbox', 'Missing X server', 'error while loading shared libraries', 'Running as root']) {
      if (text.includes(label)) startupFailure = label;
    }
  });
  let spawnFailed = false; child.on('error', () => { spawnFailed = true; });
  let cdp;
  try {
    const target = await until(async () => {
      if (spawnFailed || child.exitCode !== null) throw Error(`Packaged application failed to start${startupFailure ? ': ' + startupFailure : ''}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
        const targets = await response.json();
        return targets.find(t => t.type === 'page' && t.url.startsWith('file:') && /\/index\.html(?:#|$)/.test(t.url));
      } catch { return false; }
    }, 'packaged renderer debugging target', 60000);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await until(() => cdp.value(`!!document.querySelector('.create-note-btn')`), 'application home');
    assert.equal(await cdp.value(`typeof require === 'undefined' && typeof process === 'undefined'`), true, 'Node must be isolated from renderer');
    let stopped = false;
    return { cdp, child, async stop() {
      if (stopped) return; stopped = true;
      try { await cdp.send('Page.close'); } catch { /* Window closure disconnects CDP. */ }
      cdp.socket.close();
      await Promise.race([once(child, 'exit'), delay(5000)]);
      if (child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), delay(3000)]); }
    } };
  } catch (error) { cdp?.socket.close(); child.kill(); throw error; }
}

const storedNotes = `JSON.parse(localStorage.getItem('notes') || '[]')`;
async function note(cdp, marker) {
  return cdp.value(`${storedNotes}.find(n => !n.deleted && (n.text || '').includes(${JSON.stringify(marker)})) || null`);
}
async function openNote(cdp, id) {
  await cdp.click(`.home-note-list ion-item[id="${id}"]`);
  await until(() => cdp.value(`!!document.querySelector('.ql-editor[contenteditable=true]')`), 'note editor');
}
async function newNote(cdp, marker) {
  await cdp.click('.create-note-btn');
  await cdp.text('.ql-editor[contenteditable=true]', marker);
  return until(() => note(cdp, marker), 'note saved to real app storage');
}
async function credentialsForm(cdp, route, credentials, submit) {
  await cdp.value(`location.hash = ${JSON.stringify(route)}`);
  await cdp.text('ion-input[formcontrolname=email] input', credentials.username);
  await cdp.text('ion-input[formcontrolname=password] input', credentials.password);
  await cdp.click(submit);
  await until(() => cdp.value(`!location.hash.includes('/profile/') && !!document.querySelector('.create-note-btn')`), 'QA authentication', 60000);
}
async function append(cdp, text) {
  await cdp.click('.ql-editor'); await cdp.key('End', 'End', 35, 2);
  await cdp.send('Input.insertText', { text });
  await cdp.click('.notes-heading'); // Let the normal editor blur/save path run.
}

async function run(executable, output, sync) {
  if (!['win32', 'linux'].includes(process.platform)) throw Error('Run on the target Windows/Linux CI machine');
  if (process.env.TF_BUILD !== 'True' || !process.env.AGENT_TEMPDIRECTORY) throw Error('Requires an isolated Azure build agent');
  if (!fs.statSync(executable).isFile()) throw Error('Packaged executable missing');
  fs.mkdirSync(output, { recursive: true });
  const root = fs.mkdtempSync(path.join(process.env.AGENT_TEMPDIRECTORY, 'stellar-qa-'));
  const profileA = path.join(root, 'profile-a'); const profileB = path.join(root, 'profile-b');
  const marker = `QA-PACKAGED-${crypto.randomUUID()}`;
  const report = { platform: process.platform, tests: [], syncRequested: sync, success: false };
  let a, b;
  async function check(name, action) {
    const started = Date.now(); await action();
    report.tests.push({ name, passed: true, milliseconds: Date.now() - started });
    console.log(`PASS ${name}`);
  }
  try {
    a = await launch(executable, profileA);
    await check('packaged startup and empty isolated profile', async () => {
      assert.deepEqual(await a.cdp.value(storedNotes), []);
      await a.cdp.screenshot(path.join(output, '01-startup.png'));
    });
    let first;
    await check('editor typing, literal dash-space, bold and real local storage', async () => {
      first = await newNote(a.cdp, marker);
      await a.cdp.key('Enter', 'Enter', 13);
      await a.cdp.send('Input.insertText', { text: '-' });
      await a.cdp.key(' ', 'Space', 32);
      await a.cdp.send('Input.insertText', { text: 'literal dash' });
      await a.cdp.key('Enter', 'Enter', 13);
      await a.cdp.click('.ql-bold');
      await a.cdp.send('Input.insertText', { text: 'BOLD QA' });
      await a.cdp.click('.ql-bold');
      await a.cdp.click('.notes-heading');
      await until(async () => {
        const n = await note(a.cdp, marker);
        return n && /<strong>BOLD QA<\/strong>/.test(n.text) && n.text.includes('- literal dash') && !/<li[ >]/.test(n.text);
      }, 'formatting persisted');
      await a.cdp.screenshot(path.join(output, '02-editor.png'));
    });
    await check('graceful restart restores saved note and formatting', async () => {
      await a.stop(); a = await launch(executable, profileA);
      const saved = await note(a.cdp, marker); assert.ok(saved, 'Saved note disappeared');
      assert.match(saved.text, /<strong>BOLD QA<\/strong>/);
      await openNote(a.cdp, saved.id);
      await until(() => a.cdp.value(`document.querySelector('.ql-editor')?.textContent.includes('BOLD QA')`), 'reopened editor');
      await a.cdp.screenshot(path.join(output, '03-restart.png'));
    });
    if (sync) {
      // Reserved domain avoids sending verification mail to an unrelated person.
      // A different disposable QA account is created for each platform run; no production account is accepted.
      const credentials = { username: `notes-qa-${crypto.randomUUID()}@example.invalid`, password: crypto.randomBytes(32).toString('base64url') };
      await check('create dedicated QA account and authenticate two isolated clients', async () => {
        await credentialsForm(a.cdp, '/profile/create-account', credentials, '.create-button');
        report.qaAccount = credentials.username;
        // A restart exercises normal secure storage/auth initialization after registration.
        await a.stop(); a = await launch(executable, profileA);
        b = await launch(executable, profileB);
        assert.deepEqual(await b.cdp.value(storedNotes), []);
        await credentialsForm(b.cdp, '/profile/login', credentials, '.login-button');
      });
      await check('note sync A to B with identical rich text', async () => {
        const remote = await until(() => note(b.cdp, marker), 'real service sync A to B', 90000);
        const local = await note(a.cdp, marker);
        assert.equal(remote.text, local.text); first = remote;
        await openNote(b.cdp, remote.id);
      });
      await check('edit B to A updates the already-open editor', async () => {
        await openNote(a.cdp, first.id); await a.cdp.click('.notes-heading');
        await append(b.cdp, ' RETURN-FROM-B');
        await until(() => a.cdp.value(`document.querySelector('.ql-editor')?.textContent.includes('RETURN-FROM-B')`), 'live editor update', 90000);
        assert.equal((await note(a.cdp, marker)).text, (await note(b.cdp, marker)).text);
        await a.cdp.screenshot(path.join(output, '04-live-sync.png'));
      });
      await check('favorite and pin sync to second client', async () => {
        await a.cdp.click(`ion-item[id="${first.id}"] .note-actions-inline ion-button:nth-child(1)`);
        await a.cdp.click(`ion-item[id="${first.id}"] .note-actions-inline ion-button:nth-child(2)`);
        await until(async () => { const n = await note(b.cdp, marker); return n?.pinned && n?.favorite; }, 'metadata sync', 90000);
      });
      await check('offline edit survives restart and automatically synchronizes', async () => {
        await b.cdp.send('Network.enable');
        await b.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        await append(b.cdp, ' OFFLINE-RETURN');
        await until(async () => (await note(b.cdp, marker))?.text.includes('OFFLINE-RETURN'), 'offline persistence');
        await delay(2000);
        assert.ok(!(await note(a.cdp, marker))?.text.includes('OFFLINE-RETURN'), 'Offline client unexpectedly uploaded');
        await b.stop(); b = await launch(executable, profileB);
        assert.ok((await note(b.cdp, marker))?.text.includes('OFFLINE-RETURN'));
        await until(async () => (await note(a.cdp, marker))?.text.includes('OFFLINE-RETURN'), 'outbox replay after restart', 90000);
        await a.cdp.screenshot(path.join(output, '05-offline-recovery.png'));
      });
      await check('delete only this run’s QA note and sync deletion', async () => {
        await openNote(a.cdp, first.id);
        await a.cdp.click('.note-actions-menu-trigger ion-button');
        await a.cdp.click('.desktop-note-action-item.danger');
        await a.cdp.click('.confirmation-modal .blue-btn:not(.transparent-btn)');
        await until(async () => !(await note(a.cdp, marker)) && !(await note(b.cdp, marker)), 'deletion sync', 90000);
      });
    }
    assert.equal(a.cdp.exceptions, 0, 'Uncaught renderer exception');
    if (b) assert.equal(b.cdp.exceptions, 0, 'Uncaught second renderer exception');
    report.success = true;
  } catch (error) {
    // Only first-party error labels are retained; never dump page, network or credential objects.
    report.failure = String(error.message).slice(0, 240);
    throw error;
  } finally {
    await Promise.allSettled([a?.stop(), b?.stop()]);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    // Profiles contain QA authentication tokens. They must never become pipeline artifacts.
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (require.main === module) {
  const [executable, output, option] = process.argv.slice(2);
  if (!executable || !output || (option && option !== '--create-qa-account')) {
    console.error('Usage: node tools/packaged-app-test.cjs EXECUTABLE REPORT_DIRECTORY [--create-qa-account]');
    process.exitCode = 1;
  } else run(path.resolve(executable), path.resolve(output), option === '--create-qa-account').catch(error => {
    console.error(`Packaged app test failed: ${String(error.message).slice(0, 240)}`); process.exitCode = 1;
  });
}
module.exports = { loopbackWebSocket, until };
