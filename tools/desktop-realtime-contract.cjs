const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { realtimeAsset, registerRealtimeProtocol, redactRealtimeSecrets } = require('../desktop-realtime-protocol.cjs');
let checks = 0;
function check(ok, name) { assert.ok(ok, name); checks++; }
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'desktop-realtime.js'), 'utf8');
function fixture(response = '{}', failure = false) {
  let listener; const parent = {}; const calls = [], replies = [];
  const port = { postMessage: reply => replies.push(reply), close() { this.closed = true; } };
  vm.runInNewContext(source, {
    window: { parent, addEventListener(name, fn) { assert.equal(name, 'message'); listener = fn; } },
    fetch: async (url, options) => { calls.push({ url, options }); if(failure) throw new Error('secret-error'); return new Response(response); },
    AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array
  });
  const event = { source: parent, origin: 'null', data: { type: 'stellar:realtime-negotiate', token: 'synthetic-test-token' }, ports: [port] };
  return { listener, event, calls, replies, port };
}
(async () => {
  check(redactRealtimeSecrets('WebSocket wss://example.invalid/?access_token=secret&x=1').includes('access_token=[REDACTED]&x=1'), 'WebSocket URLs redacted');
  check(!redactRealtimeSecrets(JSON.stringify({message:'Bearer synthetic-secret'})).includes('synthetic-secret'), 'structured bearer messages redacted');
  check(redactRealtimeSecrets('connection failed')==='connection failed', 'nonsecret diagnostics preserved');
  for (const url of ['stellar-notes://realtime/', 'stellar-notes://realtime/connect.js'])
    check(realtimeAsset({method:'GET', url}) !== null, 'allowed packaged helper');
  for (const url of ['stellar-notes://evil/', 'stellar-notes://realtime/../preload.js', 'stellar-notes://realtime/%2e%2e/preload.js',
    'stellar-notes://realtime/?token=x', 'stellar-notes://user@realtime/', 'stellar-notes://realtime:80/',
    'stellar-notes://realtime/connect.js#x', 'file:///etc/passwd', '__proto__', 'toString'])
    check(realtimeAsset({method:'GET', url}) === null, 'unlisted path rejected');
  check(realtimeAsset({method:'POST', url:'stellar-notes://realtime/'}) === null, 'cannot post to helper');
  let handle;
  registerRealtimeProtocol({handle(scheme, handler) { assert.equal(scheme,'stellar-notes'); handle=handler; }});
  check(handle({method:'GET',url:'stellar-notes://realtime/'}).headers.get('Content-Type') === 'text/html', 'HTML MIME');
  check(handle({method:'GET',url:'stellar-notes://realtime/connect.js'}).headers.get('Content-Type') === 'text/javascript', 'script MIME');
  check(handle({method:'GET',url:'stellar-notes://realtime/secrets'}).status === 404, 'no arbitrary file read');
  for (const change of [ {origin:'https://evil.invalid'}, {source:{}}, {ports:[]},
    {data:{type:'other',token:'x'}}, {data:{type:'stellar:realtime-negotiate',token:'a\r\nb'}},
    {data:{type:'stellar:realtime-negotiate',token:'x'.repeat(4097)}} ]) {
    const f=fixture(); await f.listener({...f.event,...change}); check(f.calls.length===0,'unauthorized frame input never calls API');
  }
  const f=fixture('{"enabled":false}'); await f.listener(f.event);
  check(f.calls.length===1 && f.calls[0].url.endsWith('/api/v1/notescontroller/realtime'), 'fixed destination');
  check(f.calls[0].options.headers.Authorization==='Bearer synthetic-test-token', 'token stays in Authorization');
  check(!('Origin' in f.calls[0].options.headers), 'real browser origin, no header spoofing');
  check(f.calls[0].options.redirect==='error' && f.calls[0].options.credentials==='omit', 'no redirected credentials or cookies');
  check(f.replies[0].ok===true && f.replies[0].grant.enabled===false && f.port.closed, 'disabled fallback and port cleanup');
  await f.listener(f.event); check(f.calls.length===1,'one negotiation per frame');
  const failed=fixture('',true); await failed.listener(failed.event);
  check(JSON.stringify(failed.replies)==='[{"ok":false}]','no exception or token disclosure');
  const large=fixture('x'.repeat(8193)); await large.listener(large.event);
  check(large.replies[0].ok===false && large.port.closed,'bounded response and cleanup');
  const html=fs.readFileSync(path.join(root,'desktop-realtime.html'),'utf8');
  check(html.includes("default-src 'none'") && html.includes("script-src 'self'") && !html.includes('unsafe-inline'),'restricted helper CSP');
  const shell=fs.readFileSync(path.join(root,'electron-start.js'),'utf8');
  check(shell.includes('.loadFile(APP_INDEX_PATH)') && !shell.includes('bypassCSP: true'),'existing notes storage origin and CSP preserved');
  const files=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).build.files;
  check(['desktop-realtime.html','desktop-realtime.js','desktop-realtime-protocol.cjs'].every(f=>files.includes(f)),'helper shipped in installer');
  console.log('PASS: '+checks+' desktop realtime security contracts');
})().catch(error=>{console.error(error);process.exitCode=1;});
