import { extractPlainEAK, ServerBundle } from '@stellarsecurity/stellar-crypto';

export class VaultAccessError extends Error {
  constructor(public readonly translationKey: 'notesKeyMissing' | 'notesKeyUnlockFailed' | 'notesClientUpgradeRequired') {
    super(translationKey);
    this.name = 'VaultAccessError';
  }
}
function validBase64(value: unknown, length: number): boolean {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(length / 3)) return false;
  try { const raw = atob(value); return raw.length === length && btoa(raw) === value; } catch { return false; }
}
/** No writes, no new vault creation, and no network use of notesPassword. */
export async function unlockLegacyNotesKey(user: any, notesPassword: string): Promise<string> {
  const state = user?.notes_crypto_state;
  if ((state !== undefined && !['legacy', 'prepared', 'dual'].includes(state))
    || (user?.crypto_version !== undefined && user?.crypto_version !== 'v1')) {
    throw new VaultAccessError('notesClientUpgradeRequired');
  }
  const params = user?.kdf_params;
  if (!validBase64(user?.eak_b64, 60) || !validBase64(user?.kdf_salt_b64, 16)
    || params?.algo !== 'PBKDF2' || params?.hash !== 'SHA-256'
    || !Number.isSafeInteger(params?.iters) || params.iters < 1 || params.iters > 2000000) {
    throw new VaultAccessError('notesKeyMissing');
  }
  const bundle: ServerBundle = { crypto_version: 'v1', kdf_params: params,
    kdf_salt: user.kdf_salt_b64, eak: user.eak_b64 };
  try {
    const { eakB64, eakBytes } = await extractPlainEAK(notesPassword, bundle);
    try {
      if (eakBytes.length !== 32) throw new Error('Invalid master key length');
      return eakB64;
    } finally { eakBytes.fill(0); }
  } catch {
    // Do not include passwords, ciphertext, response bodies or native crypto errors.
    throw new VaultAccessError('notesKeyUnlockFailed');
  }
}
