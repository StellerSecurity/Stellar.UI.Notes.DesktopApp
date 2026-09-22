// Local app-lock envelope only. Never used for synced notes or the server EAK.
const PREFIX = 'stellar-local-key-v2:';
const ITERATIONS = 600000;
const AAD = new TextEncoder().encode('stellar-notes/local-app-key/v2');
function decode(value: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('Invalid app key encoding');
  return bytes;
}
function encode(value: Uint8Array): string { return btoa(String.fromCharCode(...value)); }
function rawKey(value: string): Uint8Array {
  const bytes = decode(value);
  if (bytes.length !== 32) throw new Error('Invalid app key');
  return bytes;
}
async function keyFor(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!password) throw new Error('App password required');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', iterations:ITERATIONS, salt},
    base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export function isModernLocalAppKey(value: string): boolean { return value.startsWith(PREFIX); }
export async function wrapLocalAppKey(value: string, password: string): Promise<string> {
  const bytes = rawKey(value);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:AAD, tagLength:128},
    await keyFor(password, salt), bytes));
  const envelope = new Uint8Array(76);
  envelope.set(salt); envelope.set(iv,16); envelope.set(encrypted,28);
  return PREFIX + encode(envelope);
}
/** Call only after the existing app-password challenge has been verified. */
export async function unwrapLocalAppKey(stored: string, password: string,
  legacyDecrypt: (value: string, password: string) => string): Promise<string> {
  if (!password || typeof stored !== 'string' || stored.length > 1024) throw new Error('Invalid app key');
  if (isModernLocalAppKey(stored)) {
    const bytes = decode(stored.slice(PREFIX.length));
    if (bytes.length !== 76) throw new Error('Invalid app key envelope');
    const value = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes.slice(16,28), additionalData:AAD, tagLength:128},
      await keyFor(password, bytes.slice(0,16)), bytes.slice(28)));
    if (value.length !== 32) throw new Error('Invalid app key');
    return encode(value);
  }
  // Preserve both historical encrypted values and the old raw-key storage bug.
  try { rawKey(stored); return stored; } catch { /* Legacy OpenSSL envelope. */ }
  const value = legacyDecrypt(stored, password);
  rawKey(value);
  return value;
}
