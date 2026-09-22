import { unwrapLocalAppKey } from '../utils/local-app-key';
import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { OutboxStorage } from './outbox-storage.service';
import { NotesService } from './notes.service';
import { SecureStorageService } from './secure-storage.service';
import { CryptoKeyService } from './crypto-key.service';
import { CryptoService } from './crypto.service';
import { packCipherBlob, unpackCipherBlob } from '@stellarsecurity/stellar-crypto';
import { buildApiUrl, notes } from '../constants/api/product.api';

export function conflictPreview(note: any): string {
  if (!note || note.deleted) return 'Deleted on the other device';
  if (note.protected) return 'Password-protected note (content hidden)';
  const text = `${note.title ?? ''}\n${note.text ?? ''}`.slice(0, 400);
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Conflicts stay in the encrypted outbox until the user explicitly chooses. */
@Injectable({ providedIn: 'root' })
export class NoteConflictService {
  private started = false;
  private busy = false;
  private snoozed = new Map<string, number>();
  private snoozedNotes = new Map<string, number>();
  private base = buildApiUrl(notes.controller);
  constructor(private outbox: OutboxStorage, private state: NotesService,
    private secure: SecureStorageService, private keys: CryptoKeyService,
    private localCrypto: CryptoService, private http: HttpClient, private alerts: AlertController) {}

  init(): void {
    if (this.started) return;
    this.started = true;
    setInterval(() => { void this.check(); }, 2000);
  }

  private readLocal(): any[] {
    const raw = this.state.getNotes();
    const plain = this.state.appHasPasswordChallenge()
      ? this.localCrypto.decrypt(raw, this.state.getNotesAppPassword()) : raw;
    const parsed = JSON.parse(plain || '[]');
    if (!Array.isArray(parsed)) throw new Error('Invalid note storage');
    return parsed;
  }

  private async decode(note: any): Promise<any> {
    if (!note || note.deleted) return note;
    let folder = typeof note.folder === 'string' ? note.folder : '';
    let folderBlob: ReturnType<typeof unpackCipherBlob> | undefined;
    try { if (folder) folderBlob = unpackCipherBlob(folder); } catch { /* Legacy plain folder name. */ }
    if (folderBlob) {
      folder = await this.keys.decryptText(folderBlob, `${note.folder_id || note.id + '#folder'}#folder-name`);
    }
    return { ...note, folder, text: await this.keys.decryptText(unpackCipherBlob(note.text), note.id),
      title: note.title ? await this.keys.decryptText(unpackCipherBlob(note.title), note.id + '#title') : '' };
  }

  async check(): Promise<void> {
    if (this.busy || document.hidden || !navigator.onLine || this.state.shouldAskForPassword()) return;
    this.busy = true;
    try {
      const token = await this.secure.getItem('ssToken');
      if (!token) return;
      const queue = await this.outbox.getAll();
      const op: any = queue.filter((item: any) => item.conflict).sort((a, b) => Math.max(...b.payload.notes.map(n => Number(n.last_modified ?? 0))) - Math.max(...a.payload.notes.map(n => Number(n.last_modified ?? 0)))).find((item: any) => (this.snoozed.get(item.opId) ?? 0) <= Date.now() && item.payload.notes.every((n: any) => (this.snoozedNotes.get(n.id) ?? 0) <= Date.now()));
      if (!op) return;
      // Only the latest pending edit should be presented. Older conflicting snapshots
      // remain durable until the user resolves the newest one.
      const snapshot = JSON.stringify(op.payload);
      const observedLocal = new Map(this.readLocal().map(n => [n.id, JSON.stringify(n)]));
      const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
      const result: any = await firstValueFrom(this.http.post(this.base + 'download',
        { since: 0, ids: op.payload.notes.map((n: any) => n.id) }, { headers }).pipe(timeout(15000)));
      if (!Array.isArray(result?.notes)) throw new Error('Invalid conflict response');
      let eak = await this.secure.getItem('ssEakB64');
      if (!eak && this.state.appHasPasswordChallenge()) {
        const wrapped = await this.secure.getItem('ssEakB64_Encrypted');
        if (wrapped) eak = await unwrapLocalAppKey(wrapped, this.state.getNotesAppPassword(), (v,p) => this.localCrypto.decrypt(v,p));
      }
      if (eak) await this.keys.importEAK(eak);
      const choices: Array<{ sent: any; remote: any; local: any; choice: string }> = [];
      for (const sent of op.payload.notes) {
        const remote = (result.notes ?? []).find((n: any) => n.id === sent.id);
        if (remote && remote.text === sent.text && remote.title === sent.title && Number(remote.last_modified) === Number(sent.last_modified)) continue;
        const local = await this.decode(sent);
        const decodedRemote = await this.decode(remote);
        if (token !== await this.secure.getItem('ssToken') || this.state.shouldAskForPassword()) return;
        const alert = await this.alerts.create({
          header: 'Choose note version',
          message: `<b>This device</b><br>${conflictPreview(local)}<br><br><b>Other device</b><br>${conflictPreview(decodedRemote)}`,
          inputs: [
            { type: 'radio', label: remote?.deleted ? 'Restore this version as a new note' : 'Keep this device’s version', value: 'local' },
            { type: 'radio', label: remote?.deleted ? 'Keep the note deleted' : 'Keep the other device’s version', value: 'server' }
          ],
          buttons: [{ text: 'Later', role: 'cancel' }, { text: 'Use selected version', role: 'confirm', handler: value => value === 'local' || value === 'server' }],
          backdropDismiss: false,
        });
        await alert.present();
        const watch = setInterval(() => {
          void this.secure.getItem('ssToken').then(current => {
            if (current !== token || this.state.shouldAskForPassword() || document.hidden) void alert.dismiss(undefined, 'cancel');
          }).catch(() => { void alert.dismiss(undefined, 'cancel'); });
        }, 500);
        let answer: any;
        try { answer = await alert.onDidDismiss(); } finally { clearInterval(watch); }
        const choice = answer.data?.values;
        if (answer.role !== 'confirm' || !['local', 'server'].includes(choice)) {
          this.snoozed.set(op.opId, Date.now() + 300000);
          for (const n of op.payload.notes) this.snoozedNotes.set(n.id, Date.now() + 300000);
          return;
        }
        choices.push({ sent, remote, local, choice });
      }
      if (token !== await this.secure.getItem('ssToken') || this.state.shouldAskForPassword()) return;
      const currentQueue = await this.outbox.getAll();
      const currentOp = currentQueue.find(item => item.opId === op.opId);
      if (!currentOp || JSON.stringify(currentOp.payload) !== snapshot) return;
      // Never discard writing done while the selection dialog was open.
      const currentNotes = this.readLocal();
      for (const { sent } of choices) {
        if (currentQueue.some(item => item.payload.deleted_ids?.includes(sent.id)) || JSON.stringify(currentNotes.find(n => n.id === sent.id)) !== observedLocal.get(sent.id) ||
            currentQueue.some(item => item.opId !== op.opId && (item.payload.notes ?? []).some(n => n.id === sent.id && Number(n.last_modified) > Number(sent.last_modified)))) {
          this.snoozed.set(op.opId, Date.now() + 300000);
          for (const n of op.payload.notes) this.snoozedNotes.set(n.id, Date.now() + 300000);
          return;
        }
      }
      const replacements: any[] = [];
      const selected: any[] = [];
      for (const { sent, remote, local, choice } of choices) {
        if (choice === 'server') {
          selected.push(remote && !remote.deleted ? { ...await this.decode(remote), base_version: Number(remote.last_modified) } : { id: sent.id, deleted: true });
          continue;
        }
        const id = remote?.deleted ? crypto.randomUUID() : sent.id;
        const version = Math.max(Date.now(), Number(sent.last_modified) + 1, Number(remote?.last_modified ?? 0) + 1);
        const wire: any = { ...sent, id, last_modified: version, base_version: remote?.deleted ? 0 : Number(remote?.last_modified ?? 0), edit_session: sent.edit_session ?? crypto.randomUUID() };
        delete wire.checksum_hmac; // Prior keyed checksum includes the prior version.
        if (id !== sent.id) {
          wire.text = packCipherBlob(await this.keys.encryptText(local.text, id));
          wire.title = packCipherBlob(await this.keys.encryptText(local.title ?? '', id + '#title'));
          selected.push({ id: sent.id, deleted: true });
        }
        replacements.push(wire);
        selected.push({ ...local, id, last_modified: version, base_version: wire.base_version });
      }
      if (token !== await this.secure.getItem('ssToken') || this.state.shouldAskForPassword()) return;
      // Persist the selected upload before removing any conflict. A failure leaves
      // the original encrypted operation available for a later attempt.
      let stagedId: string | null = null;
      if (replacements.length) {
        const opId = crypto.randomUUID();
        stagedId = opId;
        await this.outbox.enqueue({ opId, type: 'upload', payload: { ...op.payload, op_id: opId, notes: replacements, folders: [], require_note_ack: true }, conflict: true, attempt: 0, nextAt: Number.MAX_SAFE_INTEGER });
      }
      if (token !== await this.secure.getItem('ssToken')) {
        if (stagedId) await this.outbox.drop([stagedId]);
        return;
      }
      const latest = this.readLocal();
      for (const { sent } of choices) {
        if (JSON.stringify(latest.find(n => n.id === sent.id)) !== observedLocal.get(sent.id)) {
          if (stagedId) await this.outbox.drop([stagedId]);
          return;
        }
      }
      const map = new Map(latest.map(n => [n.id, n]));
      for (const n of selected) { if (n.deleted) map.delete(n.id); else map.set(n.id, n); }
      const serialized = JSON.stringify(Array.from(map.values()));
      this.state.setNotes(this.state.appHasPasswordChallenge() ? this.localCrypto.encrypt(serialized, this.state.getNotesAppPassword()) : serialized);
      await this.state.flushPersistence();
      const chosenVersions: Record<string, number> = {};
      for (const n of op.payload.notes) chosenVersions[n.id] = Number(n.last_modified);
      await this.outbox.discardChosenVersions(chosenVersions);
      if (token !== await this.secure.getItem('ssToken')) return;
      if (stagedId) await this.outbox.update(stagedId, item => ({ ...item, conflict: false, nextAt: Date.now() }));
      for (const { sent } of choices) {
        const pending = this.state.getPendingMutation(sent.id);
        if (pending && pending.localUpdatedAt <= Number(sent.last_modified)) this.state.clearPendingMutation(sent.id);
      }
      this.state.setNoteIsUpdatedSubject(true);
      this.state.syncNeedsAttention$.next((await this.outbox.getAll()).length > 0);
      window.dispatchEvent(new CustomEvent('stellar:note-conflict-resolved', { detail: { ids: choices.map(item => item.sent.id) } }));
      window.dispatchEvent(new Event('stellar:notes-changed'));
    } catch {
      // Authentication, decryption, network and persistence failures retain the conflict.
    } finally { this.busy = false; }
  }
}
