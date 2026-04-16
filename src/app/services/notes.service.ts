import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

export type PendingNoteMutationType =
  | 'delete'
  | 'update'
  | 'protect'
  | 'unprotect'
  | 'favorite'
  | 'pin'
  | 'move';

export interface PendingNoteMutation {
  noteId: string;
  type: PendingNoteMutationType;
  localUpdatedAt: number;
}

@Injectable({
  providedIn: "root",
})
export class NotesService {
  selectedNoteId: any = "";
  private noteIsUpdatedSubject = new BehaviorSubject<boolean>(true);
  noteIsUpdated$ = this.noteIsUpdatedSubject.asObservable();
  private noteIsDeletedSubject = new BehaviorSubject<boolean>(false);
  noteIsdeleted$ = this.noteIsDeletedSubject.asObservable();
  currentNote: any;
  isNoteTemporaryDescripted = false;
  notesPasswordStored: any = null;

  private decryptedNotes: any = null;
  private notesAppPassword = "";
  private MAX_APP_FAILED_ATTEMPTS = 20;
  private LAST_ACTIVITY_TIMESTAMP = 0;
  private pendingNoteMutations = new Map<string, PendingNoteMutation>();

  public getNotes() {
    const notes = localStorage.getItem("notes");
    return notes == null ? "[]" : notes;
  }

  public getFolders() {
    return localStorage.getItem('folders') ?? '[]';
  }

  public setFolders(data: any) {
    localStorage.setItem('folders', data ?? '[]');
  }

  public shouldWipeAllNotesOrNot() {
    return this.MAX_APP_FAILED_ATTEMPTS + 1 <= parseInt(this.getFailedPasswordAppAttempts());
  }

  public increaseAppNoteAttemptsFailedPasswords() {
    const failedAttempts = this.getFailedPasswordAppAttempts();
    const failedAttemptsUpdated = failedAttempts === null ? 1 : parseInt(failedAttempts) + 1;
    this.setFailedPasswordAppAttempts(failedAttemptsUpdated);
    return parseInt(this.getFailedPasswordAppAttempts());
  }

  public setFailedPasswordAppAttempts(attempts: number) {
    localStorage.setItem("failedAttemptsApp", String(attempts));
  }

  public getFailedPasswordAppAttempts() {
    return localStorage.getItem("failedAttemptsApp") as any;
  }

  public findNoteById(id: string, notes: any) {
    if (notes === null) return;
    let note = null;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].id === id) {
        note = notes[i];
        break;
      }
    }
    return note;
  }

  public shouldAskForPassword(): boolean {
    return this.appHasPasswordChallenge() && this.notesAppPassword == "";
  }

  public getDecryptedNotes() {
    return this.decryptedNotes;
  }

  public setNotes(data: any) {
    localStorage.setItem("notes", data);
  }

  public appHasPasswordChallenge() {
    return localStorage.getItem("app_password_challenge") !== null;
  }

  public getNotesAppPassword(): string {
    return this.notesAppPassword;
  }

  public setNotesAppPassword(password: string) {
    this.notesAppPassword = password;
  }

  public setDecryptedNotes(data: any) {
    this.decryptedNotes = data;
  }

  public setLastActivityTimestamp(timestamp: number) {
    this.LAST_ACTIVITY_TIMESTAMP = timestamp;
  }

  public getLastActivityTimestamp() {
    return this.LAST_ACTIVITY_TIMESTAMP;
  }

  setNoteIsUpdatedSubject(value: boolean): void {
    this.noteIsUpdatedSubject.next(value);
  }

  setNoteIsDeletedSubjectSubject(value: boolean): void {
    this.noteIsDeletedSubject.next(value);
  }

  public markPendingMutation(noteId: string, type: PendingNoteMutationType, localUpdatedAt = Date.now()): void {
    this.pendingNoteMutations.set(noteId, { noteId, type, localUpdatedAt });
  }

  public consumePendingMutation(noteId: string): PendingNoteMutation | null {
    const found = this.pendingNoteMutations.get(noteId) ?? null;
    if (found) this.pendingNoteMutations.delete(noteId);
    return found;
  }

  public clearPendingMutation(noteId: string): void {
    this.pendingNoteMutations.delete(noteId);
  }

  public getPendingMutation(noteId: string): PendingNoteMutation | null {
    return this.pendingNoteMutations.get(noteId) ?? null;
  }



  public dedupeByIdAndLastModified<T extends { id?: any; last_modified?: any }>(items: T[]): T[] {
    const map = new Map<string, T>();

    for (const item of Array.isArray(items) ? items : []) {
      const id = typeof item?.id === 'string' ? item.id.trim() : String(item?.id ?? '').trim();
      if (!id) continue;

      const existing = map.get(id);
      const currentLm = Number(item?.last_modified ?? 0);
      const existingLm = Number((existing as any)?.last_modified ?? 0);

      if (!existing || currentLm >= existingLm) {
        map.set(id, item);
      }
    }

    return Array.from(map.values());
  }

  public dedupeNotes(notes: any[]): any[] {
    return this.dedupeByIdAndLastModified(Array.isArray(notes) ? notes : []);
  }

  public dedupeFolders(folders: any[]): any[] {
    return this.dedupeByIdAndLastModified(Array.isArray(folders) ? folders : []);
  }

  public async flushPersistence(): Promise<void> {
    return;
  }

  public resetRuntimeState(): void {
    this.selectedNoteId = '';
    this.currentNote = null;
    this.isNoteTemporaryDescripted = false;
    this.notesPasswordStored = null;
    this.decryptedNotes = null;
    this.notesAppPassword = '';
    this.LAST_ACTIVITY_TIMESTAMP = 0;
    this.pendingNoteMutations.clear();
    this.noteIsUpdatedSubject.next(true);
    this.noteIsDeletedSubject.next(false);
  }

  public shouldIgnoreServerNote(serverNote: any): boolean {
    if (!serverNote?.id) return false;
    const pending = this.getPendingMutation(serverNote.id);
    if (!pending) return false;
    if (pending.type === 'delete') return true;
    const serverLastModified = Number(serverNote?.last_modified ?? 0);
    return serverLastModified < pending.localUpdatedAt;
  }

  public reconcileServerConfirmation(serverNote: any): void {
    if (!serverNote?.id) return;
    const pending = this.getPendingMutation(serverNote.id);
    if (!pending) return;
    if (serverNote?.deleted) { this.clearPendingMutation(serverNote.id); return; }
    const serverLastModified = Number(serverNote?.last_modified ?? 0);
    if (serverLastModified >= pending.localUpdatedAt) {
      this.clearPendingMutation(serverNote.id);
    }
  }

}