// services/notes-api-v1.service.ts — OFFLINE-FIRST (keeps your public methods)
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NoteV1 } from "../models/NoteV1";
import { Folder } from "../models/Folder";

import { CryptoKeyService } from "./crypto-key.service";
import { SecureStorageService } from "./secure-storage.service";
import { OutboxOp } from "../models/Sync";
import { OutboxStorage } from "./outbox-storage.service";

// ✅ Shared crypto helpers from NPM (wire format)
import { packCipherBlob, unpackCipherBlob } from '@stellarsecurity/stellar-crypto';
import { buildApiUrl, notes } from '../constants/api/product.api';
import { normalizeNoteSyncFlags, normalizeNoteSyncFlagsList } from '../utils/note-sync-normalize.util';
import { NotesService } from './notes.service';

@Injectable({ providedIn: 'root' })
export class NotesApiV1Service {
  private base = buildApiUrl(notes.controller);

  // legacy key (bruges kun af private helpers, hvis du stadig vil have dem)
  private OUTBOX_KEY = 'notes.sync.outbox.v1';

  constructor(
    private http: HttpClient,
    private secureStorageService: SecureStorageService,
    private crypto: CryptoKeyService,
    private outbox: OutboxStorage,
    private notesService: NotesService,
  ) {}


  private normalizeFolderId(folderId: any): string | null {
    return typeof folderId === 'string' && folderId.trim().length > 0 ? folderId.trim() : null;
  }

  private isCipherBlobString(value: any): boolean {
    return typeof value === 'string' && value.includes(':') && value.split(':').length >= 3;
  }

  private async encryptFolderName(folderName: string, folderId: string): Promise<string> {
    const normalizedName = typeof folderName === 'string' ? folderName.trim() : '';
    if (!normalizedName) {
      return '';
    }

    const encrypted = await this.crypto.encryptText(normalizedName, `${folderId}#folder-name`);
    return packCipherBlob(encrypted);
  }

  private async decryptFolderName(folderName: any, folderId: string): Promise<string> {
    const rawName = typeof folderName === 'string' ? folderName.trim() : '';
    if (!rawName) {
      return '';
    }

    if (!this.isCipherBlobString(rawName)) {
      return rawName;
    }

    try {
      return await this.crypto.decryptText(unpackCipherBlob(rawName), `${folderId}#folder-name`);
    } catch {
      return rawName;
    }
  }

  private async decryptLegacyNoteFolder(folderName: any, folderId: string, fallbackName = ''): Promise<string> {
    const rawName = typeof folderName === 'string' ? folderName.trim() : '';
    if (!rawName) {
      return fallbackName;
    }

    if (!this.isCipherBlobString(rawName)) {
      return rawName;
    }

    try {
      return await this.crypto.decryptText(unpackCipherBlob(rawName), `${folderId}#folder-name`);
    } catch {
      return fallbackName || rawName;
    }
  }

  // --------------------------------------------------
  // PUBLIC: upload
  // --------------------------------------------------
  async upload(
    sinceMs: number,
    notes: ReadonlyArray<NoteV1>,
    opId?: string,
    folders: ReadonlyArray<Folder> = []
  ): Promise<object> {
    const TOKEN = await this.secureStorageService.getItem("ssToken");
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    // 1) Load EAK → MK into CryptoKeyService (RAM) if we have it
    const eakB64 = await this.secureStorageService.getItem("ssEakB64");
    if (eakB64) {
      await this.crypto.importEAK(eakB64);
    }

    const rawFolders = Array.isArray(folders) ? folders : [];
    const normalizedFolders = this.notesService.dedupeFolders(
      rawFolders
        .map((folder: any) => {
          const normalizedId = this.normalizeFolderId(folder?.id);
          const fallbackId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : String(Date.now() + Math.random());

          return {
            id: normalizedId ?? fallbackId,
            name: typeof folder?.name === 'string' ? folder.name.trim() : '',
            last_modified: Number(folder?.last_modified ?? Date.now()),
            deleted: !!folder?.deleted,
          };
        })
        .filter((folder: any) => !!folder.name || !!folder.deleted)
    );

    const folderIdByName = new Map<string, string>();
    for (const folder of normalizedFolders) {
      const normalizedName = (folder?.name ?? '').trim().toLowerCase();
      if (normalizedName) {
        folderIdByName.set(normalizedName, folder.id);
      }
    }

    const encryptedFolders: Folder[] = [];
    for (const folder of normalizedFolders) {
      encryptedFolders.push({
        ...folder,
        name: folder.deleted ? '' : await this.encryptFolderName(folder.name, folder.id),
      });
    }

    // 2) Encrypt each note body + title + folder metadata via CryptoKeyService (MK in RAM)
    const encryptedNotes: NoteV1[] = [];
    for (const rawNote of this.notesService.dedupeNotes(normalizeNoteSyncFlagsList(notes) as any[])) {
      const n = normalizeNoteSyncFlags(rawNote);
      const encText  = await this.crypto.encryptText(n.text  ?? '', n.id);
      const encTitle = await this.crypto.encryptText(n.title ?? '', n.id + '#title');
      const normalizedFolderName = (n.folder ?? '').trim();
      const normalizedFolderId = this.normalizeFolderId((n as any)?.folder_id)
        ?? (normalizedFolderName ? (folderIdByName.get(normalizedFolderName.toLowerCase()) ?? null) : null);

      encryptedNotes.push({
        ...n,
        text: packCipherBlob(encText),
        title: packCipherBlob(encTitle),
        folder: normalizedFolderName && normalizedFolderId
          ? await this.encryptFolderName(normalizedFolderName, normalizedFolderId)
          : '',
        folder_id: normalizedFolderId,
      });
    }

    const payload = {
      op_id: opId ?? crypto?.randomUUID?.() ?? String(Date.now()),
      since: sinceMs || 0,
      notes: encryptedNotes,
      folders: encryptedFolders,
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
  ): Promise<{ notes: NoteV1[]; folders: Folder[]; has_more?: boolean; watermark?: number }> {
    const TOKEN = await this.secureStorageService.getItem('ssToken');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    if (!navigator.onLine) {
      return { notes: [], folders: [], has_more: false, watermark: sinceMs || 0 };
    }

    const response = await firstValueFrom(
      this.http.post<{ notes: NoteV1[]; folders?: Folder[]; has_more?: boolean; watermark?: number }>(
        `${this.base}/download`,
        { since: sinceMs || 0, limit },
        { headers }
      )
    );

    const decryptedFolders: Folder[] = [];
    for (const folder of this.notesService.dedupeFolders(Array.isArray(response?.folders) ? response.folders : [])) {
      const folderId = this.normalizeFolderId((folder as any)?.id) ?? '';
      const decryptedName = folder.deleted
        ? ''
        : await this.decryptFolderName(folder?.name, folderId);

      if (!folderId && !decryptedName) {
        continue;
      }

      decryptedFolders.push({
        id: folderId,
        name: decryptedName,
        last_modified: Number(folder?.last_modified ?? 0),
        deleted: !!folder?.deleted,
      });
    }

    const folderNameById = new Map<string, string>();
    for (const folder of decryptedFolders) {
      const folderId = this.normalizeFolderId(folder.id);
      if (folderId && !folder.deleted) {
        folderNameById.set(folderId, folder.name ?? '');
      }
    }

    const decryptedNotes: NoteV1[] = [];
    for (const rawNote of this.notesService.dedupeNotes(normalizeNoteSyncFlagsList(response?.notes) as any[])) {
      const note = normalizeNoteSyncFlags(rawNote);
      const noteFolderId = this.normalizeFolderId((note as any)?.folder_id);
      const resolvedFolderName = noteFolderId ? (folderNameById.get(noteFolderId) ?? '') : '';
      const decryptedFolderName = await this.decryptLegacyNoteFolder(note?.folder, noteFolderId ?? `${note.id}#folder`, resolvedFolderName);

      decryptedNotes.push({
        ...note,
        folder: decryptedFolderName || resolvedFolderName || '',
        folder_id: noteFolderId,
      });
    }

    return {
      ...response,
      notes: decryptedNotes,
      folders: decryptedFolders,
    };
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

    const note = await firstValueFrom(
      this.http.post<NoteV1>(`${this.base}/find`, { id }, { headers })
    );

    return normalizeNoteSyncFlags(note);
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
