import { from } from 'rxjs';
import { decryptTextWithMK, unpackCipherBlob } from '@stellarsecurity/stellar-crypto';

// Deterministic fault injection: no real HTTP requests, credentials or user data.
export async function runNotesChaos(clients: any[], seed: number, rounds = 200): Promise<void> {
  let randomState = seed;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState; };
  const servers = new Map<string, Map<string, any>>();
  const expected = new Map<string, Map<string, any>>();
  const attempts = new Map<string, number>();
  const accepted = new Set<string>();
  let version = 0, requests = 0, failures = 0, lostReplies = 0, conflictReplies = 0;
  const table = (collection: Map<string, Map<string, any>>, account: string) => {
    if (!collection.has(account)) collection.set(account, new Map());
    return collection.get(account)!;
  };
  for (const client of clients) {
    client.http.post.and.callFake((url: string, payload: any, options: any) => from((async () => {
      await Promise.resolve();
      const account = options.headers.get('Authorization')?.replace(/^Bearer /, '');
      expect(account).withContext('request belongs to the originating client').toBe(client.account);
      const server = table(servers, account);
      if (url.endsWith('download')) return {notes: structuredClone([...server.values()]), folders: []};
      requests++;
      const identity = account + ':' + (payload.op_id ?? JSON.stringify(payload.deleted_ids));
      const attempt = (attempts.get(identity) ?? 0) + 1; attempts.set(identity, attempt);
      if (accepted.has(identity)) return {note_ack_v1:true};
      const ordinal = Number(payload.op_id?.split('-').pop() ?? payload.deleted_ids?.[0]?.split('-').pop() ?? 1);
      if (attempt === 1 && ordinal % 11 === 0) { failures++; throw {status:503}; }
      if (url.endsWith('sync-plan')) {
        for (const id of payload.deleted_ids ?? []) server.set(id,{id,deleted:true,last_modified:1e12});
      } else {
        for (const note of payload.notes) {
          const previous = server.get(note.id);
          if (previous?.deleted || Number(previous?.last_modified ?? 0) > note.last_modified) {
            conflictReplies++; throw {status:409};
          }
          server.set(note.id, structuredClone(note));
        }
      }
      accepted.add(identity);
      if (attempt === 1 && ordinal % 7 === 0) { lostReplies++; throw {status:0}; }
      return {note_ack_v1:true};
    })()));
  }
  for (let round = 0; round < rounds; round++) {
    await Promise.all(clients.map(async (client, index) => {
      const choice = random() >>> 8, id = 'note-' + (choice % 24), current = table(expected, client.account);
      const sequence = ++version;
      if (choice % 13 === 0 && choice % 24 >= 16) {
        current.set(id, {id,deleted:true});
        await client.queue.enqueue({opId:'delete-'+sequence,type:'delete',payload:{op_id:'delete-'+sequence,notes:[],deleted_ids:[id]},attempt:0,nextAt:0});
      } else {
        const note = {id, title:client.account+' QA '+sequence,
          text:'<p>'+client.account+' seed '+seed+' change '+sequence+' æøå 😀</p><p>test</p><p><br></p><p>end</p>',
          last_modified:sequence, favorite:!!(choice & 32), pinned:!!(choice & 64), auto_wipe:false};
        if (!current.get(id)?.deleted) current.set(id, note);
        await (client.api as any).upload(0,[note],'op-'+sequence,[],true,true);
      }
      // Offline clients accumulate durable changes; reconnect periodically.
      if (round % 9 === index % 9) await Promise.all([client.worker.trySync(),client.worker.trySync(),client.worker.trySync()]);
    }));
  }
  for (let pass = 0; pass < 30; pass++) {
    let active = 0;
    await Promise.all(clients.map(async client => {
      for (const op of await client.queue.getAll()) if (!op.conflict) {
        active++; await client.queue.update(op.opId,(item:any)=>({...item,nextAt:0}));
      }
      await client.worker.trySync();
    }));
    if (!active) break;
  }
  for (const client of clients) {
    const queued = await client.queue.getAll();
    expect(queued.every((op:any)=>op.conflict)).withContext('all transient failures recover; conflicts stay durable').toBeTrue();
    const download = await client.api.download(0);
    const observed = new Map<string,any>(download.notes.map((note:any)=>[note.id,note]));
    const model = table(expected,client.account);
    expect(observed.size).toBe(model.size);
    const key = Uint8Array.from(client.keyText,(char:any)=>char.charCodeAt(0));
    for (const [id,note] of model) {
      const actual = observed.get(id);
      expect(actual).withContext('seed '+seed+' '+client.account+' '+id).toBeDefined();
      if (!actual) continue;
      if (note.deleted) { expect(actual.deleted).toBeTrue(); continue; }
      expect(actual.last_modified).toBe(note.last_modified);
      expect(actual.favorite).toBe(note.favorite); expect(actual.pinned).toBe(note.pinned);
      expect(await decryptTextWithMK(key,{...unpackCipherBlob(actual.text),v:1,aad_b64:btoa(id)})).toBe(note.text);
      expect(await decryptTextWithMK(key,{...unpackCipherBlob(actual.title),v:1,aad_b64:btoa(id+'#title')})).toBe(note.title);
    }
  }
  expect(failures).toBeGreaterThan(0); expect(lostReplies).toBeGreaterThan(0); expect(conflictReplies).toBeGreaterThan(0);
  console.log('CHAOS',JSON.stringify({seed,clients:clients.length,changes:version,requests,failures,lostReplies,conflictReplies}));
}
