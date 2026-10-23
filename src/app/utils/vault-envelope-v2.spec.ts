import vector from '../../../tests/fixtures/vault-envelope-v2.json';
import {createNotesRecoverySecret, unwrapMasterKey, verifyRewrappedMasterKey, wrapExistingMasterKey} from './vault-envelope-v2';
import {unlockLegacyNotesKey} from './legacy-vault-access';
import legacy from '../../../tests/fixtures/stellar-crypto-1.0.2.json';

const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
describe('Notes key serialization in browser WebCrypto', () => {
  it('decrypts the Node-produced envelope with identical canonical AAD', async () => {
    expect(await unwrapMasterKey(vector.envelope, decode(vector.recovery_secret_b64), vector.context))
      .toEqual(decode(vector.master_key_b64));
  });
  it('rewraps without replacing the original master key', async () => {
    const key = decode(vector.master_key_b64), secret = createNotesRecoverySecret();
    const envelope = await wrapExistingMasterKey(key, secret, vector.context);
    await verifyRewrappedMasterKey(JSON.parse(JSON.stringify(envelope)), secret, vector.context, key);
    expect(key).toEqual(decode(vector.master_key_b64));
  });
  it('rejects the wrong recovery secret', async () => {
    await expectAsync(unwrapMasterKey(vector.envelope, createNotesRecoverySecret(), vector.context)).toBeRejected();
  });
  it('reads the SDK 1.0.2 legacy fixture in the browser', async () => {
    expect(await unlockLegacyNotesKey({id: 11, crypto_version: 'v1', kdf_params: legacy.bundle.kdf_params,
      eak_b64: legacy.bundle.eak, kdf_salt_b64: legacy.bundle.kdf_salt}, legacy.password)).toBe(legacy.master_key_b64);
  });
});
