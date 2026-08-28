import { unpackCipherBlob } from '@stellarsecurity/stellar-crypto';

import { CryptoKeyService } from './crypto-key.service';

describe('CryptoKeyService compatibility', () => {
  it('decrypts an existing packed v1 note without changing its formatted HTML', async () => {
    const service = new CryptoKeyService();
    const existingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const existingCiphertext =
      'AAECAwQFBgcICQoLtLsNHmmT6tmtFjfZ0nPgMCRSlPjNo7PZv/XYe7N5ZgGJ18jNPgJUwBeg89ssFBh8pQ+U13fz/1SzCvU=';

    await service.importEAK(existingKey);
    const plaintext = await service.decryptText(unpackCipherBlob(existingCiphertext), 'note-1');

    expect(plaintext).toBe('<p>Line one</p><p><br></p><p>Line three</p>');
  });
});
