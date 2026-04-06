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
}
