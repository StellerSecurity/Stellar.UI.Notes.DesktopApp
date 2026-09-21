/** Older desktop builds accidentally stored a raw key in the encrypted-key slot.
 * Call only after the existing app-password challenge has been verified.
 */
export function readUnlockedAppKey(stored: string, password: string, decrypt: (value: string, password: string) => string): { key: string; needsWrapping: boolean } {
  const isKey = (value: string): boolean => {
    try { return typeof value === 'string' && atob(value).length === 32 && btoa(atob(value)) === value; } catch { return false; }
  };
  if (isKey(stored)) return { key: stored, needsWrapping: true };
  const key = decrypt(stored, password);
  if (!isKey(key)) throw new Error('Invalid app key');
  return { key, needsWrapping: false };
}
