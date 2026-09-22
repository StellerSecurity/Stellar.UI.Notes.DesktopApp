import { HttpClient, HttpHeaders } from '@angular/common/http';
import { normalizeNoteSyncFlags } from '../utils/note-sync-normalize.util';
import { firstValueFrom, timeout } from 'rxjs';

/** Opt-in confirmation; legacy servers are verified through their existing download endpoint. */
export async function confirmUpload(http: HttpClient, base: string, headers: HttpHeaders, payload: any, response: any): Promise<void> {
  if (response?.note_ack_v1 === true) return;
  const sent = payload.notes ?? [];
  if (!sent.length) return;
  const result: any = await firstValueFrom(http.post(base + 'download',
    { since: 0, ids: sent.map((note: any) => note.id) }, { headers }).pipe(timeout(15000)));
  const saved = new Map((result?.notes ?? []).map((note: any) => [note.id, note]));
  for (const note of sent) {
    const server: any = saved.get(note.id);
    const sameVersion = server && Number(server.last_modified) === Number(note.last_modified);
    const sameContent = note.checksum_hmac && server?.checksum_hmac
      ? server?.checksum_hmac === note.checksum_hmac
      : server?.text === note.text && (server?.title ?? '') === (note.title ?? '');
    const normalized = normalizeNoteSyncFlags(server ?? {});
    const expected = normalizeNoteSyncFlags(note);
    const sameFlags = ['protected', 'auto_wipe', 'deleted', 'pinned', 'favorite']
      .every(field => !(field in note) || !!(normalized as any)[field] === !!(expected as any)[field]);
    const sameFolder = !('folder_id' in note) || (server?.folder_id ?? null) === (note.folder_id ?? null);
    if (!sameVersion || !sameContent || !sameFlags || !sameFolder) throw new Error('Note upload was not confirmed');
  }
}
