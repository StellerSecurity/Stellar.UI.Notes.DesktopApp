import { Component, ViewChild, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';
import {
  AlertController,
  IonInput,
  IonModal,
  ModalController,
  NavController,
  ToastController,
} from '@ionic/angular';

import { Subscription } from 'rxjs';
import { CryptoService } from '../services/crypto.service';
import { NotesService } from '../services/notes.service';
import { TranslatorService } from '../services/translator.service';
import { Secret } from '../models/Secret';
import { sha512 } from 'js-sha512';
import { ShareSecretModalComponent } from '../share-secret-modal/share-secret-modal.component';
import { RichTextEditorComponent } from './rich-text-editor/rich-text-editor.component';
import { NotesApiV1Service } from '../services/notes-api-v1.service';
// import { SecureStorageService } from '../services/secure-storage.service';
import { DataService } from '../services/data.service';
import { NoteLockedModalComponent } from '../note-locked-modal/note-locked-modal.component';
import { DeleteNoteModalComponent } from '../delete-note-modal/delete-note-modal.component';
import { NoteV1 } from "../models/NoteV1";
import { AuthService } from "../services/auth.service";

// ✅ New: use Stellar Crypto SDK
import {
  unpackCipherBlob,
  decryptTextWithMK,
} from '@stellarsecurity/stellar-crypto';
import { SecureStorageService } from '../services/secure-storage.service';

// ✅ keep CommonJS requires (no ES imports)
declare var require: any;
const { v4: uuidv4 } = require('uuid');
const CryptoJS = require('crypto-js');

@Component({
  selector: 'app-add-note',
  templateUrl: './add-note.page.html',
  styleUrls: ['./add-note.page.scss'],
})
export class AddNotePage implements AfterViewInit, OnDestroy {
  @ViewChild(IonModal) modal!: IonModal;
  @ViewChild('titleInput', { static: false }) titleInputRef!: IonInput;
  @ViewChild('richTextEditorComponentRef') richTextEditorComponent!: RichTextEditorComponent;

  public notes_password_input = '';
  public note_locked = false;
  public notes_password_stored = '';
  public notes_password_confirm = '';
  public passwordStrengthHelperText = '';
  public showPassword = false;
  public confirmShowPassword = false;
  public strongPass = false;
  public upperLower = false;
  public specialChar = false;
  public passwordStrength = 0;
  public note_text = '';
  public note_title = '';
  public allTranslations: any;
  public isEditingTitle = false;

  private notes_id: string | null = null;
  private notes: NoteV1[] = [];
  private currentNote: NoteV1 | null = null;

  private saveTimeout: any = null;
  private liveNoteTimer?: number;
  private typing = false;
  private typingTimeout: any;
  private isPaused = false;
  private stopSyncing = false;
  private newlyCreatedNote = false;

  private fetchLiveNoteBound = () => {};
  private routeSub?: Subscription;

  // 🔐 Master key held in RAM (derived from EAK)
  private mkRaw: Uint8Array | null = null;

  constructor(
    private cryptoService: CryptoService,
    public activatedRoute: ActivatedRoute,
    private navController: NavController,
    private notesService: NotesService,
    private secureStorageService: SecureStorageService,
    private toastController: ToastController,
    private modalCtrl: ModalController,
    private dataService: DataService,
    private alertCtrl: AlertController,
    private notesApiV1Service: NotesApiV1Service,
    private translatorService: TranslatorService,
    private authService: AuthService
  ) {
    this.routeSub = this.activatedRoute.paramMap.subscribe((params: ParamMap) => {
      const decrypted = this.notesService.getDecryptedNotes();
      this.notes = decrypted ? (JSON.parse(decrypted) as NoteV1[]) : [];

      this.notes_id = params.get('id');
      if (this.notes_id === null) {
        // New note
        this.newlyCreatedNote = true;
        this.notes_id = uuidv4();
        return;
      }

      this.currentNote = this.notesService.findNoteById(this.notes_id, this.notes) as NoteV1 | null;

      if (!this.currentNote) {
        // defensive: if note not found, treat as new
        this.newlyCreatedNote = true;
        this.notes_id = uuidv4();
        return;
      }

      if (this.currentNote.protected) {
        this.note_locked = true;
        this.askforNotePassword().then(() => {});
      }

      this.note_text = this.currentNote.text ?? '';
      this.note_title = this.currentNote.title !== undefined ? this.currentNote.title : 'Untitled';

      this.startLiveNotePolling();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.stopLiveNotePolling();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.allTranslations = this.translatorService.allTranslations;
    }, 300)
  }

  ionViewDidEnter() {
    this.passwordStrengthHelperText = this.allTranslations?.passwordAtLeastLength ?? '';
    if (this.note_text.length === 0) {
      setTimeout(() => this.placeCursorAtEnd(), 100);
    }
  }

  // Small helper: base64 -> Uint8Array
  private b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async ionViewWillEnter(): Promise<void> {
    this.allTranslations = this.translatorService.allTranslations;

    // 🔐 Load MK from secure storage (same logic som HomePage)
    try {
      if (!this.notesService.appHasPasswordChallenge()) {
        const eakB64 = await this.secureStorageService.getItem('ssEakB64');
        if (eakB64) {
          this.mkRaw = this.b64ToBytes(eakB64);
        }
      } else {
        const enc = await this.secureStorageService.getItem('ssEakB64_Encrypted');
        const appPass = this.notesService.getNotesAppPassword();
        if (enc && appPass) {
          const decrypted = this.cryptoService.decrypt(enc, appPass) as string;
          this.mkRaw = this.b64ToBytes(decrypted);
        }
      }
    } catch (e) {
      console.error('Failed to load MK from storage in AddNotePage:', e);
    }
  }

  ionViewWillLeave() {
    this.stopLiveNotePolling();
    if (this.richTextEditorComponent?.onLeave) {
      this.richTextEditorComponent.onLeave();
    }
  }

  private placeCursorAtEnd() {
    const editorElem = this.richTextEditorComponent?.editorComponent?.textArea?.nativeElement;
    if (!editorElem) return;

    editorElem.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    const lastChild = editorElem.lastChild;

    if (selection && range && lastChild) {
      range.selectNodeContents(editorElem);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  public async shareStellarSecret() {
    if (this.richTextEditorComponent?.onLeave) {
      this.richTextEditorComponent.onLeave();
    }

    const addSecretModal = new Secret();
    const secret_id = uuidv4();

    addSecretModal.expires_at = '0';
    addSecretModal.id = sha512(secret_id);

    let secretMessage = this.note_text.replace(/<br ?\/?>/g, '\n');
    const doc = new DOMParser().parseFromString(secretMessage, 'text/html');
    secretMessage = doc.body?.textContent?.trim() || '';

    addSecretModal.message = CryptoJS.AES.encrypt(secretMessage, secret_id).toString();

    const modal = await this.modalCtrl.create({
      component: ShareSecretModalComponent,
      componentProps: { addSecretModal, secret_id },
      cssClass: 'secret-modal',
      breakpoints: [0, 0.7],
      initialBreakpoint: 0.7,
    });

    await modal.present();
  }

  enableEditingTitle() {
    this.isEditingTitle = true;
    setTimeout(() => this.titleInputRef?.setFocus(), 100);
  }

  public noteTitleChange(event: any) {
    const newTitle = (event?.detail?.value ?? '').trim();
    this.note_title = newTitle;

    for (let i = 0; i < this.notes.length; i++) {
      if (this.notes[i].id === this.notes_id) {
        this.notes[i].title = this.note_title;
        break;
      }
    }

    this.onSave(newTitle, 'note_title');
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
  toggleConfirmPasswordVisibility() {
    this.confirmShowPassword = !this.confirmShowPassword;
  }

  startLiveNotePolling() {
    this.liveNoteTimer = window.setInterval(() => {
      if (this.isPaused || document.hidden || !navigator.onLine) return;
      this.fetchLiveNote();
    }, 10_000);
  }

  pauseLiveSync() {
    this.isPaused = true;
  }

  resumeLiveSync() {
    this.isPaused = false;
    this.fetchLiveNote().then(() => {});
  }

  private stopLiveNotePolling() {
    this.stopSyncing = true;
    if (this.liveNoteTimer) clearInterval(this.liveNoteTimer);
    window.removeEventListener('focus', this.fetchLiveNoteBound);
    window.removeEventListener('online', this.fetchLiveNoteBound);
  }

  private async fetchLiveNote() {
    if (this.stopSyncing) return;
    if (this.note_locked) return;

    if (this.typing) {
      console.log('Do not fetch live note');
      return;
    }
    if (!this.notes_id) return;

    const noteId = this.notes_id as string;

    try {
      if (!this.authService.isLoggedIn) return;

      this.notesApiV1Service
        .find(noteId)
        .then(async (note: any) => {
          console.log('Fetched Live Note');
          if (this.currentNote == null) return;

          if (note.deleted) {
            this.dataService.setForceDownloadOnHome(true);
            await this.navController.navigateForward('/');
            return;
          }

          if (note.protected !== this.currentNote.protected) {
            this.dataService.setForceDownloadOnHome(true);
            await this.navController.navigateForward('/');
            return;
          }

          if (!note.protected) this.notes_password_stored = '';

          if (this.currentNote.last_modified == note.last_modified) {
            console.log('Equal');
            return;
          }
          if ((this.currentNote.last_modified ?? 0) > (note.last_modified ?? 0)) {
            console.log('Higher');
            return;
          }

          if (!this.mkRaw) {
            console.warn('MK not loaded in AddNotePage; skipping decrypt for live note');
            return;
          }

          // 🔐 Decrypt text (required)
          const blobText = unpackCipherBlob(note.text);
          note.text = await decryptTextWithMK(this.mkRaw, {
            ...blobText,
            v: 1,
            aad_b64: btoa(noteId),
          });

          // 🔐 Decrypt title if present
          if (typeof note.title === 'string' && note.title.length > 0) {
            const blobTitle = unpackCipherBlob(note.title);
            note.title = await decryptTextWithMK(this.mkRaw, {
              ...blobTitle,
              v: 1,
              aad_b64: btoa(noteId + '#title'),
            });
          } else {
            note.title = '';
          }

          this.currentNote.text = note.text;
          this.note_title = note.title;
          this.note_text = note.text;
          this.currentNote.title = this.note_title;

          if (note.protected) {
            console.log('Note is protected, lets decrypt it.');
            const ok = this.decryptNote(this.notes_password_stored, note);
            console.log('Note decrypted...');
            if (!ok) {
              this.dismissModal().then(() => {});
              await this.navController.navigateForward('/');
            }
          }
        })
        .catch(() => {
          /* ignore; try again on next tick */
        });
    } catch (err) {
      console.error('Find notes not done.', err);
    }
  }

  // should be called on key enter.
  save(ev: any) {
    console.log('save');
    if (this.notes_id === null) return;
    if (this.note_locked) return;

    const plainText = this.note_text ?? '';
    const plainTitle = this.note_title ?? '';

    const textForEncrypt = plainText.length > 0 ? plainText : ' ';
    const titleForEncrypt = plainTitle;

    let encryptedText = textForEncrypt;
    let encryptedTitle = titleForEncrypt;

    if ((this.notes_password_stored ?? '').length > 1) {
      encryptedText = this.cryptoService.encrypt(textForEncrypt, this.notes_password_stored);
      encryptedTitle = this.cryptoService.encrypt(titleForEncrypt, this.notes_password_stored);
    }

    let protectedNote = false;
    if (this.currentNote !== null) protectedNote = !!this.currentNote.protected;

    const now = new Date();
    const datePart = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const timePart = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    const formattedDate = `${datePart} at ${timePart}`;

    const note: NoteV1 = {
      id: this.notes_id,
      title: encryptedTitle && encryptedTitle.length ? encryptedTitle : formattedDate,
      last_modified: Date.now(),
      text: encryptedText,
      protected: protectedNote,
      auto_wipe: true,
    };

    if (this.notes === null) {
      this.notes = [note];
    } else {
      let found = false;
      for (let i = 0; i < this.notes.length; i++) {
        if (this.notes[i].id === this.notes_id) {
          this.notes[i] = note;
          found = true;
          break;
        }
      }
      if (!found) this.notes.push(note);
    }

    this.currentNote = note;
    this.storeNoteInStorage(true).then(() => {});
  }

  async storeNoteInStorage(serverSync = true, forceDownloadOnHome = false) {
    if (this.notesService.appHasPasswordChallenge()) {
      const encryptedNotesSave = this.cryptoService.encrypt(
        JSON.stringify(this.notes),
        this.notesService.getNotesAppPassword()
      );
      this.notesService.setNotes(encryptedNotesSave);
    } else {
      this.notesService.setNotes(JSON.stringify(this.notes));
    }

    if (forceDownloadOnHome) {
      this.dataService.setForceDownloadOnHome(true);
    }

    const notesToSend = this.notes;

    this.saveTimeout = window.setTimeout(() => {
      (async () => {
        if (serverSync && this.authService.isLoggedIn) {
          this.notesApiV1Service.upload(0, notesToSend).then(() => {});
          if (this.liveNoteTimer == null) {
            this.startLiveNotePolling();
          }
        }
      })();
    }, 500);
  }

  public back() {
    this.navController.back();
  }

  private async wrongPasswordEntered() {
    const toast = await this.toastController.create({
      message: this.allTranslations.passwordIsNotCorrectTryAgain,
      duration: 3000,
      position: 'bottom',
    });
    await toast.present();
    await this.askforNotePassword();
  }

  public async askforNotePassword() {
    const modal = await this.modalCtrl.create({
      component: NoteLockedModalComponent,
      cssClass: 'confirmation-popup',
    });

    modal.onDidDismiss().then(async (data) => {
      if (data && data.data) {
        const { confirm, inputValue } = data.data || {};
        console.log('confirm', confirm)
        if (confirm) {
          this.notes_password_stored = inputValue ?? '';

          const ok = this.decryptNote(this.notes_password_stored, this.currentNote);
          if (!ok) {
            await this.wrongPasswordEntered();
          } else {
            await modal.dismiss();
          }
        } else {
          // this.back();
          await modal?.dismiss(); // added additionally
        }
      }
      if (data.role === 'backdrop') {
        this.back();
      }
    });

    return await modal.present();
  }

  private decryptNote(notePassword: string, noteToDecrypt: NoteV1 | any): boolean {
    if (!notePassword?.length) return false;

    let decryptedText: string | null = null;

    try {
      decryptedText = this.cryptoService.decrypt(noteToDecrypt.text, notePassword);
    } catch (e) {
      console.error(e);
      return false;
    }

    if (!decryptedText?.length) return false;

    let decryptedTitle = '';
    try {
      decryptedTitle = this.cryptoService.decrypt(noteToDecrypt.title, notePassword);
    } catch (e) {
      // title may be empty or fail silently
    }

    if (this.currentNote) {
      this.currentNote.text = decryptedText;
      this.currentNote.title = decryptedTitle;
    }
    this.note_text = decryptedText;
    this.note_title = decryptedTitle;
    this.note_locked = false;

    return true;
  }

  public async dismissModal() {
    await this.modal.dismiss();
  }

  public notesPasswordChange() {
    this.passwordStrength = 0;

    if (this.notes_password_input.length == 0) {
      this.passwordStrengthHelperText = this.allTranslations.passwordAtLeastLength;
      return;
    }

    if (this.notes_password_input.length > 4) this.passwordStrength += 1;

    if (/[a-z]/.test(this.notes_password_input) && /[A-Z]/.test(this.notes_password_input)) {
      this.passwordStrength += 1;
      this.upperLower = true;
    } else {
      this.upperLower = false;
    }

    if (/\d/.test(this.notes_password_input)) this.passwordStrength += 1;

    if (/[^a-zA-Z\d]/.test(this.notes_password_input)) {
      this.passwordStrength += 1;
      this.specialChar = true;
    } else {
      this.specialChar = false;
    }

    if (this.notes_password_input.length >= 6) {
      this.passwordStrength += 1;
      this.strongPass = true;
    } else {
      this.strongPass = false;
    }

    if (this.passwordStrength < 2) {
      this.passwordStrengthHelperText = this.allTranslations.weakPassword;
    } else if (this.passwordStrength === 2) {
      this.passwordStrengthHelperText = this.allTranslations.averagePassword;
    } else if (this.passwordStrength === 3) {
      this.passwordStrengthHelperText = this.allTranslations.goodPassword;
    } else {
      this.passwordStrengthHelperText = this.allTranslations.greatPassword;
    }
  }

  public async lockNote() {
    if (this.notes_password_input !== this.notes_password_confirm) {
      const toast = await this.toastController.create({
        message: this.allTranslations.theTwoPasswordsDoesNotMatch,
        duration: 2500,
        position: 'bottom',
      });
      await toast.present();
      return;
    }

    if (this.notes_password_input.length < 2) {
      const toast = await this.toastController.create({
        message: this.allTranslations.thePasswordIsTooWeakPleaseMakeItStronger,
        duration: 3000,
        position: 'bottom',
      });
      await toast.present();
      return;
    }

    this.notes_password_stored = this.notes_password_input;

    const decryptedText = this.note_text;
    const decryptedTitle = this.note_title;

    const encryptedText = this.cryptoService.encrypt(this.note_text, this.notes_password_stored);
    const encryptedTitle = this.cryptoService.encrypt(this.note_title, this.notes_password_stored);

    if (this.currentNote) {
      this.currentNote.protected = true;
      this.currentNote.text = encryptedText;
      this.currentNote.title = encryptedTitle;
    }

    const newNotes: NoteV1[] = [];
    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.id === this.notes_id) {
        const updated: NoteV1 = {
          ...note,
          ...(this.currentNote as NoteV1),
          last_modified: Date.now(),
        };
        newNotes.push(updated);
      } else {
        newNotes.push(note);
      }
    }
    this.notes = newNotes;

    this.storeNoteInStorage(true);

    if (this.currentNote) {
      this.currentNote.text = decryptedText;
      this.currentNote.title = decryptedTitle;
    }

    this.notes_password_confirm = '';
    this.notes_password_input = '';

    await this.dismissModal();
  }

  public async removeLock() {
    const alert = await this.alertCtrl.create({
      header: this.allTranslations.warningCap,
      subHeader: this.allTranslations.areYouSureYouWantToRemoveThePasswordForTheNote,
      buttons: [
        {
          text: this.allTranslations.cancel,
          role: 'cancel',
        },
        {
          text: this.allTranslations.removeLock,
          role: 'confirm',
          handler: () => {
            for (let i = 0; i < this.notes.length; i++) {
              if (this.notes[i].id === this.notes_id) {
                this.notes[i].text = this.note_text;
                this.notes[i].title = this.note_title;
                this.notes[i].last_modified = Date.now();
                this.notes[i].protected = false;
                this.currentNote = this.notes[i];
                this.notes_password_stored = '';
                break;
              }
            }

            if (this.authService.isLoggedIn) {
              this.stopSyncing = true;
              this.notesApiV1Service.upload(0, this.notes);
              this.stopSyncing = false;
            }

            this.storeNoteInStorage(true);
            this.modal.dismiss();
          },
        },
      ],
    });

    await alert.present();
  }

  public async openLockModal() {
    this.save(null);
    await this.modal.present();
  }

  public getProtected() {
    return this.currentNote?.protected;
  }

  public async deleteNote() {
    const modal = await this.modalCtrl.create({
      component: DeleteNoteModalComponent,
      cssClass: 'confirmation-popup',
      componentProps: { isSingleDelete: true },
    });

    modal.onDidDismiss().then(async (data) => {
      if (data && data.data) {
        const { confirm } = data.data;
        if (confirm) {
          for (let i = 0; i < this.notes.length; i++) {
            if (this.notes[i].id === this.notes_id) {
              this.notes[i].deleted = true;

              if (this.authService.isLoggedIn) {
                this.notesApiV1Service.deleteNotes([this.notes[i].id]).then(() => {});
              }

              this.notes.splice(i, 1);
              break;
            }
          }

          await this.storeNoteInStorage(true, this.newlyCreatedNote);
          this.currentNote = null;
          await this.navController.navigateForward('/?hide_ids=' + this.notes_id);
        }
      }
    });

    return await modal.present();
  }

  onSave(event: any, type: string = 'note_text'): void {
    if (type === 'note_text') {
      this.note_text = event;
    } else {
      this.note_title = event;
    }

    this.typing = true;
    this.typingTimeout = setTimeout(() => (this.typing = false), 10_000);

    clearTimeout(this.saveTimeout);
    this.save(null);
  }
}
