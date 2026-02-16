import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  QueryList,
  ViewChild,
  ViewChildren,
} from "@angular/core";
import {
  AlertController,
  GestureController,
  IonModal,
  IonSearchbar,
  LoadingController,
  ModalController,
  NavController,
  Platform,
  PopoverController,
  ToastController,
} from "@ionic/angular";

import { CryptoService } from "../services/crypto.service";
import { NotesService } from "../services/notes.service";
import { AppProtectorService } from "../services/app-protector.service";
import { DeleteNoteModalComponent } from "../delete-note-modal/delete-note-modal.component";
import { ResetPassModalComponent } from "../restpass-modal/resetpass-modal.component";
import { TranslatorService } from "../services/translator.service";
import { search } from "ionicons/icons";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { ActivatedRoute, NavigationEnd, Router } from "@angular/router";
import { UserMenuComponent } from "../user-menu/user-menu.component";
import { Subscription, filter } from "rxjs";

// 🔐 from main branch
import { NotesApiV1Service } from "../services/notes-api-v1.service";
import { SecureStorageService } from "../services/secure-storage.service";
import { DataService } from "../services/data.service";
import { AuthService } from "../services/auth.service";
import { CryptoKeyService } from "../services/crypto-key.service";
import {
  decryptTextWithMK,
  unpackCipherBlob,
} from "@stellarsecurity/stellar-crypto";
import { LongPressConfig, initializePressGestures } from "../utils/home-gesture.util";
import { normalize } from "../utils/home-normalize.util";
import { setDecryptedNotesAndParse } from "../utils/home-notes.util";
import { NoteContextMenuComponent } from "./note-context-menu/note-context-menu.component";

@Component({
  selector: "app-home",
  templateUrl: "home.page.html",
  styleUrls: ["home.page.scss"],
})
export class HomePage implements AfterViewInit {
  // --------------------------------------------------
  // Constants
  // --------------------------------------------------
  private static readonly LONG_PRESS_DELAY_MS = 200;
  private static readonly LONG_PRESS_START_DELAY_MS = 100;
  private static readonly MOVE_TOLERANCE_PX = 15;
  private static readonly SEARCH_FOCUS_DELAY_MS = 100;
  private static readonly DETECT_CHANGES_DELAY_MS = 200;
  // --------------------------------------------------
  // State
  // --------------------------------------------------
  private notes: any;

  public should_display = true;
  public checkboxOpened = false;
  public listOfCheckedCheckboxes: string[] = [];

  public app_requires_password = false;
  public showPassword = false;
  public input_password_app_unlock = "";

  public timezone = "UTC";
  public search_query = "";
  public filteredResults: any = [];
  public isSearching = false;

  allTranslations: any;

  // from current branch
  @ViewChild(IonModal) modal: IonModal;
  @ViewChildren("longPressElements", { read: ElementRef })
  longPressElements: QueryList<ElementRef>;
  timeout: any;
  isClicked: boolean = false;
  searchMode = false;
  searchQuery = "";
  @ViewChild("searchbar") searchbar: IonSearchbar;
  subscriptions: Subscription[] = [];
  noteId: any = "";
  userPopover: any;

  // 🔐 sync-related (from main branch)
  private pauseSync = false;
  private hiddenId: string | null = null;
  public isSyncing = false;
  public waitForSync = false;

  // 🔐 MK kept in RAM (EAK already resolved to plaintext MK elsewhere)
  private mkRaw: Uint8Array | null = null;

  private syncTimer: any = null;

  constructor(
    private cryptoService: CryptoService,
    private alertCtrl: AlertController,
    public noteService: NotesService,
    private navController: NavController,
    private toastController: ToastController,
    private appProtectorService: AppProtectorService,
    private modalCtrl: ModalController,
    private loadingController: LoadingController,
    private translatorService: TranslatorService,
    private gestureCtrl: GestureController,
    private platform: Platform,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private popoverController: PopoverController,
    private activatedRoute: ActivatedRoute,

    // 🔐 from main branch
    private notesApiServiceV1: NotesApiV1Service,
    private secureStorageService: SecureStorageService,
    private dataService: DataService,
    private authService: AuthService,
    private crypto: CryptoKeyService
  ) {
    // for make selected note on sidebar
    const urlParts = this.router.url.split("/");
    const id = urlParts[urlParts.length - 1]; // assuming the id is the last segment
    this.noteId = (this.noteService.selectedNoteId = id);
  }

  // Small helper: base64 -> Uint8Array (from main branch)
  private b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // --------------------------------------------------
  // Lifecycle
  // --------------------------------------------------
  async ionViewWillEnter() {
    if (this.pauseSync) this.pauseSync = false;

    // read hide_ids from query param (from main branch)
    this.hiddenId = this.activatedRoute.snapshot.queryParamMap.get("hide_ids");

    // if we should force download when coming home
    if (this.dataService.getForceDownloadOnHome() && this.authService.isLoggedIn) {
      this.waitForSync = true;
    }

    // If app does NOT have password challenge, load MK directly from secure storage (from main branch)
    if (!this.noteService.appHasPasswordChallenge()) {
      const eakB64 = await this.secureStorageService.getItem("ssEakB64");
      if (eakB64) {
        this.mkRaw = this.b64ToBytes(eakB64);
      }
    }

    this.allTranslations = this.translatorService.allTranslations;
    this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (this.noteService.shouldAskForPassword()) {
      this.should_display = false;
    } else {
      this.setData(this.noteService.getNotesAppPassword()); // will send a password, if the app is encrypted.
      await this.syncFromServer(); // 🔄 added server sync from main branch
    }

    this.checkboxOpened = false;
    this.initializePressGesture();
    this.subscribeNoteUpdated();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initializePressGesture();
      this.allTranslations = this.translatorService.allTranslations;
    }, 300)
  }

  ionViewDidEnter() {
    this.initializePressGesture();
    this.subscribeNoteIdOnRouteChange();
  }

  ionViewWillLeave() {
    this.exitSearchMode();

    // 🔄 pause background sync (from main branch)
    this.pauseSync = true;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // (your existing comment) // Perform cleanup, stop timers, dismiss modals, etc.
  }

  ionViewDidLeave() {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  // --------------------------------------------------
  // Route / selection helpers
  // --------------------------------------------------
  setSelectedNoteId(noteId: string | null = null): void {
    this.noteId = this.noteService.selectedNoteId =
      noteId ?? this.activatedRoute.snapshot.paramMap.get("id");
  }

  subscribeNoteIdOnRouteChange(): void {
    this.subscriptions.push(
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => {
          this.userPopover?.dismiss();
          const urlParts = this.router.url.split("/");
          const id = urlParts[urlParts.length - 1]; // assuming the id is the last segment
          this.noteId = this.noteService.selectedNoteId = id;
          if (this.noteId) {
            setTimeout(() => {
              localStorage.setItem("recentOpenedNoteId", this.noteId);
            }, 300);
          }
        })
    );
  }

  subscribeNoteUpdated(): void {
    this.subscriptions.push(
      this.noteService.noteIsUpdated$.subscribe((value) => {
        if (value) {
          this.setData(this.noteService.getNotesAppPassword());

          setTimeout(() => {
            this.initializePressGesture();
            this.cdr.detectChanges();
          }, 300);
        }
      })
    );
  }

  // --------------------------------------------------
  // UI Modes: Search
  // --------------------------------------------------
  enterSearchMode() {
    this.searchMode = true;
    setTimeout(() => {
      this.searchbar?.setFocus();
    }, 100); // Delay to ensure DOM renders
  }

  exitSearchMode() {
    this.search_query = "";
    this.pauseSync = false; // 🔄 resume sync when exiting search
    this.search();
    this.initializePressGesture();
    setTimeout(() => {
      this.searchMode = false;
      this.cdr.detectChanges();
    }, 500);
  }

  searchOld() {
    if (this.search_query.length == 0) {
      this.isSearching = false;
      this.filteredResults = this.notes;
      this.pauseSync = false; // if nothing to search, don't pause sync
      return;
    }

    let filteredNewResults = [];

    // helper: normalize / decode / map to stable searchable form
    const normalizeFn = (input: any) => {
      if (input === null || input === undefined) return "";
      let s = String(input);

      // 1) decode HTML entities if stored that way (safe in browser)
      try {
        const ta = document.createElement("textarea");
        ta.innerHTML = s;
        s = ta.value;
      } catch (e) {
        // ignore if document not available (SSR); keep raw string
      }

      // 2) compatibility normalization + lowercase
      if (s.normalize) s = s.normalize("NFKC");
      s = s.toLowerCase();

      // 3) remove invisible/zero-width chars
      s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");

      // 4) decompose and remove combining diacritics (so á -> a)
      if (s.normalize) s = s.normalize("NFD");
      s = s.replace(/[\u0300-\u036f]/g, "");
      if (s.normalize) s = s.normalize("NFC");

      // 5) map common ligatures / special letters to ASCII-ish equivalents
      s = s
        .replace(/æ/g, "ae")
        .replace(/œ/g, "oe")
        .replace(/ø/g, "o")
        .replace(/å/g, "a")
        .replace(/ß/g, "ss");

      // 6) collapse whitespace
      s = s.replace(/\s+/g, " ").trim();

      return s;
    };

    const normalizedQuery = normalizeFn(this.search_query);

    for (let i = 0; this.notes.length > i; i++) {
      // make safe even if text/title are null/objects
      const normalizedText = normalizeFn(this.notes[i]?.text);
      const result = normalizedText.includes(normalizedQuery);

      let titleExists = false;

      if (this.notes[i].title !== undefined) {
        const normalizedTitle = normalizeFn(this.notes[i]?.title);
        titleExists = normalizedTitle.includes(normalizedQuery);
      }

      // dont search in locked notes.
      if (result && !this.notes[i].protected) {
        filteredNewResults.push(this.notes[i]);
      } else if (titleExists) {
        filteredNewResults.push(this.notes[i]);
      }
    }

    this.isSearching = true;
    this.filteredResults = filteredNewResults;

    // 🔄 pause sync while searching (from main branch behavior)
    this.pauseSync = true;

    this.initializePressGesture();
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 200);
  }

  search() {
    if (this.search_query.length == 0) {
      this.isSearching = false;
      this.filteredResults = this.notes;
      return;
    }

    const normalizedQuery = normalize(this.search_query);
    const filteredNewResults: any[] = [];

    for (let i = 0; this.notes.length > i; i++) {
      const normalizedText = normalize(this.notes[i]?.text);
      const result = normalizedText.includes(normalizedQuery);

      let titleExists = false;
      if (this.notes[i].title !== undefined) {
        const normalizedTitle = normalize(this.notes[i]?.title);
        titleExists = normalizedTitle.includes(normalizedQuery);
      }

      // dont search in locked notes.
      if (result && !this.notes[i].protected) {
        filteredNewResults.push(this.notes[i]);
      } else if (titleExists) {
        filteredNewResults.push(this.notes[i]);
      }
    }

    this.isSearching = true;
    this.pauseSync = true;
    this.filteredResults = filteredNewResults;

    this.initializePressGesture();
    setTimeout(() => this.cdr.detectChanges(), HomePage.DETECT_CHANGES_DELAY_MS);
  }

  // --------------------------------------------------
  // Long-press selection
  // --------------------------------------------------
  initializePressGestureOld(): void {
    // if (this.platform.is('mobile') || this.platform.is('android') || this.platform.is('ios')) {
    if (!this.longPressElements) return;
    this.longPressElements.forEach((elementRef: ElementRef) => {
      this.createLongPressGesture(elementRef);
    });
    // }
  }

  initializePressGesture(): void {
    const cfg: LongPressConfig = {
      delayMs: HomePage.LONG_PRESS_DELAY_MS,
      moveTolerancePx: HomePage.MOVE_TOLERANCE_PX,
      startDelayMs: HomePage.LONG_PRESS_START_DELAY_MS,
    };

    initializePressGestures(
      this.longPressElements,
      this.gestureCtrl,
      (nativeEl) => this.handlePressStart(nativeEl),
      () => this.handlePressEnd(),
      cfg
    );
  }

  createLongPressGesture(element: ElementRef) {
    let timeout: any;
    let isLongPress = false;
    let startX = 0;
    let startY = 0;

    const gesture = this.gestureCtrl.create({
      el: element.nativeElement,
      threshold: 0,
      gestureName: "long-press",

      onStart: (detail) => {
        startX = detail.currentX;
        startY = detail.currentY;

        timeout = setTimeout(() => {
          isLongPress = true;
          this.handlePressStart(element.nativeElement);
        }, 200); // Faster long-press detection (200ms)
      },

      onMove: (detail) => {
        const moveX = Math.abs(detail.currentX - startX);
        const moveY = Math.abs(detail.currentY - startY);

        // Allow slight movements (15px tolerance) before canceling long press
        if (moveX > 15 || moveY > 15) {
          clearTimeout(timeout);
        }
      },

      onEnd: () => {
        clearTimeout(timeout);
        if (isLongPress) {
          this.handlePressEnd();
        }
        isLongPress = false;
      },
    });

    gesture.enable();
  }

  handlePressStart(element: any) {
    this.timeout = setTimeout(() => {
      this.checkboxOpened = true;
      setTimeout(() => {
        this.cdr.detectChanges();
        const noteId = element.id;

        // ✅ If not already selected, check it
        if (!this.listOfCheckedCheckboxes.includes(noteId)) {
          const checkboxEle = element.children[0].children[0];
          checkboxEle.checked = true;
          this.listOfCheckedCheckboxes.push(noteId);
        }

        Haptics.vibrate({ duration: 50 }).then(() => {});
        setTimeout(() => {
          this.cdr.detectChanges();
        }, 200);
      }, 100);
    }, 100);
  }

  handlePressEnd() {
    clearTimeout(this.timeout);
  }

  disableNativeContextMenu() {
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // --------------------------------------------------
  // Data loading / decryption (local)
  // --------------------------------------------------
  public appHasPasswordChallenge(): boolean {
    return this.noteService.appHasPasswordChallenge();
  }

  private setDataOld(password: string = ""): boolean {
    let decryptedNotes = null;
    if (this.noteService.appHasPasswordChallenge()) {
      let notes = this.noteService.getNotes();
      decryptedNotes = this.cryptoService.decrypt(notes, password);
    } else {
      this.noteService.setDecryptedNotes(this.noteService.getNotes());
      decryptedNotes = this.noteService.getNotes();
    }

    // @ts-ignore
    if (
      decryptedNotes?.length == 0 &&
      this.noteService.appHasPasswordChallenge()
    ) {
      return false;
    }

    this.noteService.setDecryptedNotes(decryptedNotes);
    // @ts-ignore
    this.notes = JSON.parse(decryptedNotes);

    this.filteredResults = this.notes;

    return true;
  }

  private setData(password: string = ""): boolean {
    const { parsed } = setDecryptedNotesAndParse(this.noteService, this.cryptoService, password);
    if (!parsed && this.noteService.appHasPasswordChallenge()) {
      return false;
    }
    // @ts-ignore
    this.notes = parsed ?? [];
    this.filteredResults = this.notes;
    return true;
  }

  // --------------------------------------------------
  // Remote sync (from main branch)
  // --------------------------------------------------
  public isLoggedIn() {
    return this.authService.isLoggedIn;
  }

  handleRefresh(event: any) {
    // for <ion-refresher>
    event?.target?.complete?.();

    this.waitForSync = true;
    this.dataService.setForceDownloadOnHome(true);
    this.syncFromServer();
  }

  async syncFromServer() {
    if (!this.authService.isLoggedIn) return;
    if (this.pauseSync) {
      console.log("Sync has paused.");
      return;
    }

    console.log("Sync has started");
    if (this.syncTimer == null) {
      this.syncTimer = setInterval(() => {
        if (!this.pauseSync && this.authService.isLoggedIn) {
          this.syncFromServer();
        }
      }, 30_000);
    }

    this.isSyncing = true;
    try {
      const res = await this.notesApiServiceV1.download(0);

      const serverNotes = res?.notes ?? [];
      const map = new Map<string, any>((this.notes ?? []).map((n: any) => [n.id, n]));

      for (const s of serverNotes) {
        const local = map.get(s.id);

        if (this.hiddenId === s.id) {
          map.delete(s.id);
          continue;
        }

        if (s.deleted) {
          if (!local || (s.last_modified ?? 0) >= (local?.last_modified ?? 0))
            map.delete(s.id);
          continue;
        }

        if (!this.mkRaw) {
          console.warn("MK not loaded; skipping decrypt of note", s.id);
          continue;
        }

        // Decrypt text (required)
        const blobText = unpackCipherBlob(s.text);
        s.text = await decryptTextWithMK(this.mkRaw, {
          ...blobText,
          v: 1,
          aad_b64: btoa(s.id),
        });

        // Decrypt title ONLY if present; otherwise set to empty string
        if (typeof s.title === "string" && s.title.length > 0) {
          const blobTitle = unpackCipherBlob(s.title);
          s.title = await decryptTextWithMK(this.mkRaw, {
            ...blobTitle,
            v: 1,
            aad_b64: btoa(s.id + "#title"),
          });
        } else {
          s.title = "";
        }

        if (!local) {
          map.set(s.id, s);
          continue;
        }
        if ((s.last_modified ?? 0) >= (local.last_modified ?? 0))
          map.set(s.id, { ...local, ...s });
      }

      const merged = Array.from(map.values()).filter((n: any) => !n.deleted);
      this.notes = merged;
      this.filteredResults = merged;

      if (this.noteService.appHasPasswordChallenge()) {
        const encryptedNotesSave = this.cryptoService.encrypt(
          JSON.stringify(merged),
          this.noteService.getNotesAppPassword()
        );
        this.noteService.setNotes(encryptedNotesSave);
      } else {
        this.noteService.setNotes(JSON.stringify(merged));
      }

      // reuse your local decryption pipeline
      this.setData(this.noteService.getNotesAppPassword());

      console.log("Synching in 30 seconds...");
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      this.isSyncing = false;
      this.waitForSync = false;
      this.dataService.setForceDownloadOnHome(false);
    }
  }

  // --------------------------------------------------
  // Auth / Protection
  // --------------------------------------------------
  public togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  // @ts-ignore
  public async unlockNotesApp() {
    if (this.input_password_app_unlock.length == 0) {
      const toast = await this.toastController.create({
        message: "Please enter your password.",
        duration: 3000,
        position: "bottom",
      });

      await toast.present();

      return;
    }

    this.noteService.increaseAppNoteAttemptsFailedPasswords();
    if (this.noteService.shouldWipeAllNotesOrNot()) {
      localStorage.clear();
      // @ts-ignore
      navigator["app"].exitApp();
      return false;
    }

    let shouldUnlock = false;

    try {
      shouldUnlock = this.setData(this.input_password_app_unlock);
    } catch (e) {
      //console.error(e);
    }

    if (shouldUnlock) {
      this.should_display = true;

      // 🔐 store the notes app password in a service.
      this.noteService.setNotesAppPassword(this.input_password_app_unlock);

      // 🔐 load & import MK (from main branch)
      try {
        let eakB64 = await this.secureStorageService.getItem(
          "ssEakB64_Encrypted"
        );
        if (eakB64) {
          // decrypt stored MK using app-lock password
          eakB64 = this.cryptoService.decrypt(
            eakB64,
            this.input_password_app_unlock
          ) as string;
          this.mkRaw = this.b64ToBytes(eakB64);

          // Import into crypto vault (keeps MK in RAM, used for AES-GCM note encryption)
          await this.crypto.importEAK(eakB64);
        }
      } catch (e) {
        console.error("Failed to import EAK:", e);
      }

      // init protection
      this.appProtectorService.init();
      // reset failed attempts.
      this.noteService.setFailedPasswordAppAttempts(0);

      this.input_password_app_unlock = "";

      // 🔄 trigger sync with server after unlock (from main branch)
      this.syncFromServer().then(() => {});

      setTimeout(() => {
        this.initializePressGesture();
        this.cdr.detectChanges();
      }, 200);
    } else {
      const toast = await this.toastController.create({
        message: this.allTranslations.passwordIsNotCorrectTryAgain,
        duration: 3000,
        position: "bottom",
      });

      this.input_password_app_unlock = "";

      await toast.present();
      return false;
    }

    return true;
  }

  /**
   * Will get the decrypted notes (if there is any),
   * and sort them by last modified.
   */
  getNotes() {
    if (this.filteredResults === undefined || this.filteredResults === null) {
      return [];
    }

    // @ts-ignore
    this.filteredResults = this.filteredResults.sort(
      (a: any, b: any) => b.last_modified - a.last_modified
    );

    return this.filteredResults;
  }

  // --------------------------------------------------
  // Navigation
  // --------------------------------------------------
  public settings() {
    this.navController.navigateForward("app-settings").then((r) => {});
  }

  goToProfile() {
    this.navController.navigateForward("profile").then((r) => {});
  }

  public openOrCheckbox(note_id: string) {
    if (!this.checkboxOpened) {
      this.navController.navigateForward("/note/" + note_id).then((r) => {});
    }
  }

  public toggleCheckbox() {
    this.checkboxOpened = !this.checkboxOpened;
    if (!this.checkboxOpened) {
      this.listOfCheckedCheckboxes = [];
      this.pauseSync = false;
    } else {
      this.pauseSync = true;
    }
    this.initializePressGesture();
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 300);
  }

  // --------------------------------------------------
  // Delete notes
  // --------------------------------------------------
  public async deleteSelectedNotes() {
    // @ts-ignore
    const modal = await this.modalCtrl.create({
      component: DeleteNoteModalComponent,
      cssClass: "confirmation-popup",
      componentProps: {
        isSingleDelete: this.listOfCheckedCheckboxes?.length == 1 || false,
      },
    });

    modal.onDidDismiss().then(async (data) => {
      if (data && data.data) {
        const { confirm } = data.data;
        if (confirm) {
          await this.deleteNotesConfirm();
        } else {
          // Handle case when user cancels password input
        }
      }
    });

    return await modal.present();
  }

  /**
   * Being called, when the confirmation has been done.
   * @private
   */
  private async deleteNotesConfirm() {
    const loading = await this.loadingController.create();
    await loading.present();

    const idsToDelete = new Set(this.listOfCheckedCheckboxes);

    // delete the selected notes from notes[]
    for (let j = this.notes.length - 1; j >= 0; j--) {
      if (idsToDelete.has(this.notes[j].id)) {
        this.notes.splice(j, 1);
      }
    }

    // keep filteredResults in sync (from main branch)
    if (this.filteredResults !== this.notes) {
      for (let k = this.filteredResults.length - 1; k >= 0; k--) {
        const n = this.filteredResults[k];
        if (n && idsToDelete.has(n.id)) {
          this.filteredResults.splice(k, 1);
        }
      }
    }

    if (this.noteService.appHasPasswordChallenge()) {
      // newly notes to save into storage.
      let encryptedNotesSave = this.cryptoService.encrypt(
        JSON.stringify(this.notes),
        this.noteService.getNotesAppPassword()
      );
      // notes in the app is stored.
      localStorage.setItem("app_password_challenge", "1");
      // update notes, and store.
      this.noteService.setNotes(encryptedNotesSave);
    } else {
      this.noteService.setNotes(JSON.stringify(this.notes));
    }

    // keep decrypted cache consistent
    this.noteService.setDecryptedNotes(this.noteService.getNotes());

    // 🔐 delete on server if logged in (from main branch)
    if (this.authService.isLoggedIn) {
      this.notesApiServiceV1
        .deleteNotes(this.listOfCheckedCheckboxes)
        .then(() => {
          this.listOfCheckedCheckboxes = [];
          this.checkboxOpened = false;
          this.cdr.detectChanges();
          setTimeout(() => {
            this.initializePressGesture()
          }, 300)
        });
    }

    const toast = await this.toastController.create({
      message: this.allTranslations.theSelectedNotesHasBeenDeleted,
      duration: 2500,
      position: "bottom",
    });

    await toast.present();
    await loading.dismiss();

    // current branch behaviour: reload home
    // window.location.href = "/";
  }

  // --------------------------------------------------
  // Reset password
  // --------------------------------------------------
  public async resetPassword() {
    // Create the modal
    const modal = await this.modalCtrl.create({
      component: ResetPassModalComponent,
      cssClass: 'confirmation-popup',
      backdropDismiss: false, // optional: prevent closing by clicking backdrop
    });

    // Present the modal
    await modal.present();

    // Wait for it to close and get returned data
    const { data } = await modal.onDidDismiss();

    // If user confirmed reset
    if (data?.confirm) {
      const loading = await this.loadingController.create({
        message: 'Resetting app…',
        spinner: 'crescent',
      });
      await loading.present();

      try {
        // Clear app data as you already do
        await this.dataService.clearAppData();
        localStorage.clear();
        this.app_requires_password = false;

        // Optional: also reset any in-memory state if needed
        this.notes = [];
        this.filteredResults = [];
        this.listOfCheckedCheckboxes = [];
        this.checkboxOpened = false;
        this.pauseSync = false;
        this.mkRaw = null;

        // Navigate cleanly using Ionic, no hard window reload
        this.modalCtrl.dismiss();
        this.navController.navigateRoot('/profile');
        setTimeout(async () => {
          await this.navController.navigateRoot('/home');
        })

      } finally {
        await loading.dismiss();
      }
    }
  }


  /**
   * Selecting notes that the user has chosen in UI.
   * @param event
   * @param note_id
   */
  public selectNote(event: any, note_id: string) {
    event?.stopImmediatePropagation();
    event?.preventDefault();

    if (this.isClicked) {
      return;
    }

    this.isClicked = true;

    if (!this.listOfCheckedCheckboxes.includes(note_id)) {
      this.listOfCheckedCheckboxes.push(note_id);
    } else {
      // removed.
      for (let i = 0; this.listOfCheckedCheckboxes.length > i; i++) {
        if (this.listOfCheckedCheckboxes[i] == note_id) {
          this.listOfCheckedCheckboxes.splice(i, 1);
        }
      }
    }
    setTimeout(() => {
      this.isClicked = false;
      this.cdr.detectChanges();
    });
  }

  async openContextMenu(event: MouseEvent, note: any) {
    event.preventDefault();
    event.stopPropagation();

    if(note.protected) {
      return
    }

    const popover = await this.popoverController.create({
      component: NoteContextMenuComponent,
      componentProps: { note },
      event: event,
      side: 'end',
      alignment: 'start',
      showBackdrop: true,
      translucent: false,
      cssClass: 'note-context-popover',
    });

    await popover.present();

    const { data } = await popover.onDidDismiss();

    if (!data) return;

    switch (data.action) {
      case 'select':
        this.openOrCheckbox(note.id);
        break;

      case 'lock':
        this.lockNote(note);
        break;

      case 'share':
        this.shareNote(note);
        break;

      case 'delete':
        this.deleteNote(note.id);
        break;
    }
  }

  lockNote(note: any) {
    console.log('Lock note', note);
    // Your lock logic
  }

  shareNote(note: any) {
    console.log('Share note', note);
    // Your share logic
  }

  deleteNote(id: string) {
    console.log('Delete note', id);
    // Your delete logic
  }

  /**
   * Will detect if the user presses enter on unlock notes-app.
   * @param ev
   */
  public ionInputAppUnlockInput(ev: any) {
    if (ev.key == "Enter") {
      this.unlockNotesApp().then((r) => {});
    }
  }

  // --------------------------------------------------
  // Extra navigation helpers (from current branch)
  // --------------------------------------------------
  goToCreateNewNote(): void {
    this.router.navigate(["/dummy-route"]);
    setTimeout(() => {
      this.router.navigate(["/note"]);
    });
  }

  async presentUserMenu(ev: Event) {
    this.userPopover = await this.popoverController.create({
      component: UserMenuComponent,
      event: ev,
      side: "bottom",
      alignment: "end",
      translucent: true,
      showBackdrop: false,
      cssClass: "user-menu-popover",
    });
    await this.userPopover.present();
  }

  navigateToHome(): void {
    localStorage.removeItem("recentOpenedNoteId");
    setTimeout(async () => {
      // window.location.href = "/home";
      await this.navController.navigateRoot('/home');
    });
  }
}
