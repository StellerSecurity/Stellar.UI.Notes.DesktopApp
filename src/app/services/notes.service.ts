import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

@Injectable({
  providedIn: "root",
})
export class NotesService {
  selectedNoteId: any = "";
  private noteIsUpdatedSubject = new BehaviorSubject<boolean>(true);
  noteIsUpdated$ = this.noteIsUpdatedSubject.asObservable();
  private noteIsDeletedSubject = new BehaviorSubject<boolean>(false);
  noteIsdeleted$ = this.noteIsDeletedSubject.asObservable();
  currentNote:any;

  private decryptedNotes: any = null;

  /**
   * Holds the app password if there is any.
   * @private
   */
  private notesAppPassword: string = "";

  /**
   * Max failed attempts in a row before the app wipes it-self.
   * @private
   */
  private MAX_APP_FAILED_ATTEMPTS = 20;

  /**
   * Controls, when the active time was for the notesApp, when it was active && unlocked.
   * @private
   */
  private LAST_ACTIVITY_TIMESTAMP = 0;

  /**
   * If the user has chosen to add a password to the notes-app,
   * the methods returns an encrypted AES string.
   */
  public getNotes() {
    let notes = localStorage.getItem("notes");

    if (notes == null) {
      return "[]";
    }

    return notes;
  }

  public shouldWipeAllNotesOrNot() {
    // @ts-ignore
    return (
      this.MAX_APP_FAILED_ATTEMPTS + 1 <=
      parseInt(this.getFailedPasswordAppAttempts())
    );
  }

  public increaseAppNoteAttemptsFailedPasswords() {
    let failedAttempts = this.getFailedPasswordAppAttempts();

    let failedAttemptsUpdated = 0;

    if (failedAttempts === null) {
      failedAttemptsUpdated = 1;
    } else {
      failedAttemptsUpdated = parseInt(failedAttempts) + 1;
    }

    this.setFailedPasswordAppAttempts(failedAttemptsUpdated);

    // @ts-ignore
    return parseInt(this.getFailedPasswordAppAttempts());
  }

  public setFailedPasswordAppAttempts(attempts: number) {
    localStorage.setItem("failedAttemptsApp", String(attempts));
  }

  public getFailedPasswordAppAttempts() {
    return localStorage.getItem("failedAttemptsApp") as any;
  }

  /**
   * Will find a note by its ID.
   * @param id
   * @param notes
   */
  public findNoteById(id: string, notes: any) {
    if (notes === null) return;

    let note = null;

    // @ts-ignore
    for (let i = 0; i < notes.length; i++) {
      // @ts-ignore
      if (notes[i].id === id) {
        // @ts-ignore
        note = notes[i];
        break;
      }
    }
    return note;
  }

  /**
   * Determines if we should ask the user about the password for app-access.
   */
  public shouldAskForPassword(): boolean {
    return this.appHasPasswordChallenge() && this.notesAppPassword == "";
  }

  /**
   * Will return the notes in a decrypted state.
   * Only if the user has unlocked the app and any other states has been meet.
   * Otherwise, the return, can be null.
   * If there is no notes-password on the app, it should always return a list
   * [if there is any notes.]
   */
  public getDecryptedNotes() {
    return this.decryptedNotes;
  }

  public setNotes(data: any) {
    localStorage.setItem("notes", data);
  }

  /**
   *
   */
  public appHasPasswordChallenge() {
    let has_password_challenge = localStorage.getItem("app_password_challenge");
    return has_password_challenge !== null;
  }

  /**
   * Will reveal the notesAppPassword, if it's in a state that can be revealed,
   * such as if the user just opened the app.
   */
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

  /**
   * Returns timestamp of when the user last was active on the app (foreground).
   * @return number
   */
  public getLastActivityTimestamp() {
    return this.LAST_ACTIVITY_TIMESTAMP;
  }

  setNoteIsUpdatedSubject(value: boolean): void {
    this.noteIsUpdatedSubject.next(value);
  }

  setNoteIsDeletedSubjectSubject(value: boolean): void {
    this.noteIsDeletedSubject.next(value);
  }
}
