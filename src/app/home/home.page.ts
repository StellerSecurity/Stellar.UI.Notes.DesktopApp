import { NoteListWindow, NoteListRow } from '../utils/note-list-window';
import { FolderOrder, FolderSort } from '../utils/folder-order';
import { translateText as t } from '../i18n';
import { desktopNoteDate, desktopNoteMonth, selectionRange } from '../utils/desktop-note-presentation';
import { AppSettingsPage } from '../app-settings/app-settings.page';
import { nextNoteVersion } from '../utils/note-version';
import { unwrapLocalAppKey, wrapLocalAppKey, isModernLocalAppKey } from '../utils/local-app-key';
import { NoteV1 } from '../models/NoteV1';
import { matchesNoteSearch, noteSearchText, notePreviewText } from '../utils/note-search';
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
import { Subscription, auditTime, filter } from "rxjs";

// 🔐 from main branch
import { NotesApiV1Service } from "../services/notes-api-v1.service";
import { SecureStorageService } from "../services/secure-storage.service";
import { DataService } from "../services/data.service";
import { AuthService } from "../services/auth.service";
import { RemoteDownloadSyncService } from "../services/remote-download-sync.service";
import { SyncWorkerService } from '../services/sync-worker.service';
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
import { uuidv4 } from '../utils/uuid';
const CryptoJS = require('crypto-js');

@Component({ standalone: false,
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
  public sidebarHidden = localStorage.getItem('stellarNotesSidebar') === 'hidden';
  public accountEmail = '';
  public appUnlockError = '';
  public selectionAnchor = '';
  public focusedNoteId = '';
  public folderDialogOpen = false;
  public folderDialogName = '';
  public folderDialogError = '';
  public folderDialogTarget: Folder | null = null;
  public moveDialogOpen = false;
  public moveTarget = '__all__';
  private moveIds: string[] = [];
  private createThenMove = false;
  private displayCache = new WeakMap<object, {title: string; text: string; preview: string; heading: string}>();
  public readonly noteDate = desktopNoteDate;
  public readonly noteMonth = desktopNoteMonth;
  private noteWindow?: NoteListWindow;
  private virtualScrollTop = 0;
  private virtualViewportHeight = 640;
  private scrollPersistTimer?: ReturnType<typeof setTimeout>;
  private searchCache?: WeakMap<object, {title: string; text: string; folder: string; protected: boolean; fields: string[]}>;
  private folderOrder = new FolderOrder();
  public folderSortOpen = false;
  public folderSortEvent?: Event;
  public draggingSidebarFolderId: string | null = null;
  public folderReorderTarget: string | null = null;
  public folderReorderAfter = false;
  private get folderOrdering(): FolderOrder { return this.folderOrder ?? (this.folderOrder = new FolderOrder()); }
  public get folderSortMode() { return this.folderOrdering.mode; }
  public sortFolders(mode: FolderSort): void { this.folders = this.folderOrdering.select(mode,this.folders); this.folderSortOpen = false; }
  public startFolderDrag(event: DragEvent, folder: Folder): void {
    event.stopPropagation(); if (!folder.id) return; this.draggingSidebarFolderId = folder.id;
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-stellar-folder',folder.id); }
  }
  public endFolderDrag(): void { this.draggingSidebarFolderId = null; this.folderReorderTarget = null; }
  public overSidebarFolder(event: DragEvent, folder: Folder): void {
    if (!this.draggingSidebarFolderId) { this.onFolderDragOver(event,folder.name); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.folderReorderTarget = folder.id || null;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.folderReorderAfter = event.clientY > rect.top + rect.height / 2;
  }
  public dropSidebarFolder(event: DragEvent, folder: Folder): void {
    if (!this.draggingSidebarFolderId) { void this.onFolderDrop(event,folder.name); return; }
    event.preventDefault(); event.stopPropagation();
    this.folders = this.folderOrdering.move(this.folders,this.draggingSidebarFolderId,folder.id || '',this.folderReorderAfter);
    this.endFolderDrag();
  }
  public renameFolderFromKeyboard(event: Event, folder: Folder): void {
    event.preventDefault(); event.stopPropagation(); this.requestRenameFolder(folder);
  }
  private updateNoteWindow(): NoteListWindow {
    const view = this.noteWindow ?? (this.noteWindow = new NoteListWindow());
    view.update(this.getNotes(),this.activeFolderName === '__all__',this.virtualScrollTop || 0,this.virtualViewportHeight || 640);
    return view;
  }
  public get visibleNoteRows(): NoteListRow[] { return this.updateNoteWindow().visible; }
  public get topNoteSpacer(): number { return this.updateNoteWindow().top; }
  public get bottomNoteSpacer(): number { return this.updateNoteWindow().bottom; }
  public trackVisibleRow(_index: number, row: NoteListRow): string { return row.key; }
  public trackFolderById(_index: number, folder: Folder): string { return folder.id || folder.name; }
  private focusNoteRow(id: string): void {
    const list = this.notesListScroll?.nativeElement, row = this.updateNoteWindow().position(id);
    if (list && row) {
      if (row.offset < list.scrollTop) list.scrollTop = row.offset;
      else if (row.offset + row.height > list.scrollTop + list.clientHeight) list.scrollTop = row.offset + row.height - list.clientHeight;
      this.captureNoteViewport();
      this.cdr.detectChanges();
    }
    document.getElementById(id)?.focus({preventScroll:true});
  }
  public notes: any[] = [];

  public should_display = true;
  public checkboxOpened = false;
  public listOfCheckedCheckboxes: string[] = [];

  public app_requires_password = false;
  public showPassword = false;
  public input_password_app_unlock = "";

  public timezone = "UTC";
  public trashBusy=false;
  public get trashAvailable():boolean {return !!this.noteService.trashEnabled || this.trashEntries.length>0;}
  public get trashEntries(){return this.noteService.getTrash?.() ?? [];}
  public async openTrash():Promise<void> {
    await this.noteService.expireTrash();
    this.activeFilter='trash';this.activeFolderName='__all__';this.search_query='';this.searchType='all';this.listOfCheckedCheckboxes=[];
    this.noteService.selectedNoteId=null;this.noteService.isNoteTemporaryDescripted=false;
    localStorage.removeItem('recentOpenedNoteId');this.applyFilters();
    await this.router.navigate(['/home'],{queryParams:{view:'trash'}});
  }
  public get selectedTrashNote():any {const selected=this.selectedNotes();return selected.length===1?selected[0]:null;}
  public trashDaysLeft(note:any):number {return Math.max(0,Math.ceil((30*86400000-(Date.now()-note.last_modified))/86400000));}

  public async restoreTrashEntries(ids:string[]):Promise<void> {
    if(this.trashBusy)return;this.trashBusy=true;
    try {
      const restored=await this.noteService.restoreTrash(ids);
      this.setData(this.noteService.getNotesAppPassword());
      if(this.authService.isLoggedIn && restored.length)await this.notesApiServiceV1.upload(0,restored,undefined,[],true,true);
    } catch {const toast=await this.toastController.create({message:t('uiTheNoteCouldNotBeSavedKeepThis'),duration:5000,color:'danger'});await toast.present();}
    finally {this.trashBusy=false;}
  }
  public async permanentlyDeleteTrashSelection(ids=this.selectedNotes().map(note=>note.id)):Promise<void> {
    if(this.trashBusy || !ids.length)return;
    const modal=await this.modalCtrl.create({component:DeleteNoteModalComponent,cssClass:'confirmation-popup',componentProps:{isSingleDelete:ids.length===1,count:ids.length}});
    await modal.present();const result=await modal.onDidDismiss();
    if(result.data?.confirm) {this.trashBusy=true;try {await this.noteService.removeTrash(ids);this.applyFilters();}finally {this.trashBusy=false;}}
  }
  public restoreTrashSelection():void {void this.restoreTrashEntries(this.selectedNotes().map(note=>note.id));}
  public searchType: 'all'|'images'|'locked' = 'all';
  public searchFolderFilterOpen=false;
  public searchFolderQuery='';
  public searchFolderEvent?:Event;
  public get searchFolders():Folder[] {return this.folders.filter(folder=>normalize(folder.name).includes(normalize(this.searchFolderQuery)));}
  public chooseSearchType(type:'all'|'images'|'locked'):void {this.searchType=this.searchType===type?'all':type;this.search();}
  public clearSearchFilters():void {this.searchType='all';this.activeFolderName='__all__';if(this.activeFilter!=='trash')this.activeFilter='all';this.search();}
  public chooseSearchFolder(name:string):void {this.searchFolderFilterOpen=false;this.selectFolder(name);this.search();}
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
  public manualSyncRequests = 0;

  private previewSource?: any[];
  private previewSelectedId: string | null = null;
  private previewPassword: string | null = null;
  private previewNotes: any[] = [];

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
  public activeFilter: 'all' | 'favorites' | 'trash' = 'all';
  public folderActionsOpen = false;
  public folderActionsEvent: Event | null = null;
  public folderActionsTarget: Folder | null = null;
  private pendingRenameFolder: Folder | null = null;
  public renamingFolderId: string | null = null;
  public renamingFolderName = '';
  public draggingNoteIds: string[] = [];
  public dragPreviewX = 0;
  public dragPreviewY = 0;
  private dragGhost?: HTMLCanvasElement;
  public draggingFolderTarget: string | null = null;

  private readonly realtimeHint = () => { void this.syncFromServer('realtime').catch(() => {}); };

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
    private syncWorker: SyncWorkerService,
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
        activeFilter: this.activeFilter,
        selectedNoteIds: [...this.listOfCheckedCheckboxes],
        trashSelectionIds:this.activeFilter==='trash'?this.listOfCheckedCheckboxes:[],
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

    const savedFilter = saved?.activeFilter === 'trash' && this.trashAvailable ? 'trash' : saved?.activeFilter === 'favorites' ? 'favorites' : 'all';
    const savedFolderName = typeof saved?.activeFolderName === 'string' && saved.activeFolderName.trim().length > 0
      ? saved.activeFolderName.trim()
      : '__all__';
    const hasSavedFolder = savedFolderName === '__all__' || this.folders.some((folder) => folder.name === savedFolderName);

    this.activeFilter = savedFilter;
    const selection = savedFilter === 'trash' ? saved?.trashSelectionIds : saved?.selectedNoteIds;
    if (Array.isArray(selection)) this.listOfCheckedCheckboxes = selection.filter((id: unknown) => typeof id === 'string');
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

  private async restoreLastOpenNote():Promise<void> {
    if(this.noteService.restoreLastNoteAttempted || this.noteService.shouldAskForPassword())return;
    this.noteService.restoreLastNoteAttempted=true;
    if(!/^\/(?:home)?(?:[?#]|$)/.test(this.router.url))return;
    const id=localStorage.getItem('recentOpenedNoteId');
    const note=(this.notes ?? []).find(note=>note.id===id && !note.deleted);
    if(!note) {if(id)localStorage.removeItem('recentOpenedNoteId');return;}
    if(!this.getNotes().some(item=>item.id===id)) {
      this.activeFilter='all';this.activeFolderName='__all__';this.search_query='';this.searchType='all';this.applyFilters();
    }
    this.noteId=this.noteService.selectedNoteId=note.id;this.listOfCheckedCheckboxes=[note.id];this.focusedNoteId=note.id;
    await this.router.navigate(['/note',note.id],{replaceUrl:true});
    this.pendingRestoreScrollTop=null;this.focusNoteRow(note.id);this.persistUiState();
  }

  private restoreNotesListScroll(): void {
    if (this.pendingRestoreScrollTop == null) {
      return;
    }

    const scrollTop = this.pendingRestoreScrollTop;
    setTimeout(() => {
      if(this.pendingRestoreScrollTop!==scrollTop)return;
      const container = this.notesListScroll?.nativeElement;
      if (!container) {
        return;
      }
      container.scrollTop = scrollTop;
      this.captureNoteViewport();
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

  private async requestImmediateSync(reason: 'enter' | 'resume' | 'online' | 'manual' | 'realtime' = 'manual'): Promise<void> {
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

    if (reason === 'manual') this.manualSyncRequests++;
    try {
      const didSync = await this.remoteDownloadSync.requestImmediateSync(reason === 'enter' ? 'resume' : reason);

      if (didSync) {
        // Refresh records against the current selection and filters. Restoring a
        // saved view here can overwrite interactions made while the request ran.
        this.setData(this.noteService.getNotesAppPassword());
        this.clearSyncUiState({ clearForceDownload: true });
        return;
      }

      this.clearSyncUiState({ clearForceDownload: !this.authService.isLoggedIn });
    } finally {
      if (reason === 'manual') this.manualSyncRequests--;
    }
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

  private captureNoteViewport(): void {
    const list = this.notesListScroll?.nativeElement;
    if (list) { this.virtualScrollTop = list.scrollTop; this.virtualViewportHeight = list.clientHeight || 640; }
  }
  @HostListener('window:resize')
  public onNotesListResize(): void { this.captureNoteViewport(); }

  public onNotesListScroll(): void {
    this.captureNoteViewport();
    clearTimeout(this.scrollPersistTimer);
    this.scrollPersistTimer = setTimeout(() => this.persistUiState(),180);
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

    this.folders = this.folderOrdering.sort(Array.from(folderMap.values()));

    if (this.activeFolderName !== '__all__'
      && !this.folders.some((folder) => folder.name === this.activeFolderName)) {
      this.activeFolderName = '__all__';
    }
  }

  // --------------------------------------------------
  // Lifecycle
  // --------------------------------------------------
  async ionViewWillEnter() {
    await this.authService.initializeAuthState();
    try { this.accountEmail = JSON.parse(await this.secureStorageService.getItem('ssUser') || '{}').email || ''; }
    catch { this.accountEmail = ''; }
    window.addEventListener('stellar:notes-changed', this.realtimeHint);
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
      await this.restoreLastOpenNote();
      if (this.shouldAttemptRemoteDownload()) {
        await this.requestImmediateSync('enter'); // keep interactions made while the download ran
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
      this.captureNoteViewport();
      this.allTranslations = this.translatorService.allTranslations;
    }, 300)
  }

  ionViewDidEnter() {
    void this.noteService.expireTrash?.().catch(()=>{});
    this.initializePressGesture();
    this.subscribeNoteIdOnRouteChange();
  }

  ionViewWillLeave() {
    this.onNoteDragEnd();
    clearTimeout(this.scrollPersistTimer);
    this.endFolderDrag();
    window.removeEventListener('stellar:notes-changed', this.realtimeHint);
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
          const match = this.router.url.match(/\/note\/([^?/#]+)/);
          const id = match ? decodeURIComponent(match[1]) : null;
          this.noteId = this.noteService.selectedNoteId = id;
          if (id && this.listOfCheckedCheckboxes.length < 2) this.listOfCheckedCheckboxes = [id];
          if (this.noteId) localStorage.setItem("recentOpenedNoteId",this.noteId);
          this.persistUiState();
        })
    );
  }

  subscribeNoteUpdated(): void {
    this.subscriptions.push(
      // Only batch sidebar rendering. The editor still persists every edit immediately.
      this.noteService.noteIsUpdated$.pipe(auditTime(100)).subscribe((value) => {
        if (value) {
          this.setData(this.noteService.getNotesAppPassword());
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
    if (!this.search_query.trim()) {
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
    if (this.notesListScroll) this.notesListScroll.nativeElement.scrollTop = 0;
    this.virtualScrollTop = 0;
    this.isSearching = !!this.search_query.trim();
    this.pauseSync = this.isSearching;
    this.applyFilters();
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

  async syncFromServer(reason: 'enter' | 'resume' | 'online' | 'manual' | 'realtime' = 'resume') {
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
    this.appUnlockError = '';
    if (!this.input_password_app_unlock.length) {
      this.appUnlockError = t('uiPleaseEnterYourPassword');
      return false;
    }

    this.noteService.increaseAppNoteAttemptsFailedPasswords();
    if (this.noteService.shouldWipeAllNotesOrNot()) {
      await this.noteService.clearLocalPersistence();
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
      await this.noteService.flushPersistence();
      await this.noteService.expireTrash();
      await this.restoreLastOpenNote();

      // 🔐 load & import MK (from main branch)
      try {
        let eakB64 = await this.secureStorageService.getItem(
          "ssEakB64_Encrypted"
        );
        if (eakB64) {
          // Password validation above must succeed before legacy key migration.
          const unlocked = await unwrapLocalAppKey(eakB64, this.input_password_app_unlock,
            (value, password) => this.cryptoService.decrypt(value, password));
          if (!isModernLocalAppKey(eakB64)) {
            await this.secureStorageService.setItem('ssEakB64_Encrypted',
              await wrapLocalAppKey(unlocked, this.input_password_app_unlock));
          }
          eakB64 = unlocked;
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
      this.appUnlockError = this.allTranslations?.passwordIsNotCorrectTryAgain || t('uiIncorrectPasswordPleaseTryAgain');
      return false;
    }

    return true;
  }

  /** Filtering and sorting run on data/filter changes, never during rendering. */
  getNotes() {
    const source = this.filteredResults;
    if (!Array.isArray(source)) return [];
    const selectedId = this.noteService.isNoteTemporaryDescripted ? this.noteService.selectedNoteId : null;
    const password = selectedId ? this.noteService.notesPasswordStored : null;
    if (source === this.previewSource && selectedId === this.previewSelectedId && password === this.previewPassword) {
      return this.previewNotes;
    }
    this.previewSource = source;
    this.previewSelectedId = selectedId;
    this.previewPassword = password;
    // Never replace the encrypted source records with a temporary display preview.
    this.previewNotes = password ? source.map((note: any) => {
      if (note?.id !== selectedId || !note?.protected) return note;
      try {
        return {...note, title: this.cryptoService.decrypt(note.title, password),
          text: this.cryptoService.decrypt(note.text, password), isDescripted: true};
      } catch {
        return note;
      }
    }) : source;
    return this.previewNotes;
  }

  public trackNoteById(_index: number, note: NoteV1): string { return note.id; }

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
    await this.assignNotesToFolder([noteId], folderName);
  }

  private async assignNotesToFolder(noteIds: readonly string[], folderName: string): Promise<void> {
    const ids = new Set(noteIds);
    if (!ids.size) return;
    const stored = this.noteService.getNotes();
    const raw = this.noteService.appHasPasswordChallenge()
      ? this.cryptoService.decrypt(stored, this.noteService.getNotesAppPassword()) : stored;
    const latest = JSON.parse(raw || '[]');
    if (!Array.isArray(latest)) throw new Error('Invalid notes storage');
    this.notes = latest;
    const nextFolderName = folderName === '__all__' ? '' : String(folderName ?? '').trim();
    const folderId = nextFolderName
      ? this.folders.find((folder) => folder.name === nextFolderName)?.id ?? null
      : null;

    const now = nextNoteVersion(this.notes ?? []);
    const changedIds: string[] = [];
    this.notes = this.notes.map((note: any) => {
      if (!ids.has(note.id) || note.deleted || ((note.folder ?? '') === nextFolderName && this.normalizeFolderId(note.folder_id) === this.normalizeFolderId(folderId))) return note;
      changedIds.push(note.id);
      return { ...note, folder: nextFolderName, folder_id: folderId, last_modified: now };
    });
    if (!changedIds.length) return;
    for (const id of changedIds) this.noteService.markPendingMutation(id, 'move', now);
    this.rebuildFolders();
    this.syncFoldersManifest();
    // Persist the entire group together before filtering can remove moved rows.
    this.persistNotes();
    if (changedIds.includes(this.noteService.currentNote?.id)) {
      Object.assign(this.noteService.currentNote, { folder: nextFolderName, folder_id: folderId, last_modified: now });
    }
  }

  public toggleSidebar(): void {
    this.sidebarHidden = !this.sidebarHidden;
    localStorage.setItem('stellarNotesSidebar', this.sidebarHidden ? 'hidden' : 'shown');
  }

  public shortcut(key: string): string {
    return /Mac/i.test(navigator.platform) ? key.replace('Ctrl+', '⌘').replace('Alt+', '⌥') : key;
  }

  public isNoteSelected(id: string): boolean {
    return this.listOfCheckedCheckboxes.length ? this.listOfCheckedCheckboxes.includes(id) : this.noteService.selectedNoteId === id;
  }

  public selectedNotes(): any[] {
    const ids = new Set(this.listOfCheckedCheckboxes.length ? this.listOfCheckedCheckboxes : [this.noteService.selectedNoteId]);
    return this.getNotes().filter(note => ids.has(note.id));
  }
  public allSelectedFavorite(): boolean { return this.selectedNotes().every(note => note.favorite); }
  public isNoteLocked(note: any): boolean {
    return !!note.protected && !(note.id === this.noteService.selectedNoteId && this.noteService.isNoteTemporaryDescripted);
  }
  private noteDisplay(note: any) {
    let cached = this.displayCache.get(note);
    if (!cached || cached.title !== note.title || cached.text !== note.text) {
      cached = { title: note.title, text: note.text, heading: notePreviewText(note.title || ''), preview: notePreviewText(note.text || '') };
      this.displayCache.set(note, cached);
    }
    return cached;
  }
  public noteHeading(note: any): string { return this.isNoteLocked(note) ? t('uiLockedNote') : (this.noteDisplay(note).heading || t('uiUntitledNote')); }
  public notePreview(note: any): string { return this.isNoteLocked(note) ? '' : this.noteDisplay(note).preview; }
  public viewCount(): number {
    if(this.activeFilter==='trash')return this.trashEntries.length;
    return (this.notes || []).filter(note => !note.deleted && (this.activeFolderName === '__all__' || note.folder === this.activeFolderName) && (this.activeFilter !== 'favorites' || note.favorite)).length;
  }
  public searchAllNotes(): void { this.activeFolderName = '__all__'; this.activeFilter = 'all'; this.applyFilters(); }

  public selectDesktopNote(event: MouseEvent | KeyboardEvent, note: any): void {
    if (this.noteService.editorFocusNoteId !== note.id) this.noteService.editorFocusNoteId = null;
    event.preventDefault();
    event.stopPropagation();
    const previous = this.listOfCheckedCheckboxes.length ? this.listOfCheckedCheckboxes : [this.noteService.selectedNoteId].filter(Boolean) as string[];
    if (event.shiftKey) {
      this.listOfCheckedCheckboxes = selectionRange(this.getNotes().map(n => n.id), this.selectionAnchor || previous[0], note.id);
    } else if (event.metaKey || event.ctrlKey) {
      this.listOfCheckedCheckboxes = previous.includes(note.id) ? previous.filter(id => id !== note.id) : [...previous, note.id];
      this.selectionAnchor = note.id;
    } else {
      this.listOfCheckedCheckboxes = [note.id];
      this.selectionAnchor = note.id;
    }
    this.focusedNoteId = note.id;
    this.applyDesktopSelection();
  }

  private applyDesktopSelection(): void {
    this.checkboxOpened = false;
    if(this.activeFilter==='trash'){this.cdr.detectChanges();return;}
    if (this.listOfCheckedCheckboxes.length === 1) {
      const id = this.listOfCheckedCheckboxes[0];
      if (this.noteService.selectedNoteId !== id || !this.router.url.includes('/note/')) this.openOrCheckbox(id);
    } else {
      // Leaving the editor destroys its plaintext view and relocks protected notes.
      this.noteService.isNoteTemporaryDescripted = false;
      this.noteService.notesPasswordStored = null;
      void this.router.navigate(['/home'], { queryParams: { selection: 'multiple' } });
    }
  }

  public onListKeydown(event: KeyboardEvent): void {
    const notes = this.getNotes();
    if (!notes.length) return;
    const ids = notes.map(n => n.id);
    const index = Math.max(0, ids.indexOf(this.focusedNoteId || this.noteService.selectedNoteId));
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation();
      this.listOfCheckedCheckboxes = ids;
      this.applyDesktopSelection();
      return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? notes.length - 1 : event.key === 'ArrowDown' ? Math.min(index + 1, notes.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : -1;
    if (next >= 0) {
      this.selectDesktopNote(event, notes[next]);
      this.focusNoteRow(notes[next].id);
    } else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (this.listOfCheckedCheckboxes.length !== 1 || !this.isNoteSelected(notes[index].id)) this.selectDesktopNote(event, notes[index]);
      if(this.activeFilter==='trash')return;
      this.noteService.editorFocusNoteId = notes[index].id;
      this.cdr.detectChanges();
    } else if (event.key === ' ') {
      this.selectDesktopNote(event, notes[index]);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault(); event.stopPropagation();
      void this.openContextMenu(event as any, notes[index]);
    }
  }

  @HostListener('window:keydown', ['$event'])
  public handleDesktopShortcuts(event: KeyboardEvent): void {
    if (!this.should_display || document.querySelector('ion-modal.show-modal, ion-alert, ion-popover.show-popover')) return;
    const key = event.key.toLowerCase();
    const command = event.metaKey || event.ctrlKey;
    if (command && event.altKey && key === 's') { event.preventDefault(); this.toggleSidebar(); return; }
    if (command && key === ',') { event.preventDefault(); void this.settings(); return; }
    if (command && key === 'n') { event.preventDefault(); this.goToCreateNewNote(); return; }
    if (command && (key === 'f' || key === 'k')) { event.preventDefault(); this.enterSearchMode(); return; }
    if (this.isTypingTarget(event.target as HTMLElement) || event.isComposing) return;
    if ((event.target as HTMLElement)?.closest?.('[data-folder-id]')) return;
    if (key === 'escape' && this.listOfCheckedCheckboxes.length > 1) {
      event.preventDefault(); this.listOfCheckedCheckboxes = [this.focusedNoteId || this.listOfCheckedCheckboxes[0]]; this.applyDesktopSelection();
    } else if ((key === 'delete' || key === 'backspace') && this.selectedNotes().length) {
      event.preventDefault(); if (event.repeat) return;
      this.listOfCheckedCheckboxes = this.selectedNotes().map(n => n.id); void this.deleteSelectedNotes();
    } else if (key === '/') { event.preventDefault(); this.enterSearchMode(); }
  }

  public async favoriteSelection(ids = this.selectedNotes().map(n => n.id)): Promise<void> {
    const all = (this.notes || []).filter(n => ids.includes(n.id)).every(n => n.favorite);
    for (const id of ids) {
      const note = (this.notes || []).find(n => n.id === id);
      if (note && !!note.favorite === all) await this.toggleNoteFlag(id, 'favorite');
    }
  }

  public openMoveDialog(ids = this.selectedNotes().map(n => n.id)): void {
    this.moveIds = [...ids]; this.moveTarget = '__all__'; this.moveDialogOpen = true;
  }
  public async onMoveFolderPicked(pick:{folderName:string;create:boolean}):Promise<void> {
    if(pick.create) {
      const existing=this.folders.find(folder=>folder.name.toLocaleLowerCase()===pick.folderName.toLocaleLowerCase());
      if(existing)this.moveTarget=existing.name;
      else {
        this.folderDialogName=pick.folderName;this.folderDialogTarget=null;this.createThenMove=true;
        await this.saveFolderDialog();this.moveDialogOpen=false;return;
      }
    } else this.moveTarget=pick.folderName;
    await this.confirmMove();
  }
  public async confirmMove(): Promise<void> {
    await this.assignNotesToFolder(this.moveIds, this.moveTarget);
    this.moveDialogOpen = false;
  }
  public newFolderForMove(): void {
    this.moveDialogOpen = false; this.createThenMove = true; void this.promptCreateFolder();
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

  private cachedSearchFields(note: any): string[] {
    const cache = this.searchCache ?? (this.searchCache = new WeakMap());
    const old = cache.get(note), title = note.title || '', text = note.text || '', folder = note.folder || '', protectedNote = !!note.protected;
    if (old && old.title === title && old.text === text && old.folder === folder && old.protected === protectedNote) return old.fields;
    const fields = [normalize(title),normalize(folder),protectedNote ? '' : noteSearchText(text)];
    cache.set(note,{title,text,folder,protected:protectedNote,fields}); return fields;
  }

  public applyFilters(): void {
    const base = this.activeFilter==='trash' ? this.trashEntries.map(entry=>({...entry.note,id:entry.id,last_modified:entry.trashedAt,pinned:false,favorite:false})) : Array.isArray(this.notes) ? [...this.notes] : [];
    const terms = normalize(this.search_query ?? '').split(' ').filter(Boolean);
    const scoped = base.filter((note: any) => {
      if (note?.deleted) return false;
      if (this.searchType === 'locked' && !note.protected) return false;
      if (this.searchType === 'images' && (note.protected || !/<img\b/i.test(note.text || ''))) return false;
      if (this.activeFolderName !== '__all__' && (note?.folder ?? '') !== this.activeFolderName) return false;
      if (this.activeFilter === 'favorites' && !note?.favorite) return false;
      if (terms.length > 0) {
        const fields = this.cachedSearchFields(note);
        return matchesNoteSearch(terms,fields[0],fields[1],fields[2],!!note.protected);
      }
      return true;
    }).sort((a: any, b: any) => {
      const pinDiff = Number(!!b?.pinned) - Number(!!a?.pinned);
      if (pinDiff !== 0) return pinDiff;
      return Number(b?.last_modified ?? 0) - Number(a?.last_modified ?? 0);
    });
    this.filteredResults = scoped;
    this.listOfCheckedCheckboxes = (this.listOfCheckedCheckboxes || []).filter(id => scoped.some(note => note.id === id));
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
    if (this.activeFilter === 'favorites') this.activeFolderName = '__all__';
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
    this.closeFolderActions();
    this.folderDialogTarget = folder; this.folderDialogName = folder.name;
    this.folderDialogError = ''; this.folderDialogOpen = true;
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

    const now = nextNoteVersion(this.notes ?? []);
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

    const rawFolders = JSON.stringify(this.folders);
    this.noteService.setFolders(this.noteService.appHasPasswordChallenge()
      ? this.cryptoService.encrypt(rawFolders, this.noteService.getNotesAppPassword()) : rawFolders);
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
    this.folderDialogTarget = null; this.folderDialogName = ''; this.folderDialogError = ''; this.folderDialogOpen = true;
  }

  public focusFolderName(event: Event): void {
    const input = (event.target as HTMLElement | null)?.querySelector<HTMLInputElement>('#folder-name');
    input?.focus();
    if (this.folderDialogTarget) input?.select();
  }

  public closeFolderDialog(): void {
    this.folderDialogOpen = false; this.createThenMove = false;
  }

  public async saveFolderDialog(): Promise<void> {
    const name = this.folderDialogName.trim();
    if (!name) { this.folderDialogError = t('uiEnterAFolderName'); return; }
    if (this.folders.some(folder => folder.id !== this.folderDialogTarget?.id && folder.name.toLowerCase() === name.toLowerCase())) {
      this.folderDialogError = t('uiAFolderWithThisNameAlreadyExists'); return;
    }
    if (this.folderDialogTarget) {
      this.renamingFolderName = name;
      await this.submitRenameFolder(this.folderDialogTarget);
    } else {
      const now = nextNoteVersion(this.notes || []);
      const stored = this.getStoredFolders(this.noteService.getNotesAppPassword());
      const previous = stored.find(folder => folder.name.toLowerCase() === name.toLowerCase());
      const folder = { id: previous?.id || crypto.randomUUID(), name, last_modified: now, deleted: false };
      const raw = JSON.stringify([...stored.filter(item => item.id !== folder.id), folder]);
      this.noteService.setFolders(this.noteService.appHasPasswordChallenge() ? this.cryptoService.encrypt(raw, this.noteService.getNotesAppPassword()) : raw);
      this.rebuildFolders(); this.syncFoldersManifest();
      if (this.createThenMove) {
        await this.assignNotesToFolder(this.moveIds, name);
      }
      this.selectFolder(name);
    }
    this.closeFolderDialog();
  }

  public async promptDeleteFolder(folderName: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: t('uiDeleteFolder'),
      cssClass: 'folder-delete-confirm',
      message: t('uiDeleteFolderNotice'),
      buttons: [
        { text: t('cancel'), role: 'cancel' },
        {
          text: t('delete'),
          role: 'destructive',
          handler: async () => {
            const now = nextNoteVersion(this.notes ?? []);
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
    alert.querySelector<HTMLButtonElement>('button.alert-button-role-destructive')?.focus();
  }

  public async togglePinnedFromHome(event: Event, noteId: string): Promise<void> {
    event.stopPropagation();
    await this.toggleNoteFlag(noteId, 'pinned');
  }

  public async toggleFavoriteFromHome(event: Event, noteId: string): Promise<void> {
    event.stopPropagation();
    await this.toggleNoteFlag(noteId, 'favorite');
  }

  private async toggleNoteFlag(noteId: string, flag: 'favorite' | 'pinned'): Promise<void> {
    try {
      // The sidebar can lag behind the open editor. Always mutate the durable note,
      // retaining its current text, protection and other metadata.
      const stored = this.noteService.getNotes();
      const raw = this.noteService.appHasPasswordChallenge()
        ? this.cryptoService.decrypt(stored, this.noteService.getNotesAppPassword()) : stored;
      const notes = JSON.parse(raw || '[]');
      if (!Array.isArray(notes)) throw new Error('Invalid notes storage');
      const current = notes.find((note: any) => note.id === noteId && !note.deleted);
      if (!current) return;
      const changed = { ...current, [flag]: !current[flag], last_modified: nextNoteVersion(notes) };
      this.notes = notes.map((note: any) => note.id === noteId ? changed : note);
      this.noteService.markPendingMutation(noteId, flag === 'pinned' ? 'pin' : 'favorite', changed.last_modified);
      this.persistNotes();
      // The open editor shares this object; its next keystroke must retain the flag.
      if (this.noteService.currentNote?.id === noteId) {
        Object.assign(this.noteService.currentNote, { [flag]: changed[flag], last_modified: changed.last_modified });
      }
      if (this.authService.isLoggedIn) {
        await this.notesApiServiceV1.upload(0, [changed], undefined, [], true, true);
        await this.syncWorker.trySync();
      }
    } catch {
      this.noteService.syncNeedsAttention$.next(true);
      const toast = await this.toastController.create({
        message: t('uiTheChangeCouldNotBeSyncedPleaseTry'), duration: 5000, color: 'danger',
      });
      await toast.present();
    }
  }

  public async moveNoteToFolderFromHome(event: Event, noteId: string): Promise<void> {
    event.stopPropagation(); this.openMoveDialog([noteId]);
  }

  public onNoteDragStart(event: DragEvent, note: any): void {
    this.onNoteDragEnd();
    if (!note?.id || this.checkboxOpened) {
      event.preventDefault();
      return;
    }

    // Capture the group now: filtering or sync updates must not change a drag.
    this.draggingNoteIds = this.isNoteSelected(note.id) ? this.selectedNotes().map(item => item.id) : [note.id];
    if (!this.draggingNoteIds.length) this.draggingNoteIds = [note.id];

    this.onNoteDragMove(event);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-stellar-note-ids', JSON.stringify(this.draggingNoteIds));
      if (this.draggingNoteIds.length > 1) this.setNoteStackDragImage(event.dataTransfer, this.draggingNoteIds.length);
    }
  }

  @HostListener('document:dragover', ['$event'])
  public onNoteDragMove(event: DragEvent): void {
    if (!this.draggingNoteIds.length) return;
    // Handle internal drops throughout the app, including cancellation on empty
    // space. Otherwise macOS waits for its rejected-drop animation before dragend.
    if (event.type === 'dragover') {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
    this.dragPreviewX = Math.max(8, Math.min(event.clientX + 6, window.innerWidth - 256));
    this.dragPreviewY = Math.max(8, Math.min(event.clientY + 6, window.innerHeight - 90));
  }

  @HostListener('document:drop', ['$event'])
  public onNoteBackgroundDrop(event: DragEvent): void {
    if (!this.draggingNoteIds.length) return;
    event.preventDefault();
    this.onNoteDragEnd();
  }

  private setNoteStackDragImage(transfer: DataTransfer, _count: number): void {
    // Render the stack in the app: WebKit may omit a detached canvas drag image.
    // Suppress the native row ghost so it does not duplicate the visible stack.
    this.dragGhost = document.createElement('canvas');
    this.dragGhost.width = this.dragGhost.height = 1;
    this.dragGhost.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none';
    document.body.appendChild(this.dragGhost);
    transfer.setDragImage(this.dragGhost, 0, 0);
  }

  public onNoteDragEnd(): void {
    this.dragGhost?.remove();
    this.dragGhost = undefined;
    this.draggingNoteIds = [];
    this.draggingFolderTarget = null;
  }

  public onFolderDragOver(event: DragEvent, folderName: string): void {
    if (!this.draggingNoteIds.length) {
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

  public async onFolderDrop(event: DragEvent, folderName: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const ids = [...this.draggingNoteIds];
    const targetFolder = folderName === '__all__' ? '' : folderName;
    this.onNoteDragEnd();
    // Remove the stack before storage/encryption work can occupy this frame.
    this.cdr.detectChanges();
    // Only accept a drag started in this window and a current destination.
    if (!ids.length || (targetFolder && !this.folders.some(folder => folder.name === targetFolder))) return;
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (targetFolder && !this.folders.some(folder => folder.name === targetFolder)) return;
      await this.assignNotesToFolder(ids, targetFolder);
    } catch {
      this.noteService.syncNeedsAttention$.next(true);
      const toast = await this.toastController.create({ message: t('uiTheNotesCouldNotBeMovedPleaseTry'), duration: 5000, color: 'danger' });
      await toast.present();
    }
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

  public async settings(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: AppSettingsPage, cssClass: 'sn-compact-modal settings-modal' });
    await modal.present();
  }

  goToProfile() {
    this.navController.navigateForward("profile").then((r) => {});
  }

  public openOrCheckbox(note_id: string) {
    if (!this.checkboxOpened) {
      this.setSelectedNoteId(note_id);
      this.listOfCheckedCheckboxes = [note_id];
      this.persistUiState();
      void this.router.navigate(['/note', note_id]);
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
    if(this.activeFilter==='trash'){await this.permanentlyDeleteTrashSelection();return;}
    // @ts-ignore
    const modal = await this.modalCtrl.create({
      component: DeleteNoteModalComponent,
      cssClass: "confirmation-popup",
      componentProps: {
        isSingleDelete: this.listOfCheckedCheckboxes?.length == 1 || false,
        count: this.listOfCheckedCheckboxes.length,
        ...(this.noteService.trashEnabled ? {recoverable:true} : {}),
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
    const idsToDelete = new Set<string>(id ? [id] : this.listOfCheckedCheckboxes);

    const capturedIds = await this.noteService.captureTrash?.(this.notes.filter(note=>idsToDelete.has(note.id))) ?? [];
    for(const id of idsToDelete)this.noteService.markPendingMutation?.(id,'delete');
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

    await this.noteService.flushPersistence?.();
    // 🔐 delete on server if logged in (from main branch)
    if (this.authService.isLoggedIn) {
      this.notesApiServiceV1
        .deleteNotes([...idsToDelete])
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

    this.listOfCheckedCheckboxes = [];
    this.applyFilters();
    this.cdr.detectChanges();
    if (idsToDelete.has(this.noteService.selectedNoteId || '')) await this.router.navigate(['/home']);
    const toast = await this.toastController.create({
      message: capturedIds.length ? t('movedToTrash') : idsToDelete.size === 1
        ? this.allTranslations.theNoteHasBeenDeleted
        : this.allTranslations.theSelectedNotesHasBeenDeleted,
      buttons: capturedIds.length ? [{text:t('undo'),handler:()=>{void this.restoreTrashEntries(capturedIds);}}] : [],
      duration: 2500,
      position: "bottom",
    });

    await toast.present();

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
        message: t('uiResettingApp'),
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
    event.preventDefault(); event.stopPropagation();
    const ids = this.isNoteSelected(note.id) && this.selectedNotes().length > 1 ? this.selectedNotes().map(n => n.id) : [note.id];
    const popover = await this.popoverController.create({
      component: NoteContextMenuComponent,
      componentProps: { note, multiple: ids.length > 1, locked: this.isNoteLocked(note), allFavorite: (this.notes || []).filter(n => ids.includes(n.id)).every(n => n.favorite) },
      event, side: 'bottom', alignment: 'start', showBackdrop: true, cssClass: 'note-context-popover',
    });
    await popover.present();
    const { data } = await popover.onDidDismiss();
    switch (data?.action) {
      case 'pin': await this.toggleNoteFlag(note.id, 'pinned'); break;
      case 'favorite': await this.favoriteSelection(ids); break;
      case 'move': this.openMoveDialog(ids); break;
      case 'lock':
        this.listOfCheckedCheckboxes = [note.id];
        if (this.noteService.selectedNoteId === note.id) window.dispatchEvent(new CustomEvent('stellar:note-lock-request', { detail: { id: note.id } }));
        else await this.router.navigate(['/note', note.id], { queryParams: { action: 'lock' } });
        break;
      case 'share': if (!this.isNoteLocked(note)) await this.shareNote(note); break;
      case 'delete':
        if (ids.length === 1) await this.deleteNote(ids[0]);
        else { this.listOfCheckedCheckboxes = ids; await this.deleteSelectedNotes(); }
        break;
    }
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
      componentProps: { isSingleDelete: true, recoverable: !!this.noteService.trashEnabled },
    });

    modal.onDidDismiss().then(async (data) => {
      if (data && data.data) {
        const { confirm } = data.data;
        if (confirm) {
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
    if(this.activeFilter==='trash'){this.activeFilter='all';this.activeFolderName='__all__';this.search_query='';this.searchType='all';this.applyFilters();}
    this.listOfCheckedCheckboxes = [];
    this.noteService.isNoteTemporaryDescripted = false;
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
      side: "top",
      alignment: "end",
      translucent: true,
      showBackdrop: false,
      cssClass: "user-menu-popover",
      arrow: false,
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
