import { LocalNoteStorage } from './local-note-storage.service';
import { CryptoService } from './crypto.service';
import { NoteV1 } from '../models/NoteV1';
import { Injectable, Optional } from "@angular/core";
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
  private persistenceReady = false;
  private cachedRaw = '[]';
  private trashRaw = '[]';
  private trashCache?:{raw:string;password:string;entries:Array<{id:string;trashedAt:number;note:NoteV1}>};
  private persistence: Promise<void> = Promise.resolve();
  private persistenceError: unknown;
  private persistenceGeneration = 0;
  private persistenceRunning=false;
  private pendingSnapshot?:{notes:string;trash:string;password:string;generation:number};
  constructor(@Optional() private localStore?: LocalNoteStorage) {}
  async initializePersistence(): Promise<void> {
    if (!this.localStore) return;
    const stored=await this.localStore.open();
    const legacy=localStorage.getItem('notes');
    this.cachedRaw=stored.exists?stored.notes:(legacy ?? '[]');
    this.trashRaw=stored.trash;
    if(stored.exists) {
      if(stored.passwordProtected)localStorage.setItem('app_password_challenge','1');
      else localStorage.removeItem('app_password_challenge');
    }
    this.persistenceReady=true;
    if (!stored.exists && legacy!==null) {this.queuePersistence();await this.flushPersistence();}
    localStorage.removeItem('notes');
  }
  private queuePersistence(): void {
    if(!this.persistenceReady || !this.localStore)return;
    this.pendingSnapshot={notes:this.cachedRaw,trash:this.trashRaw,password:this.notesAppPassword,generation:this.persistenceGeneration};
    this.startPersistence();
  }
  private startPersistence():void {
    if(this.persistenceRunning || !this.pendingSnapshot)return;
    this.persistenceRunning=true;
    this.persistence=Promise.resolve().then(async()=>{
      while(this.pendingSnapshot) {
        const snapshot=this.pendingSnapshot;this.pendingSnapshot=undefined;
        if(snapshot.generation!==this.persistenceGeneration)continue;
        await this.localStore!.write(snapshot.notes,snapshot.trash,snapshot.password);
        this.persistenceError=undefined;this.localPersistenceFailed$.next(false);
      }
    }).catch(error=>{this.persistenceError=error;this.localPersistenceFailed$.next(true);}).finally(()=>{
      this.persistenceRunning=false;
      if(this.pendingSnapshot)this.startPersistence();
    });
  }
  get showNoteThumbnails(): boolean { return localStorage.getItem('stellarShowNoteThumbnails') !== 'false'; }
  set showNoteThumbnails(value: boolean) { localStorage.setItem('stellarShowNoteThumbnails', String(value)); }
  get trashEnabled(): boolean { return localStorage.getItem('stellarTrashEnabled')==='true'; }
  set trashEnabled(value:boolean) {localStorage.setItem('stellarTrashEnabled',String(value));}
  getTrash(): Array<{id:string;trashedAt:number;note:NoteV1}> {
    if(this.shouldAskForPassword())return [];
    if(this.trashCache?.raw===this.trashRaw && this.trashCache.password===this.notesAppPassword)return this.trashCache.entries;
    const plain=this.trashRaw.startsWith('[')?this.trashRaw:new CryptoService().decrypt(this.trashRaw,this.notesAppPassword);
    const entries=JSON.parse(plain);
    this.trashCache={raw:this.trashRaw,password:this.notesAppPassword,entries};return entries;
  }
  private saveTrash(entries:any[]):void {
    const raw=JSON.stringify(entries);
    this.trashRaw=this.notesAppPassword?new CryptoService().encrypt(raw,this.notesAppPassword):raw;
    this.queuePersistence();
  }
  async captureTrash(notes:NoteV1[]):Promise<string[]> {
    if(!this.trashEnabled || !notes.length)return [];
    const generation=this.persistenceGeneration;
    const raw=this.getNotes();
    const stored:NoteV1[]=JSON.parse(raw.startsWith('[')?raw:new CryptoService().decrypt(raw,this.notesAppPassword));
    const ids=new Set(notes.map(note=>note.id));
    const existing=this.getTrash();
    const entries=stored.filter(note=>ids.has(note.id)).map(note=>existing.find(entry=>entry.note.id===note.id && entry.note.last_modified===note.last_modified) ?? {id:crypto.randomUUID(),trashedAt:Date.now(),note:{...note}});
    const entryIds=new Set(entries.map(entry=>entry.id));
    this.saveTrash([...existing.filter(entry=>!entryIds.has(entry.id)),...entries]);await this.flushPersistence();
    if(generation!==this.persistenceGeneration)throw Error('Local note session changed');
    return entries.map(entry=>entry.id);
  }
  async restoreTrash(ids:string[]):Promise<NoteV1[]> {
    const generation=this.persistenceGeneration;
    const selected=new Set(ids),entries=this.getTrash().filter(entry=>selected.has(entry.id));
    if(!entries.length)return [];
    const raw=this.getNotes();const crypt=new CryptoService();
    const notes:NoteV1[]=JSON.parse(raw.startsWith('[')?raw:crypt.decrypt(raw,this.notesAppPassword));
    const restored=entries.map(entry=>({...entry.note,id:crypto.randomUUID(),base_version:0,last_modified:Date.now(),deleted:false}));
    const next=JSON.stringify([...notes,...restored]);
    this.setNotes(this.notesAppPassword?crypt.encrypt(next,this.notesAppPassword):next);
    for(const note of restored)this.markPendingMutation(note.id,'update',note.last_modified);
    await this.flushPersistence();
    if(generation!==this.persistenceGeneration)throw Error('Local note session changed');
    await this.removeTrash(ids);
    if(generation!==this.persistenceGeneration)throw Error('Local note session changed');
    this.setNoteIsUpdatedSubject(true);return restored;
  }
  async removeTrash(ids:string[]):Promise<void> {const selected=new Set(ids);this.saveTrash(this.getTrash().filter(entry=>!selected.has(entry.id)));await this.flushPersistence();}
  async expireTrash():Promise<void> {
    const expired=this.getTrash().filter(entry=>Date.now()-entry.trashedAt>=30*86400000).map(entry=>entry.id);
    if(expired.length){await this.removeTrash(expired);this.setNoteIsUpdatedSubject(true);}
  }
  async clearLocalPersistence():Promise<void> {
    this.persistenceGeneration++;this.pendingSnapshot=undefined;await this.persistence;await this.localStore?.clear();
    this.cachedRaw=this.trashRaw='[]';this.persistenceError=undefined;
  }

  public readonly localPersistenceFailed$ = new BehaviorSubject<boolean>(false);
  public readonly syncNeedsAttention$ = new BehaviorSubject<boolean>(false);
  public hasPendingMutations(): boolean { return this.pendingNoteMutations.size > 0; }
  restoreLastNoteAttempted=false;
  selectedNoteId: any = "";
  pendingImageNote: {html: string} | null = null;
  editorFocusNoteId: string | null = null;
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
    if(this.persistenceReady)return this.cachedRaw;
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
    if(this.persistenceReady) {
      if(this.shouldAskForPassword())throw Error('Local notes are locked');
      this.cachedRaw=data ?? '[]';this.queuePersistence();
    }
    else localStorage.setItem("notes",data);
  }

  public appHasPasswordChallenge() {
    return localStorage.getItem("app_password_challenge") !== null;
  }

  public getNotesAppPassword(): string {
    return this.notesAppPassword;
  }

  public setNotesAppPassword(password: string) {
    if(!password && this.appHasPasswordChallenge()) {this.notesAppPassword='';return;}
    const trash = this.shouldAskForPassword() ? null : this.getTrash();
    this.notesAppPassword = password;
    if(trash) {
      const raw=JSON.stringify(trash);
      this.trashRaw=password?new CryptoService().encrypt(raw,password):raw;
    }
    if(password && this.persistenceReady)this.queuePersistence();
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
    let current:Promise<void>;
    do {current=this.persistence;await current;}while(current!==this.persistence);
    if(this.persistenceError)throw this.persistenceError;
  }

  public resetRuntimeState(): void {
    this.persistenceGeneration++;this.pendingSnapshot=undefined;
    this.trashCache=undefined;
    this.pendingImageNote = null;
    this.restoreLastNoteAttempted=true;
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