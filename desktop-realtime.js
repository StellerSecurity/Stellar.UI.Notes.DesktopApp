// An isolated, short-lived frame: no storage, arbitrary URLs, or note payloads.
(() => {
  let used = false;
  window.addEventListener('message', async event => {
    if (used || event.source !== window.parent || window.parent === window
      || event.origin !== 'null' || event.data?.type !== 'stellar:realtime-negotiate'
      || event.ports.length !== 1 || typeof event.data.token !== 'string'
      || !event.data.token || event.data.token.length > 4096
      || /[\r\n]/.test(event.data.token)) return;
    used = true;
    const port = event.ports[0];
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 6500);
    try {
      const response = await fetch('https://stellarprivatenotesuiappapiprod-dmefgreabahpcsbm.swedencentral-01.azurewebsites.net/api/v1/notescontroller/realtime', {
        method: 'POST', body: '{}', redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${event.data.token}` }
      });
      if (!response.ok) throw new Error('Negotiation unavailable');
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 8192) throw new Error('Grant too large');
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      port.postMessage({ ok: true, grant: JSON.parse(new TextDecoder().decode(bytes)) });
    } catch { port.postMessage({ ok: false }); }
    finally { clearTimeout(deadline); port.close(); }
  });
})();
