// services/notes-api-v1.service.ts — OFFLINE-FIRST (keeps your public methods)
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NoteV1 } from "../models/NoteV1";

// import { CryptoKeyService } from "./crypto-key.service";
import { SecureStorageService } from "./secure-storage.service";
import { OutboxOp } from "../models/Sync";
import { OutboxStorage } from "./outbox-storage.service";

// ✅ Shared crypto helpers from NPM (wire format)
import { packCipherBlob } from '@stellarsecurity/stellar-crypto';
import { CryptoKeyService } from './crypto-key.service';

@Injectable({ providedIn: 'root' })
export class NotesApiV1Service {
  private base =
    'https://stellarprivatenotesuiappapiprod-dmefgreabahpcsbm.swedencentral-01.azurewebsites.net/api/v1/notescontroller/';

  // legacy key (bruges kun af private helpers, hvis du stadig vil have dem)
  private OUTBOX_KEY = 'notes.sync.outbox.v1';

  constructor(
    private http: HttpClient,
    private secureStorageService: SecureStorageService,
    private crypto: CryptoKeyService,
    private outbox: OutboxStorage,
  ) {}

  // --------------------------------------------------
  // PUBLIC: upload
  // --------------------------------------------------
  async upload(
    sinceMs: number,
    notes: ReadonlyArray<NoteV1>,
    opId?: string
  ): Promise<object> {
    const TOKEN = await this.secureStorageService.getItem("ssToken");
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    // 1) Load EAK → MK into CryptoKeyService (RAM) if we have it
    const eakB64 = await this.secureStorageService.getItem("ssEakB64");
    if (eakB64) {
      await this.crypto.importEAK(eakB64);
    }

    // 2) Encrypt each note body + title via CryptoKeyService (MK in RAM)
    const encryptedNotes: NoteV1[] = [];
    for (const n of notes) {
      const encText  = await this.crypto.encryptText(n.text  ?? '', n.id);
      const encTitle = await this.crypto.encryptText(n.title ?? '', n.id + '#title');

      // 3) Pack IV||CT med NPM helper (wire format til backend)
      encryptedNotes.push({
        ...n,
        text: packCipherBlob(encText),
        title: packCipherBlob(encTitle),
      });
    }

    const payload = {
      op_id: opId ?? crypto?.randomUUID?.() ?? String(Date.now()),
      since: sinceMs || 0,
      notes: encryptedNotes,
    } as any;

    // Offline → queue i Outbox
    if (!navigator.onLine) {
      await this.outbox.enqueue(<OutboxOp><unknown>{
        opId: payload.op_id,
        type: 'upload',
        payload,
        attempt: 0,
        nextAt: Date.now(),
      });
      return { queued: true, reason: 'offline' };
    }

    try {
      const res = await firstValueFrom(
        this.http.post<object>(`${this.base}upload`, payload, { headers })
      );
      return res;
    } catch (e) {
      await this.outbox.enqueue(<OutboxOp>{
        opId: payload.op_id,
        type: 'upload',
        payload,
        attempt: 0,
        nextAt: Date.now(),
      });
      return { queued: true, reason: 'network_error' };
    }
  }

  // --------------------------------------------------
  // PUBLIC: download
  // --------------------------------------------------
  async download(
    sinceMs: number,
    limit = 1000
  ): Promise<{ notes: NoteV1[]; has_more?: boolean; watermark?: number }> {
    const TOKEN = await this.secureStorageService.getItem('ssToken');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    if (!navigator.onLine) {
      return { notes: [], has_more: false, watermark: sinceMs || 0 };
    }

    return firstValueFrom(
      this.http.post<{ notes: NoteV1[]; has_more?: boolean; watermark?: number }>(
        `${this.base}download`,
        { since: sinceMs || 0, limit },
        { headers }
      )
    );
  }

  // --------------------------------------------------
  // PUBLIC: find
  // --------------------------------------------------
  async find(id: string): Promise<NoteV1> {
    const TOKEN = await this.secureStorageService.getItem("ssToken");
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    if (!navigator.onLine) {
      throw new Error('offline');
    }

    return firstValueFrom(
      this.http.post<NoteV1>(`${this.base}/find`, { id }, { headers })
    );
  }

  // --------------------------------------------------
  // PUBLIC: deleteNotes
  // --------------------------------------------------
  async deleteNotes(deletedIds: string[]) {
    const TOKEN = await this.secureStorageService.getItem("ssToken");
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    const payload = {
      op_id: crypto?.randomUUID?.() ?? 'del-' + Date.now(),
      since: 0,
      notes: [],
      deleted_ids: deletedIds ?? [],
    } as any;

    if (!navigator.onLine) {
      await this.outbox.enqueue(<OutboxOp>{
        opId: payload.op_id,
        type: 'delete',
        payload,
        attempt: 0,
        nextAt: Date.now(),
      });
      return { queued: true, reason: 'offline' } as any;
    }

    try {
      return await firstValueFrom(
        this.http.post(
          `${this.base}sync-plan`,
          { deleted_ids: deletedIds, notes: [] },
          { headers }
        )
      );
    } catch (e) {
      await this.outbox.enqueue(<OutboxOp>{
        opId: payload.op_id,
        type: 'delete',
        payload,
        attempt: 0,
        nextAt: Date.now(),
      });
      return { queued: true, reason: 'network_error' } as any;
    }
  }

  // --------------------------------------------------
  // PRIVATE legacy helpers (kan fjernes hvis du kun bruger OutboxStorage)
  // --------------------------------------------------
  private async enqueuePayload(p: any): Promise<void> {
    const raw = (await this.secureStorageService.getItem(this.OUTBOX_KEY)) ?? '[]';
    let queue: any[] = [];
    try { queue = JSON.parse(raw); } catch { queue = []; }
    queue.push(p);
    await this.secureStorageService.setItem(this.OUTBOX_KEY, JSON.stringify(queue));
  }

  private async drainOutbox(headers: HttpHeaders): Promise<void> {
    if (!navigator.onLine) return;
    const raw = (await this.secureStorageService.getItem(this.OUTBOX_KEY)) ?? '[]';
    let queue: any[] = [];
    try { queue = JSON.parse(raw); } catch { queue = []; }
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remain: any[] = [];
    for (const payload of queue) {
      try {
        const isDeleteOnly =
          Array.isArray(payload.deleted_ids) && (payload.notes?.length ?? 0) === 0;

        if (isDeleteOnly) {
          await firstValueFrom(
            this.http.post(
              `${this.base}/sync-plan`,
              { deleted_ids: payload.deleted_ids, notes: [] },
              { headers }
            )
          );
        } else {
          await firstValueFrom(
            this.http.post(`${this.base}/upload`, payload, { headers })
          );
        }
      } catch {
        remain.push(payload);
        break;
      }
    }

    await this.secureStorageService.setItem(this.OUTBOX_KEY, JSON.stringify(remain));
  }
}
