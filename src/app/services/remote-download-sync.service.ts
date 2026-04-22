import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { App } from '@capacitor/app';
import { CryptoService } from './crypto.service';
import { NotesService } from './notes.service';
import { NotesApiV1Service } from './notes-api-v1.service';
import { SecureStorageService } from './secure-storage.service';
import { DataService } from './data.service';
import { AuthService } from './auth.service';
import { Folder } from '../models/Folder';
import { NoteV1 } from '../models/NoteV1';
import { decryptTextWithMK, unpackCipherBlob } from '@stellarsecurity/stellar-crypto';

@Injectable({ providedIn: 'root' })
export class RemoteDownloadSyncService {
  private static readonly POLL_MS = 30000;

  private started = false;
  private pollTimer: any = null;
  private inFlight: Promise<boolean> | null = null;
  private syncAppliedSubject = new BehaviorSubject<number>(0);
  public readonly syncApplied$ = this.syncAppliedSubject.asObservable();

  constructor(
    private notesApi: NotesApiV1Service,
    private notesService: NotesService,
    private cryptoService: CryptoService,
    private secureStorage: SecureStorageService,
    private dataService: DataService,
    private authService: AuthService,
    private zone: NgZone,
  ) {}

  init(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.startTimer();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }

    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void this.requestImmediateSync('resume');
      }
    });

    void this.requestImmediateSync('startup');
  }

  async requestImmediateSync(reason: 'startup' | 'resume' | 'online' | 'manual' = 'manual'): Promise<boolean> {
    void reason;

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private startTimer(): void {
    if (this.pollTimer != null) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.requestImmediateSync('manual');
    }, RemoteDownloadSyncService.POLL_MS);
  }

  private handleOnline = (): void => {
    void this.requestImmediateSync('online');
  };

  private handleOffline = (): void => {
    if (this.authService.isLoggedIn) {
      this.dataService.setForceDownloadOnHome(true);
    }
  };

  private hasInternetConnection(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  private b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  private normalizeFolderId(folderId: any): string | null {
    return typeof folderId === 'string' && folderId.trim().length > 0 ? folderId.trim() : null;
  }

  private async getMkRaw(): Promise<Uint8Array | null> {
    try {
      if (!this.notesService.appHasPasswordChallenge()) {
        const eakB64 = await this.secureStorage.getItem('ssEakB64');
        return eakB64 ? this.b64ToBytes(eakB64) : null;
      }

      const enc = await this.secureStorage.getItem('ssEakB64_Encrypted');
      const appPass = this.notesService.getNotesAppPassword();
      if (!enc || !appPass) {
        return null;
      }

      const decrypted = this.cryptoService.decrypt(enc, appPass) as string;
      return decrypted ? this.b64ToBytes(decrypted) : null;
    } catch {
      return null;
    }
  }

  private getStoredNotes(password: string = ''): NoteV1[] {
    try {
      const rawNotes = this.notesService.getNotes();
      const decodedNotes = this.notesService.appHasPasswordChallenge()
        ? this.cryptoService.decrypt(rawNotes, password || this.notesService.getNotesAppPassword())
        : rawNotes;
      const parsedNotes = decodedNotes ? JSON.parse(decodedNotes) : [];
      return this.notesService.dedupeNotes(Array.isArray(parsedNotes) ? parsedNotes : []);
    } catch {
      return [];
    }
  }

  private getStoredFolders(password: string = ''): Folder[] {
    try {
      const rawFolders = this.notesService.getFolders();
      const decodedFolders = this.notesService.appHasPasswordChallenge()
        ? this.cryptoService.decrypt(rawFolders, password || this.notesService.getNotesAppPassword())
        : rawFolders;
      const parsedFolders = decodedFolders ? JSON.parse(decodedFolders) : [];
      return this.notesService.dedupeFolders(Array.isArray(parsedFolders) ? parsedFolders : []);
    } catch {
      return [];
    }
  }

  private async performSync(): Promise<boolean> {
    if (!this.authService.isLoggedIn) {
      this.dataService.setForceDownloadOnHome(false);
      return false;
    }

    if (!this.hasInternetConnection()) {
      this.dataService.setForceDownloadOnHome(true);
      return false;
    }

    if (this.notesService.shouldAskForPassword()) {
      this.dataService.setForceDownloadOnHome(true);
      return false;
    }

    const mkRaw = await this.getMkRaw();
    if (!mkRaw) {
      this.dataService.setForceDownloadOnHome(true);
      return false;
    }

    try {
      const res = await this.notesApi.download(0);
      const serverNotes = this.notesService.dedupeNotes(Array.isArray((res as any)?.notes) ? (res as any).notes : []);
      const serverFolders = this.notesService.dedupeFolders(Array.isArray((res as any)?.folders) ? (res as any).folders : []);
      const decryptedFolderNameById = new Map<string, string>();

      for (const folder of serverFolders) {
        const folderId = this.normalizeFolderId((folder as any)?.id);
        if (!folderId) {
          continue;
        }

        let decryptedName = folder?.deleted ? '' : String(folder?.name ?? '').trim();
        if (!folder?.deleted && decryptedName) {
          try {
            const blobName = unpackCipherBlob(decryptedName);
            decryptedName = await decryptTextWithMK(mkRaw, {
              ...blobName,
              v: 1,
              aad_b64: btoa(folderId + '#folder-name'),
            });
          } catch {
            decryptedName = String(folder?.name ?? '').trim();
          }
        }

        decryptedFolderNameById.set(folderId, decryptedName);
      }

      const appPassword = this.notesService.getNotesAppPassword();
      const localNotes = this.getStoredNotes(appPassword).map((note: any) => ({
        ...note,
        favorite: !!note?.favorite,
        pinned: !!note?.pinned,
        folder: (note?.folder ?? '').trim(),
        folder_id: this.normalizeFolderId((note as any)?.folder_id),
      }));

      const map = new Map<string, any>(localNotes.map((n: any) => [n.id, n]));

      for (const s of serverNotes) {
        const local = map.get(s.id);

        if (s.deleted) {
          if (!local || (s.last_modified ?? 0) >= (local?.last_modified ?? 0)) {
            map.delete(s.id);
          }
          this.notesService.reconcileServerConfirmation(s);
          continue;
        }

        if (this.notesService.shouldIgnoreServerNote(s)) {
          continue;
        }

        const blobText = unpackCipherBlob(s.text);
        const decryptedText = await decryptTextWithMK(mkRaw, {
          ...blobText,
          v: 1,
          aad_b64: btoa(s.id),
        });

        let decryptedTitle = '';
        if (typeof s.title === 'string' && s.title.length > 0) {
          const blobTitle = unpackCipherBlob(s.title);
          decryptedTitle = await decryptTextWithMK(mkRaw, {
            ...blobTitle,
            v: 1,
            aad_b64: btoa(s.id + '#title'),
          });
        }

        const noteFolderId = this.normalizeFolderId((s as any)?.folder_id);
        const resolvedFolderName = noteFolderId
          ? (decryptedFolderNameById.get(noteFolderId) ?? '')
          : '';

        const normalizedServerNote = {
          ...s,
          text: decryptedText,
          title: decryptedTitle,
          favorite: !!(s.favorite ?? local?.favorite),
          pinned: !!(s.pinned ?? local?.pinned),
          folder: (resolvedFolderName ?? '').trim(),
          folder_id: noteFolderId,
        };

        if (!local || (normalizedServerNote.last_modified ?? 0) >= (local?.last_modified ?? 0)) {
          map.set(normalizedServerNote.id, { ...local, ...normalizedServerNote });
        }

        this.notesService.reconcileServerConfirmation(normalizedServerNote);
      }

      const mergedNotes = this.notesService.dedupeNotes(Array.from(map.values()).filter((n: any) => !n?.deleted));

      const localFolders = this.getStoredFolders(appPassword);
      const folderMap = new Map<string, any>();
      for (const folder of localFolders) {
        const key = this.normalizeFolderId((folder as any)?.id) ?? `name:${(folder?.name ?? '').trim().toLowerCase()}`;
        folderMap.set(key, folder);
      }
      for (const folder of serverFolders) {
        const normalizedFolderId = this.normalizeFolderId((folder as any)?.id) ?? (crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
        const normalizedFolder = {
          id: normalizedFolderId,
          name: decryptedFolderNameById.get(normalizedFolderId) ?? '',
          last_modified: Number(folder?.last_modified ?? 0),
          deleted: !!folder?.deleted,
        };
        const key = normalizedFolder.id as string;
        const localFolder = folderMap.get(key);
        if (!localFolder || normalizedFolder.last_modified >= Number(localFolder?.last_modified ?? 0)) {
          folderMap.set(key, normalizedFolder);
        }
      }

      if (this.notesService.appHasPasswordChallenge()) {
        this.notesService.setNotes(this.cryptoService.encrypt(JSON.stringify(mergedNotes), appPassword));
        this.notesService.setFolders(this.cryptoService.encrypt(JSON.stringify(this.notesService.dedupeFolders(Array.from(folderMap.values()))), appPassword));
      } else {
        this.notesService.setNotes(JSON.stringify(mergedNotes));
        this.notesService.setFolders(JSON.stringify(this.notesService.dedupeFolders(Array.from(folderMap.values()))));
      }

      await this.notesService.flushPersistence();
      this.notesService.setNoteIsUpdatedSubject(true);
      this.dataService.setForceDownloadOnHome(false);
      this.zone.run(() => {
        this.syncAppliedSubject.next(Date.now());
      });
      return true;
    } catch {
      this.dataService.setForceDownloadOnHome(true);
      return false;
    }
  }
}
