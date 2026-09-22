// services/sync-worker.service.ts
import { Injectable, NgZone } from '@angular/core';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { OutboxStorage } from './outbox-storage.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {SecureStorageService} from "./secure-storage.service";
import { firstValueFrom, timeout } from 'rxjs';
import { confirmUpload } from './upload-confirmation';
import { buildApiUrl, notes } from '../constants/api/product.api';
import { NotesService } from "./notes.service";

const MAX_ATTEMPT = 8;

@Injectable({ providedIn: 'root' })
export class SyncWorkerService {
  private syncing = false;
  private started = false;

  private base = buildApiUrl(notes.controller);

  constructor(
    private http: HttpClient,
    private outbox: OutboxStorage,
    private zone: NgZone,
    private secure: SecureStorageService,
    private notesService: NotesService
  ) {}

  init() {
    if (this.started) return;
    this.started = true;
    // Check the durable queue locally; no HTTP call when no upload is due.
    setInterval(() => this.trySync(), 1_000);

    Network.addListener('networkStatusChange', () => this.trySync());
    App.addListener('appStateChange', (s) => { if (s.isActive) this.trySync(); });

    // Kick off once on startup
    this.trySync();
  }

  private async isOnline(): Promise<boolean> {
    const st = await Network.getStatus();
    return st.connected ?? navigator.onLine;
  }

  private backoffMs(attempt: number): number {
    // 1s, 2s, 4s, 8s, ... cap at ~60s
    return Math.min(60_000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  }

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.secure.getItem('ssToken');
    let h = new HttpHeaders();
    if (token) h = h.set('Authorization', `Bearer ${token}`);
    return h;
  }

  private sanitizeUploadPayload(payload: any): any {
    const notes = this.notesService.dedupeNotes(Array.isArray(payload?.notes) ? payload.notes : []);
    const folders = this.notesService.dedupeFolders(Array.isArray(payload?.folders) ? payload.folders : []);

    return {
      ...payload,
      notes,
      folders,
    };
  }

  private async isCurrentSession(headers: HttpHeaders, generation: number): Promise<boolean> {
    const token = await this.secure.getItem('ssToken');
    return !!token && headers.get('Authorization') === `Bearer ${token}` && generation === this.outbox.generation;
  }

  async trySync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    const generation = this.outbox.generation;
    try {
      if (!(await this.isOnline())) return;
      const token = await this.secure.getItem('ssToken');
      if (!token) return;
      const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
      const attempted = new Set<string>();
      // Read again after every request: queued snapshots may have been superseded.
      for (let count = 0; count < 50; count++) {
        const op = (await this.outbox.peekBatch(50, Date.now())).find(item => !item.conflict && !attempted.has(item.opId));
        if (!op) break;
        if (!await this.isCurrentSession(headers, generation)) return;
        attempted.add(op.opId);
        try {
          if (op.type === 'upload') {
            const payload = { ...this.sanitizeUploadPayload(op.payload), require_note_ack: true };
            const response = await firstValueFrom(this.http.post(`${this.base}upload`, payload, { headers }).pipe(timeout(15000)));
            await confirmUpload(this.http, this.base, headers, payload, response);
          } else if (op.type === 'delete') {
            await firstValueFrom(this.http.post(`${this.base}sync-plan`, { deleted_ids: op.payload.deleted_ids ?? [], notes: [] }, { headers }).pipe(timeout(15000)));
          } else {
            throw new Error('Unknown queued operation');
          }
          if (!await this.isCurrentSession(headers, generation)) return;
          await this.outbox.drop([op.opId]);
          for (const note of op.payload.notes ?? []) {
            const pending = this.notesService.getPendingMutation(note.id);
            if (pending && pending.type !== 'delete' && pending.localUpdatedAt <= Number(note.last_modified)) this.notesService.clearPendingMutation(note.id);
          }
          if (!(await this.outbox.getAll()).length) this.notesService.syncNeedsAttention$.next(false);
        } catch (error: any) {
          if (!await this.isCurrentSession(headers, generation)) return;
          this.notesService.syncNeedsAttention$.next(true);
          await this.outbox.update(op.opId, item => {
            const attempt = (item.attempt ?? 0) + 1;
            return { ...item, conflict: item.conflict || error?.status === 409 || error?.message === 'Note upload was not confirmed', attempt, nextAt: Date.now() + (attempt > MAX_ATTEMPT ? 300000 : this.backoffMs(attempt)) };
          });
        }
      }
    } catch {
      // Storage/network failures leave the durable queue intact for the next run.
    } finally {
      this.syncing = false;
    }
  }
}
