import { normalizeNoteSyncFlags } from './note-sync-normalize.util';

describe('normalizeNoteSyncFlags', () => {
  it('uses note_id instead of a database row id from the legacy find response', () => {
    const normalized = normalizeNoteSyncFlags({
      id: 42 as any,
      note_id: 'note-uuid' as any,
      text: 'ciphertext',
      last_modified: 100,
    });

    expect(normalized.id).toBe('note-uuid');
    expect(normalized.text).toBe('ciphertext');
  });
});
