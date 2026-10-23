// Standard envelope primitives only. Not wired to enrollment, sync or account activation.
// Requires a CSPRNG-generated 32-byte secret independent of Stellar ID and app lock.
export interface VaultContext {
  account_id: string;
  vault_id: string;
  key_epoch: number;
  envelope_id: string;
}
export interface VaultEnvelopeV2 extends VaultContext {
  v: 2;
  suite: 'HKDF-SHA256/AES-256-GCM';
  salt_b64: string;
  iv_b64: string;
  wrapped_key_b64: string;
}
const SUITE = 'HKDF-SHA256/AES-256-GCM' as const;
const PURPOSE = 'stellar-notes/master-key-wrap/v2';
const TEXT = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIELDS = ['v', 'suite', 'account_id', 'vault_id', 'key_epoch', 'envelope_id',
  'salt_b64', 'iv_b64', 'wrapped_key_b64'].sort().join(',');
function fail(): never { throw new Error('NOTES_INVALID_ENVELOPE'); }
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decode(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(length / 3)) return fail();
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return fail(); }
  if (bytes.length !== length || encode(bytes) !== value) return fail();
  return bytes;
}
function context(input: VaultContext): VaultContext {
  if (!input || typeof input.account_id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(input.account_id) || input.account_id.trim() !== input.account_id
    || typeof input.vault_id !== 'string' || input.vault_id.length !== 36 || !UUID.test(input.vault_id)
    || typeof input.envelope_id !== 'string' || input.envelope_id.length !== 36 || !UUID.test(input.envelope_id)
    || !Number.isSafeInteger(input.key_epoch) || input.key_epoch < 1 || input.key_epoch > 2147483647) return fail();
  return { account_id: input.account_id, vault_id: input.vault_id, key_epoch: input.key_epoch, envelope_id: input.envelope_id };
}
function keyBytes(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array) || input.length !== 32) return fail();
  return new Uint8Array(input);
}
function aad(envelope: VaultEnvelopeV2): Uint8Array {
  return TEXT.encode(JSON.stringify([PURPOSE, envelope.v, envelope.suite, envelope.account_id,
    envelope.vault_id, envelope.key_epoch, envelope.envelope_id, envelope.salt_b64]));
}
async function kek(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const copy = keyBytes(secret);
  try {
    const material = await crypto.subtle.importKey('raw', new Uint8Array(copy), 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt),
      info: TEXT.encode(PURPOSE) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { copy.fill(0); }
}
export function createNotesRecoverySecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
export function validateVaultEnvelope(input: unknown, expected: VaultContext): VaultEnvelopeV2 {
  const pinned = context(expected);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== FIELDS) return fail();
  const value = input as VaultEnvelopeV2;
  const actual = context(value);
  if (value.v !== 2 || value.suite !== SUITE
    || Object.keys(pinned).some(key => actual[key as keyof VaultContext] !== pinned[key as keyof VaultContext])) return fail();
  decode(value.salt_b64, 32); decode(value.iv_b64, 12); decode(value.wrapped_key_b64, 48);
  return { ...actual, v: 2, suite: SUITE, salt_b64: value.salt_b64,
    iv_b64: value.iv_b64, wrapped_key_b64: value.wrapped_key_b64 };
}
export async function wrapExistingMasterKey(master: Uint8Array, secret: Uint8Array, expected: VaultContext): Promise<VaultEnvelopeV2> {
  const pinned = context(expected);
  const copy = keyBytes(master);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope: VaultEnvelopeV2 = { ...pinned, v: 2, suite: SUITE,
    salt_b64: encode(salt), iv_b64: encode(iv), wrapped_key_b64: '' };
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
      additionalData: new Uint8Array(aad(envelope)) }, await kek(secret, salt), new Uint8Array(copy));
    return { ...envelope, wrapped_key_b64: encode(new Uint8Array(encrypted)) };
  } finally { copy.fill(0); }
}
export async function unwrapMasterKey(input: unknown, secret: Uint8Array, expected: VaultContext): Promise<Uint8Array> {
  const envelope = validateVaultEnvelope(input, expected);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', tagLength: 128,
    iv: new Uint8Array(decode(envelope.iv_b64, 12)), additionalData: new Uint8Array(aad(envelope)) },
    await kek(secret, decode(envelope.salt_b64, 32)), new Uint8Array(decode(envelope.wrapped_key_b64, 48)));
  const result = new Uint8Array(plain);
  if (result.length !== 32) { result.fill(0); return fail(); }
  return result;
}
/** Verify the DOWNLOADED envelope against the unlocked legacy master key locally.
 * This is not a server-verifiable proof, a recovery backup test, or enrollment authorization.
 */
export async function verifyRewrappedMasterKey(input: unknown, secret: Uint8Array, expected: VaultContext,
  original: Uint8Array): Promise<void> {
  const copy = keyBytes(original);
  let recovered: Uint8Array | undefined;
  try {
    recovered = await unwrapMasterKey(input, secret, expected);
    let difference = 0;
    for (let i = 0; i < 32; i++) difference |= copy[i] ^ recovered[i];
    if (difference !== 0) throw new Error('NOTES_MIGRATED_KEY_MISMATCH');
  } finally { copy.fill(0); recovered?.fill(0); }
}
