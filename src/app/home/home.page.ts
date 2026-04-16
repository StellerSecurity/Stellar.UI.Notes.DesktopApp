import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
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
import { RemoteDownloadSyncService } from "../services/remote-download-sync.service";
import { CryptoKeyService } from "../services/crypto-key.service";
import {
  decryptTextWithMK,
  unpackCipherBlob,
} from "@stellarsecurity/stellar-crypto";
import { LongPressConfig, initializePressGestures } from "../utils/home-gesture.util";
import { normalize } from "../utils/home-normalize.util";
import { setDecryptedNotesAndParse } from "../utils/home-notes.util";
import { NoteContextMenuComponent } from "./note-context-menu/note-context-menu.component";
import { Folder } from "../models/Folder";
import { Secret } from "../models/Secret";
import { sha512 } from 'js-sha512';
import { ShareSecretModalComponent } from "../share-secret-modal/share-secret-modal.component";
import { NoteLockedModalComponent } from "../note-locked-modal/note-locked-modal.component";

declare var require: any;
const { v4: uuidv4 } = require('uuid');
const CryptoJS = require('crypto-js');

@Component({
  selector: "app-home",
  templateUrl: "home.page.html",
  styleUrls: ["home.page.scss"],
})
export class HomePage implements AfterViewInit {
  private static readonly UI_STATE_KEY = 'home_ui_state_v1';
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
  public notes: any;

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
  @ViewChild('notesListScroll', { read: ElementRef }) notesListScroll?: ElementRef<HTMLElement>;
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

  private pendingRestoreScrollTop: number | null = null;
  private networkListenersRegistered = false;
  private syncRequestInFlight: Promise<void> | null = null;
  private networkOnlineHandler = () => {
    void this.handleNetworkBackOnline();
  };
  private networkOfflineHandler = () => {
    this.handleNetworkOffline();
  };

  public folders: Folder[] = [];
  private allFoldersState: Folder[] = [];
  public activeFolderName = '__all__';
  public activeFilter: 'all' | 'favorites' = 'all';
  public folderActionsOpen = false;
  public folderActionsEvent: Event | null = null;
  public folderActionsTarget: Folder | null = null;
  private pendingRenameFolder: Folder | null = null;
  public renamingFolderId: string | null = null;
  public renamingFolderName = '';
  public draggingNoteId: string | null = null;
  public draggingFolderTarget: string | null = null;

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
    private crypto: CryptoKeyService,
    private remoteDownloadSync: RemoteDownloadSyncService,
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

  private normalizeFolderId(folderId: any): string | null {
    return typeof folderId === 'string' && folderId.trim().length > 0 ? folderId.trim() : null;
  }

  private loadUiState(): any {
    try {
      const raw = localStorage.getItem(HomePage.UI_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private persistUiState(): void {
    try {
      const container = this.notesListScroll?.nativeElement;
      const payload = {
        activeFolderName: this.activeFolderName || '__all__',
        activeFilter: this.activeFilter === 'favorites' ? 'favorites' : 'all',
        searchQuery: this.search_query ?? '',
        searchMode: !!this.searchMode,
        selectedNoteId: this.noteService.selectedNoteId ?? this.noteId ?? null,
        scrollTop: container?.scrollTop ?? 0,
      };
      localStorage.setItem(HomePage.UI_STATE_KEY, JSON.stringify(payload));
    } catch {}
  }

  private restoreUiState(): void {
    const saved = this.loadUiState();
    if (!saved) {
      return;
    }

    const savedFilter = saved?.activeFilter === 'favorites' ? 'favorites' : 'all';
    const savedFolderName = typeof saved?.activeFolderName === 'string' && saved.activeFolderName.trim().length > 0
      ? saved.activeFolderName.trim()
      : '__all__';
    const hasSavedFolder = savedFolderName === '__all__' || this.folders.some((folder) => folder.name === savedFolderName);

    this.activeFilter = savedFilter;
    this.activeFolderName = hasSavedFolder ? savedFolderName : '__all__';
    this.search_query = typeof saved?.searchQuery === 'string' ? saved.searchQuery : '';
    this.searchMode = !!saved?.searchMode && this.search_query.trim().length > 0;

    const selectedNoteId = typeof saved?.selectedNoteId === 'string' ? saved.selectedNoteId : null;
    if (selectedNoteId) {
      this.noteId = selectedNoteId;
      this.noteService.selectedNoteId = selectedNoteId;
    }

    this.pendingRestoreScrollTop = Number.isFinite(Number(saved?.scrollTop))
      ? Number(saved.scrollTop)
      : null;

    this.applyFilters();
    this.restoreNotesListScroll();
  }

  private restoreNotesListScroll(): void {
    if (this.pendingRestoreScrollTop == null) {
      return;
    }

    const scrollTop = this.pendingRestoreScrollTop;
    setTimeout(() => {
      const container = this.notesListScroll?.nativeElement;
      if (!container) {
        return;
      }
      container.scrollTop = scrollTop;
      this.pendingRestoreScrollTop = null;
    }, 0);
  }


  private hasInternetConnection(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  private shouldAttemptRemoteDownload(): boolean {
    return !!this.authService.isLoggedIn && this.hasInternetConnection();
  }


  private clearSyncUiState(options: { clearForceDownload?: boolean } = {}): void {
    this.isSyncing = false;
    this.waitForSync = false;

    if (options.clearForceDownload !== false) {
      this.dataService.setForceDownloadOnHome(false);
    }
  }

  private async requestImmediateSync(reason: 'enter' | 'resume' | 'online' | 'manual' = 'manual'): Promise<void> {
    if (!this.authService.isLoggedIn) {
      this.clearSyncUiState();
      return;
    }

    if (!this.hasInternetConnection()) {
      this.waitForSync = false;
      this.isSyncing = false;
      this.dataService.setForceDownloadOnHome(true);
      return;
    }

    if (this.noteService.shouldAskForPassword() || !this.should_display) {
      this.waitForSync = false;
      this.isSyncing = false;
      this.dataService.setForceDownloadOnHome(true);
      return;
    }

    this.waitForSync = true;
    this.isSyncing = true;
    this.dataService.setForceDownloadOnHome(true);

    const didSync = await this.remoteDownloadSync.requestImmediateSync(reason === 'manual' ? 'manual' : (reason === 'online' ? 'online' : 'resume'));

    if (didSync) {
      this.setData(this.noteService.getNotesAppPassword());
      this.restoreUiState();
      this.clearSyncUiState({ clearForceDownload: true });
      return;
    }

    this.clearSyncUiState({ clearForceDownload: !this.authService.isLoggedIn });
  }

  private registerNetworkListeners(): void {
    if (this.networkListenersRegistered || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('online', this.networkOnlineHandler);
    window.addEventListener('offline', this.networkOfflineHandler);
    this.networkListenersRegistered = true;
  }

  private unregisterNetworkListeners(): void {
    if (!this.networkListenersRegistered || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('online', this.networkOnlineHandler);
    window.removeEventListener('offline', this.networkOfflineHandler);
    this.networkListenersRegistered = false;
  }

  private async handleNetworkBackOnline(): Promise<void> {
    await this.requestImmediateSync('online');
  }

  private handleNetworkOffline(): void {
    this.waitForSync = false;
    this.isSyncing = false;
    if (this.authService.isLoggedIn) {
      this.dataService.setForceDownloadOnHome(true);
    }
  }

  public onNotesListScroll(): void {
    this.persistUiState();
  }

  private getStoredFolders(password: string = ''): Folder[] {
    try {
      const rawFolders = this.noteService.getFolders();
      const decodedFolders = this.noteService.appHasPasswordChallenge()
        ? this.cryptoService.decrypt(rawFolders, password || this.noteService.getNotesAppPassword())
        : rawFolders;
      const parsedFolders = decodedFolders ? JSON.parse(decodedFolders) : [];
      if (!Array.isArray(parsedFolders)) {
        return [];
      }
      return parsedFolders
        .map((folder: any) => ({
          id: this.normalizeFolderId(folder?.id) ?? (crypto?.randomUUID?.() ?? String(Date.now() + Math.random())),
          name: (folder?.name ?? '').trim(),
          last_modified: Number(folder?.last_modified ?? Date.now()),
          deleted: !!folder?.deleted,
        }))
        .filter((folder: Folder) => folder.name.length > 0 || folder.deleted);
    } catch {
      return [];
    }
  }

  private async uploadFoldersState(): Promise<void> {
    if (!this.authService.isLoggedIn) {
      return;
    }
    await this.notesApiServiceV1.upload(0, [], undefined, this.getStoredFolders(this.noteService.getNotesAppPassword()));
  }

  private resolveFolderIdByName(name: string): string | null {
    const normalizedName = (name ?? '').trim().toLowerCase();
    if (!normalizedName) {
      return null;
    }
    return this.folders.find((folder) => (folder.name ?? '').trim().toLowerCase() === normalizedName)?.id ?? null;
  }


  private async decryptFolderNameWithMK(rawName: string, folderId: string | null | undefined): Promise<string> {
    const normalizedRaw = (rawName ?? '').trim();
    const normalizedFolderId = this.normalizeFolderId(folderId);
    if (!normalizedRaw || !normalizedFolderId || !this.mkRaw) {
      return normalizedRaw;
    }

    try {
      const blobName = unpackCipherBlob(normalizedRaw);
      return await decryptTextWithMK(this.mkRaw, {
        ...blobName,
        v: 1,
        aad_b64: btoa(normalizedFolderId + '#folder-name'),
      });
    } catch {
      return normalizedRaw;
    }
  }

  private async decryptServerFolders(serverFolders: any[]): Promise<Map<string, string>> {
    const folderNameById = new Map<string, string>();

    for (const folder of serverFolders ?? []) {
      const folderId = this.normalizeFolderId((folder as any)?.id);
      if (!folderId) {
        continue;
      }

      const decryptedName = folder?.deleted
        ? ''
        : await this.decryptFolderNameWithMK((folder?.name ?? '').trim(), folderId);

      folderNameById.set(folderId, decryptedName);
    }

    return folderNameById;
  }

  private loadFolders(password: string = ''): void {
    let parsedFolders: Folder[] = [];
    try {
      parsedFolders = this.getStoredFolders(password);
    } catch {
      parsedFolders = [];
    }

    const folderMap = new Map<string, Folder>();

    for (const folder of parsedFolders ?? []) {
      const name = (folder?.name ?? '').trim();
      if (!name || folder.deleted) {
        continue;
      }
      folderMap.set(name.toLowerCase(), {
        id: folder.id,
        name,
        last_modified: folder?.last_modified ?? Date.now(),
        deleted: false,
      });
    }

    for (const note of this.notes ?? []) {
      const name = (note?.folder ?? '').trim();
      if (!name) {
        continue;
      }
      if (!folderMap.has(name.toLowerCase())) {
        folderMap.set(name.toLowerCase(), {
          id: this.normalizeFolderId((note as any)?.folder_id) ?? (crypto?.randomUUID?.() ?? String(Date.now() + Math.random())),
          name,
          last_modified: note?.last_modified ?? Date.now(),
          deleted: false,
        });
      }
    }

    this.folders = Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    if (this.activeFolderName !== '__all__'
      && !this.folders.some((folder) => folder.name === this.activeFolderName)) {
      this.activeFolderName = '__all__';
    }
  }

  // --------------------------------------------------
  // Lifecycle
  // --------------------------------------------------
  async ionViewWillEnter() {
    if (this.pauseSync) this.pauseSync = false;

    // read hide_ids from query param (from main branch)
    this.hiddenId = this.activatedRoute.snapshot.queryParamMap.get("hide_ids");

    // if we should force download when coming home
    if (this.dataService.getForceDownloadOnHome() && this.authService.isLoggedIn && this.hasInternetConnection()) {
      this.waitForSync = true;
    } else if (!this.authService.isLoggedIn || !this.hasInternetConnection()) {
      this.waitForSync = false;
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
      this.clearSyncUiState({ clearForceDownload: !this.authService.isLoggedIn });
    } else {
      this.setData(this.noteService.getNotesAppPassword()); // will send a password, if the app is encrypted.
      this.restoreUiState();
      if (this.shouldAttemptRemoteDownload()) {
        await this.requestImmediateSync('enter'); // immediate refresh with latest notes on open/re-open
        this.restoreUiState();
      } else {
        this.clearSyncUiState({ clearForceDownload: this.authService.isLoggedIn ? false : true });
      }
    }

    this.checkboxOpened = false;
    this.initializePressGesture();
    this.subscribeNoteUpdated();
    this.registerNetworkListeners();
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
    this.persistUiState();
    this.exitSearchMode();

    // 🔄 pause background sync (from main branch)
    this.pauseSync = true;

    // (your existing comment) // Perform cleanup, stop timers, dismiss modals, etc.
  }

  ionViewDidLeave() {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    this.unregisterNetworkListeners();
  }

  // --------------------------------------------------
  // Route / selection helpers
  // --------------------------------------------------
  setSelectedNoteId(noteId: string | null = null): void {
    this.noteService.isNoteTemporaryDescripted = false;
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
    this.persistUiState();
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
      this.persistUiState();
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
    this.persistUiState();

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
    return;
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
    return;
  }

  handlePressEnd() {
    return;
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

    this.notes = (parsed ?? []).map((note: any) => ({
      ...note,
      favorite: !!note?.favorite,
      pinned: !!note?.pinned,
      folder: (note?.folder ?? '').trim(),
      folder_id: this.normalizeFolderId((note as any)?.folder_id),
    }));
    this.loadFolders(password);
    this.filteredResults = this.notes;
    this.applyFilters();
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

    if (!this.shouldAttemptRemoteDownload()) {
      if (this.authService.isLoggedIn && !this.hasInternetConnection()) {
        this.dataService.setForceDownloadOnHome(true);
      } else if (!this.authService.isLoggedIn) {
        this.clearSyncUiState();
      }
      return;
    }

    void this.requestImmediateSync('manual');
  }

  async syncFromServer(reason: 'enter' | 'resume' | 'online' | 'manual' = 'manual') {
    await this.requestImmediateSync(reason);
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
      if (this.hasInternetConnection()) {
        this.syncFromServer().then(() => {});
      } else {
        this.dataService.setForceDownloadOnHome(true);
      }

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

    this.applyFilters();

    // descript current note on unlock temporary
    if (Array.isArray(this.filteredResults) && this.filteredResults.length) {
      this.filteredResults = this.filteredResults.map((note: any) => {

        if (
          note?.id === this.noteService.selectedNoteId &&
          this.noteService.isNoteTemporaryDescripted &&
          this.noteService.notesPasswordStored
        ) {
          try {
            if(note?.isDescripted == true) {
              return note
            } else {
            return {
              ...note,
              title: this.cryptoService.decrypt(
                note.title,
                this.noteService.notesPasswordStored
              ),
              text: this.cryptoService.decrypt(
                note.text,
                this.noteService.notesPasswordStored
              ),
              isDescripted: true,
            }
          };
          } catch (error) {
            console.error('Decryption failed:', error);
            return note; // fallback safely
          }
        }

        return note;
      });
    }

    return this.filteredResults;
  }

  // --------------------------------------------------
  // Navigation
  // --------------------------------------------------
  private isTypingTarget(target: HTMLElement | null): boolean {
    if (!target) {
      return false;
    }

    const tag = String(target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'ion-input', 'ion-textarea', 'ion-searchbar'].includes(tag)) {
      return true;
    }

    return !!target.closest('input, textarea, select, ion-input, ion-textarea, ion-searchbar, [contenteditable="true"], .folder-rename-input, .ql-editor');
  }

  private selectRelativeNote(step: number): void {
    const list = Array.isArray(this.filteredResults) ? this.filteredResults : [];
    if (!list.length) {
      return;
    }

    const currentId = String(this.noteService.selectedNoteId ?? this.noteId ?? '').trim();
    const currentIndex = list.findIndex((note: any) => note?.id === currentId);
    const nextIndex = currentIndex === -1
      ? (step > 0 ? 0 : list.length - 1)
      : Math.min(Math.max(currentIndex + step, 0), list.length - 1);

    const next = list[nextIndex];
    if (!next?.id) {
      return;
    }

    this.noteId = next.id;
    this.noteService.selectedNoteId = next.id;
    this.persistUiState();
    this.cdr.detectChanges();
  }

  private async assignNoteToFolder(noteId: string, folderName: string): Promise<void> {
    const targetNote = (this.notes ?? []).find((note: any) => note.id === noteId);
    if (!targetNote) {
      return;
    }

    const nextFolderName = folderName === '__all__' ? '' : String(folderName ?? '').trim();
    const folderId = nextFolderName
      ? this.folders.find((folder) => folder.name === nextFolderName)?.id ?? null
      : null;

    if ((targetNote?.folder ?? '') === nextFolderName && this.normalizeFolderId(targetNote?.folder_id) === this.normalizeFolderId(folderId)) {
      return;
    }

    const now = Date.now();
    this.notes = (this.notes ?? []).map((note: any) => note.id === noteId ? { ...note, folder: nextFolderName, folder_id: folderId, last_modified: now } : note);
    this.noteService.markPendingMutation(noteId, 'move', now);
    this.rebuildFolders();
    this.syncFoldersManifest();
    this.persistNotes();
  }

  @HostListener('window:keydown', ['$event'])
  public handleDesktopShortcuts(event: KeyboardEvent): void {
    if (!this.should_display || this.app_requires_password) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const isTyping = this.isTypingTarget(target);
    const metaOrCtrl = event.metaKey || event.ctrlKey;

    if (metaOrCtrl && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.goToCreateNewNote();
      return;
    }

    if (metaOrCtrl && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.enterSearchMode();
      return;
    }

    if (!isTyping && event.key === '/') {
      event.preventDefault();
      this.enterSearchMode();
      return;
    }

    if (event.key === 'Escape') {
      if (this.searchMode) {
        event.preventDefault();
        this.exitSearchMode();
        return;
      }

      if (this.renamingFolderId) {
        event.preventDefault();
        this.cancelRenameFolder();
        return;
      }
    }

    if (isTyping || this.checkboxOpened || metaOrCtrl || event.altKey) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectRelativeNote(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectRelativeNote(-1);
      return;
    }

    if (event.key === 'Enter') {
      const selectedId = String(this.noteService.selectedNoteId ?? '').trim();
      if (selectedId) {
        event.preventDefault();
        this.openOrCheckbox(selectedId);
      }
    }
  }

  public folderChipCount(folderName: string): number {
    return (this.notes ?? []).filter((note: any) => (note?.folder ?? '') === folderName && !note?.deleted).length;
  }

  public getFavoritesCount(): number {
    return (this.notes ?? []).filter((note: any) => !!note?.favorite && !note?.deleted).length;
  }

  public rebuildFolders(): void {
    this.loadFolders(this.noteService.getNotesAppPassword());
  }

  public applyFilters(): void {
    const base = Array.isArray(this.notes) ? [...this.notes] : [];
    const scoped = base.filter((note: any) => {
      if (note?.deleted) return false;
      if (this.activeFolderName !== '__all__' && (note?.folder ?? '') !== this.activeFolderName) return false;
      if (this.activeFilter === 'favorites' && !note?.favorite) return false;
      if (this.search_query && this.search_query.trim().length > 0) {
        const q = this.search_query.toLowerCase();
        const title = String(note?.title ?? '').toLowerCase();
        const body = String(note?.text ?? '').toLowerCase();
        const folder = String(note?.folder ?? '').toLowerCase();
        return title.includes(q) || body.includes(q) || folder.includes(q);
      }
      return true;
    }).sort((a: any, b: any) => {
      const pinDiff = Number(!!b?.pinned) - Number(!!a?.pinned);
      if (pinDiff !== 0) return pinDiff;
      return Number(b?.last_modified ?? 0) - Number(a?.last_modified ?? 0);
    });
    this.filteredResults = scoped;
    this.persistUiState();
    this.restoreNotesListScroll();
  }

  public selectFolder(folderName: string): void {
    this.activeFolderName = folderName || '__all__';

    if (this.activeFolderName !== '__all__') {
      this.activeFilter = 'all';
    }

    this.applyFilters();
    this.persistUiState();
  }

  public setActiveFilter(filter: string | number | undefined | null): void {
    this.activeFilter = filter === 'favorites' ? 'favorites' : 'all';
    this.applyFilters();
    this.persistUiState();
  }


  public openFolderActions(event: Event, folder: Folder): void {
    event.preventDefault();
    event.stopPropagation();
    this.folderActionsEvent = event;
    this.folderActionsTarget = folder;
    this.folderActionsOpen = true;
  }

  public closeFolderActions(): void {
    this.folderActionsOpen = false;
    this.folderActionsEvent = null;
    this.folderActionsTarget = null;
  }

  public requestRenameFolder(folder: Folder): void {
    this.pendingRenameFolder = folder;
    this.closeFolderActions();
  }

  public handleFolderActionsDidDismiss(): void {
    const folder = this.pendingRenameFolder;
    this.pendingRenameFolder = null;
    this.closeFolderActions();

    if (!folder) {
      return;
    }

    this.beginRenameFolder(folder);
  }

  public beginRenameFolder(folder: Folder): void {
    this.renamingFolderId = folder.id ?? null;
    this.renamingFolderName = folder.name;
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      const input = document.getElementById(`folder-rename-${folder.id}`) as HTMLInputElement | null;
      if (!input) return;
      input.focus();
      input.select();
    });
  }

  public cancelRenameFolder(): void {
    this.renamingFolderId = null;
    this.renamingFolderName = '';
  }

  public async submitRenameFolder(folder: Folder): Promise<void> {
    const nextName = String(this.renamingFolderName ?? '').trim();
    const previousName = String(folder?.name ?? '').trim();

    if (!nextName) {
      this.cancelRenameFolder();
      return;
    }

    const existingFolder = this.folders.find((item) => item.id !== folder.id && item.name.toLowerCase() === nextName.toLowerCase());
    if (existingFolder) {
      this.cancelRenameFolder();
      this.selectFolder(existingFolder.name);
      return;
    }

    if (nextName === previousName) {
      this.cancelRenameFolder();
      return;
    }

    const now = Date.now();
    this.folders = this.folders
      .map((item) => item.id === folder.id ? { ...item, name: nextName, last_modified: now } : item)
      .sort((a, b) => a.name.localeCompare(b.name));

    this.notes = (this.notes ?? []).map((note: any) => {
      if (note?.folder_id !== folder.id && (note?.folder ?? '') !== previousName) {
        return note;
      }
      return { ...note, folder: nextName, folder_id: folder.id, last_modified: now };
    });

    if (this.activeFolderName === previousName) {
      this.activeFolderName = nextName;
    }

    this.noteService.setFolders(JSON.stringify(this.folders));
    this.syncFoldersManifest();
    this.persistNotes();
    this.cancelRenameFolder();
  }

  public handleRenameFolderKeydown(event: KeyboardEvent, folder: Folder): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submitRenameFolder(folder);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelRenameFolder();
    }
  }

  public async promptCreateFolder(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'New folder',
      inputs: [{ name: 'name', type: 'text', placeholder: 'Folder name' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Create',
          handler: (data: any) => {
            const name = String(data?.name ?? '').trim();
            if (!name) return false;
            if (this.folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
              this.selectFolder(this.folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase())?.name ?? '__all__');
              return true;
            }
            const now = Date.now();
            const storedFolders = this.getStoredFolders(this.noteService.getNotesAppPassword());
            const existing = storedFolders.find((folder) => (folder.name ?? '').toLowerCase() === name.toLowerCase());
            const folder = existing
              ? { ...existing, name, last_modified: now, deleted: false }
              : { id: crypto?.randomUUID?.() ?? String(now), name, last_modified: now, deleted: false };
            const nextFolders = [...storedFolders.filter((item) => (item.name ?? '').toLowerCase() !== name.toLowerCase()), folder];
            const rawFolders = JSON.stringify(nextFolders);
            if (this.noteService.appHasPasswordChallenge()) {
              this.noteService.setFolders(this.cryptoService.encrypt(rawFolders, this.noteService.getNotesAppPassword()));
            } else {
              this.noteService.setFolders(rawFolders);
            }
            this.rebuildFolders();
            this.syncFoldersManifest();
            this.selectFolder(name);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptDeleteFolder(folderName: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete folder',
      message: `Delete "${folderName}"? Notes will be moved to All Notes.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            const now = Date.now();
            this.notes = (this.notes ?? []).map((note: any) => (note?.folder === folderName ? { ...note, folder: '', folder_id: null, last_modified: now } : note));
            const storedFolders = this.getStoredFolders(this.noteService.getNotesAppPassword()).filter((folder) => (folder.name ?? '').toLowerCase() !== folderName.toLowerCase());
            const targetFolder = this.folders.find((folder) => String(folder?.name ?? '').trim().toLowerCase() === folderName.trim().toLowerCase());
            const deletedFolder = { id: String(targetFolder?.id ?? '').trim() || (crypto?.randomUUID?.() ?? String(now)), name: folderName, last_modified: now, deleted: true };
            const nextFolders = [...storedFolders, deletedFolder];
            const rawFolders = JSON.stringify(nextFolders);
            if (this.noteService.appHasPasswordChallenge()) {
              this.noteService.setFolders(this.cryptoService.encrypt(rawFolders, this.noteService.getNotesAppPassword()));
            } else {
              this.noteService.setFolders(rawFolders);
            }
            this.rebuildFolders();
            this.syncFoldersManifest();
            this.persistNotes();
            this.selectFolder('__all__');
          }
        }
      ]
    });
    await alert.present();
  }

  public async togglePinnedFromHome(event: Event, noteId: string): Promise<void> {
    event.stopPropagation();
    const now = Date.now();
    this.notes = (this.notes ?? []).map((note: any) => note.id === noteId ? { ...note, pinned: !note?.pinned, last_modified: now } : note);
    this.noteService.markPendingMutation(noteId, 'pin', now);
    this.persistNotes();
  }

  public async toggleFavoriteFromHome(event: Event, noteId: string): Promise<void> {
    event.stopPropagation();
    const now = Date.now();
    this.notes = (this.notes ?? []).map((note: any) => note.id === noteId ? { ...note, favorite: !note?.favorite, last_modified: now } : note);
    this.noteService.markPendingMutation(noteId, 'favorite', now);
    this.persistNotes();
  }

  public async moveNoteToFolderFromHome(event: Event, noteId: string): Promise<void> {
    event.stopPropagation();
    const inputs: any[] = [
      { label: 'All Notes', type: 'radio', value: '__all__', checked: true },
      ...this.folders.map((folder) => ({ label: folder.name, type: 'radio', value: folder.name, checked: false })),
    ];
    const alert = await this.alertCtrl.create({
      header: 'Move to folder',
      inputs,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Move',
          handler: (selectedFolder: string) => {
            this.assignNoteToFolder(noteId, selectedFolder).then(() => {});
          }
        }
      ]
    });
    await alert.present();
  }

  public onNoteDragStart(event: DragEvent, note: any): void {
    if (!note?.id || this.checkboxOpened) {
      event.preventDefault();
      return;
    }

    this.draggingNoteId = note.id;
    this.draggingFolderTarget = null;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', note.id);
    }
  }

  public onNoteDragEnd(): void {
    this.draggingNoteId = null;
    this.draggingFolderTarget = null;
  }

  public onFolderDragOver(event: DragEvent, folderName: string): void {
    if (!this.draggingNoteId) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.draggingFolderTarget = folderName;
  }

  public onFolderDragLeave(folderName: string): void {
    if (this.draggingFolderTarget === folderName) {
      this.draggingFolderTarget = null;
    }
  }

  public onFolderDrop(event: DragEvent, folderName: string): void {
    event.preventDefault();
    const noteId = event.dataTransfer?.getData('text/plain') || this.draggingNoteId;
    const targetFolder = folderName === '__all__' ? '' : folderName;

    this.draggingFolderTarget = null;
    this.draggingNoteId = null;

    if (!noteId) {
      return;
    }

    this.assignNoteToFolder(noteId, targetFolder).then(() => {});
  }

  private syncFoldersManifest(): void {
    this.uploadFoldersState().then(() => {});
  }

  private persistNotes(): void {
    if (this.noteService.appHasPasswordChallenge()) {
      const encryptedNotesSave = this.cryptoService.encrypt(JSON.stringify(this.notes), this.noteService.getNotesAppPassword());
      this.noteService.setNotes(encryptedNotesSave);
    } else {
      this.noteService.setNotes(JSON.stringify(this.notes));
    }
    this.applyFilters();
    this.noteService.setNoteIsUpdatedSubject(true);
  }

  public settings() {
    this.navController.navigateForward("app-settings").then((r) => {});
  }

  goToProfile() {
    this.navController.navigateForward("profile").then((r) => {});
  }

  public openOrCheckbox(note_id: string) {
    if (!this.checkboxOpened) {
      this.noteId = note_id;
      this.noteService.selectedNoteId = note_id;
      this.persistUiState();
      // this.navController.navigateForward("/note/" + note_id).then((r) => {});
      this.navController.navigateForward('/dummy-route').then(() => {
        this.navController.navigateForward("/note/" + note_id);
      });
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
  private async deleteNotesConfirm(id:any = '') {
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
        .then(async () => {
          this.listOfCheckedCheckboxes = [];
          this.checkboxOpened = false;
          this.cdr.detectChanges();
          if(this.noteId == id || id == this.noteService.currentNote?.id) {
            await this.navController.navigateForward('/');
          }
          setTimeout(() => {
            this.initializePressGesture()
          }, 500);
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

      // case 'lock':
      //   this.lockNote(note);
      //   break;

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

  async shareNote(note: any) {
    const addSecretModal = new Secret();
    const secret_id = uuidv4();

    addSecretModal.expires_at = '0';
    addSecretModal.id = sha512(secret_id);

    let secretMessage = note?.text.replace(/<br ?\/?>/g, '\n');
    const doc = new DOMParser().parseFromString(secretMessage, 'text/html');
    secretMessage = doc.body?.textContent?.trim() || '';

    addSecretModal.message = CryptoJS.AES.encrypt(secretMessage, secret_id).toString();

    const modal = await this.modalCtrl.create({
      component: ShareSecretModalComponent,
      componentProps: { addSecretModal, secret_id },
      cssClass: 'secret-modal',
    });

    await modal.present();
  }

  async deleteNote(id: string) {
    console.log('Delete note', id);
    const modal = await this.modalCtrl.create({
      component: DeleteNoteModalComponent,
      cssClass: 'confirmation-popup',
      componentProps: { isSingleDelete: true },
    });

    modal.onDidDismiss().then(async (data) => {
      if (data && data.data) {
        const { confirm } = data.data;
        if (confirm) {
          this.selectNote(null, id);
          this.deleteNotesConfirm(id);
        }
      }
    });

    return await modal.present();
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
    const extras = this.activeFolderName !== "__all__" ? { queryParams: { folder: this.activeFolderName } } : undefined;
    this.router.navigate(["/dummy-route"]);
    setTimeout(() => {
      this.router.navigate(["/note"], extras as any);
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
    this.activeFolderName = '__all__';
    this.activeFilter = 'all';
    this.search_query = '';
    this.searchMode = false;
    this.persistUiState();
    setTimeout(async () => {
      // window.location.href = "/home";
      await this.navController.navigateRoot('/home');
    });
  }
}
