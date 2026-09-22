/** Keep the app's existing storage origin; negotiate from a dedicated origin. */
export function desktopRealtimeGrant(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const channel = new MessageChannel();
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.src = 'stellar-notes://realtime/';
    const finish = (ok: boolean, value?: any) => {
      clearTimeout(deadline);
      frame.onload = null; frame.onerror = null;
      channel.port1.close(); channel.port2.close(); frame.remove();
      if (ok) resolve(value); else reject(new Error('Realtime unavailable'));
    };
    const deadline = setTimeout(() => finish(false), 7500);
    channel.port1.onmessage = event => finish(event.data?.ok === true, event.data?.grant);
    frame.onerror = () => finish(false);
    frame.onload = () => {
      try {
        if (!frame.contentWindow) { finish(false); return; }
        frame.contentWindow.postMessage({ type: 'stellar:realtime-negotiate', token },
          'stellar-notes://realtime', [channel.port2]);
      } catch { finish(false); }
    };
    try { document.body.appendChild(frame); } catch { finish(false); }
  });
}
