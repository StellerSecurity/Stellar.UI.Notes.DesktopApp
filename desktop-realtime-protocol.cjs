const fs = require('node:fs');
const path = require('node:path');

function redactRealtimeSecrets(line) {
  return line.replace(/([?&](?:access_token|token)=)[^&\s"'<>]*/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');
}

// This origin serves only the two connection helper assets. The main app keeps
// its existing file origin, so upgrades cannot strand local notes or keys.
function realtimeAsset(request) {
  if (request.method !== 'GET') return null;
  switch (request.url) {
    case 'stellar-notes://realtime/': return ['desktop-realtime.html', 'text/html'];
    case 'stellar-notes://realtime/connect.js': return ['desktop-realtime.js', 'text/javascript'];
    default: return null;
  }
}

function registerRealtimeProtocol(protocol) {
  protocol.handle('stellar-notes', request => {
    const asset = realtimeAsset(request);
    if (!asset) return new Response(null, { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, asset[0])), {
      headers: { 'Content-Type': asset[1], 'Cache-Control': 'no-store' }
    });
  });
}
module.exports = { realtimeAsset, registerRealtimeProtocol, redactRealtimeSecrets };
