import { Subject, of, from } from 'rxjs';
import { NotesApiV1Service } from './services/notes-api-v1.service';
import { OutboxStorage } from './services/outbox-storage.service';
import { SyncWorkerService } from './services/sync-worker.service';
import { NotesService } from './services/notes.service';
import { CryptoKeyService } from './services/crypto-key.service';

export function fixture(account = 'account-a') {
  let saved: any[] = [];
  const storage = { create: async () => {}, get: async () => structuredClone(saved), set: async (_: string, value: any) => { saved = structuredClone(value); } };
  const native = { replaceQueue: async () => {}, consumeCompleted: async () => [], consumeDownloaded: async () => [] };
  const queue = new OutboxStorage(storage as any);
  const state = new (NotesService as any)({});
  let token: string | null = account;
  const keyText = account === 'account-a' ? '12345678901234567890123456789012' : 'abcdefghijklmnopqrstuvwxyz123456';
  const secure = { getItem: async (key: string) => key === 'ssToken' ? token : btoa(keyText) };
  const http = { post: jasmine.createSpy('post').and.returnValue(of({ note_ack_v1: true })) };
  const crypto = new CryptoKeyService();
  const api = new NotesApiV1Service(http as any, secure as any, crypto, queue, state);
  const worker = new SyncWorkerService(http as any, queue, {} as any, secure as any, state);
  spyOn<any>(worker, 'isOnline').and.resolveTo(true);
  return {queue, state, secure, http, crypto, api, worker, account, keyText, switchAccount: (value: string | null) => { token = value; }};
}
function pending(id: string): any {
  return { opId: id, type: 'upload', payload: { op_id: id, notes: [{id, text: 'synthetic cipher', last_modified: 1}] }, nextAt: 0, attempt: 0 };
}
const note: any = {id:'qa', text:'<p>private account A text</p>', title:'Synthetic', last_modified:10};

describe('Adversarial session and queue boundaries', () => {
  for (const resetOnly of [false, true]) it(resetOnly ? 'rejects a save crossing an outbox reset even before credentials are cleared' : 'rejects encryption completing after account replacement', async () => {
    const f = fixture(); let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    const gate = new Promise<void>(resolve => release = resolve);
    const encrypt = f.crypto.encryptText.bind(f.crypto); let first = true;
    spyOn(f.crypto, 'encryptText').and.callFake(async (text: string, aad: string) => {
      if (first) { first = false; entered(); await gate; }
      return encrypt(text, aad);
    });
    const saving = f.api.upload(0, [note], undefined, [], true);
    await started;
    await f.queue.clear();
    if (!resetOnly) f.switchAccount('account-b');
    release();
    await expectAsync(saving).toBeRejected();
    expect(await f.queue.getAll()).toEqual([]);
    expect(f.http.post).not.toHaveBeenCalled();
  });

  it('does not process old batch entries or send a new account queue under old headers', async () => {
    const f = fixture(); const response = new Subject<any>(); let entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    f.http.post.and.callFake(() => { if (f.http.post.calls.count() === 1) { entered(); return response; } return of({note_ack_v1:true}); });
    await f.queue.enqueue(pending('a-first')); await f.queue.enqueue(pending('a-second'));
    const syncing = f.worker.trySync(); await started;
    await f.queue.clear(); f.switchAccount('account-b'); await f.queue.enqueue(pending('b-only'));
    response.next({note_ack_v1:true}); response.complete(); await syncing;
    expect(f.http.post.calls.count()).toBe(1);
    expect((await f.queue.getAll()).map(item => item.opId)).toEqual(['b-only']);
  });


  it('makes a deletion durable before its first network request completes', async () => {
    const f = fixture(); const response = new Subject<any>(); let entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    f.http.post.and.callFake(() => { entered(); return response; });
    const deleting = f.api.deleteNotes(['qa-delete']); await started;
    const queued = await f.queue.getAll();
    expect(queued.length).toBe(1); expect(queued[0]?.type).toBe('delete');
    response.next({}); response.complete(); await deleting;
    expect(await f.queue.getAll()).toEqual([]);
  });

  it('does not restore an old deletion after account switching during a failed request', async () => {
    const f = fixture(); const response = new Subject<any>(); let entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    f.http.post.and.callFake(() => { entered(); return response; });
    const deleting = f.api.deleteNotes(['qa-delete']); await started;
    await f.queue.clear(); f.switchAccount('account-b');
    response.error({status:503});
    await expectAsync(deleting).toBeRejected(); expect(await f.queue.getAll()).toEqual([]);
  });

  it('does not enqueue a signed-out upload with a leftover encryption key', async () => {
    const f = fixture(); f.switchAccount(null);
    await expectAsync(f.api.upload(0,[note],undefined,[],true)).toBeRejected();
    expect(await f.queue.getAll()).toEqual([]);
  });
});

import { runNotesChaos } from './notes-chaos-harness';
describe('Encrypted multi-client chaos', () => {
  for (const seed of [91021,91022]) it('converges under failed requests, lost acknowledgements and deletions, seed '+seed, async () => {
    await runNotesChaos([fixture(),fixture(),fixture('account-b'),fixture('account-b')],seed);
  },120000);
});
