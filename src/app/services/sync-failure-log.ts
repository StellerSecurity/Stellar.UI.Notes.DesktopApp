/** Diagnostics contain counts and sizes only, never note bodies, IDs, URLs or tokens. */
export function logSyncFailure(operation: 'upload' | 'delete', payload: any, error: any): void {
  try {
    const status = Number.isInteger(error?.status) && error.status >= 0 && error.status <= 599 ? error.status : null;
    const reason = error?.message === 'Note upload was not confirmed' ? 'confirmation-mismatch'
      : error?.name === 'TimeoutError' ? 'timeout'
      : status === 413 ? 'payload-too-large'
      : status === 0 ? 'connection-failed'
      : status !== null ? 'http-error' : 'other';
    console.warn('[notes-sync-failure]', JSON.stringify({
      operation, status, reason,
      requestBytes: new TextEncoder().encode(JSON.stringify(payload ?? {})).byteLength,
      noteCount: Array.isArray(payload?.notes) ? payload.notes.length : 0,
    }));
  } catch { /* Diagnostics must never interfere with the durable retry queue. */ }
}
