import { NoteConflictService } from './services/note-conflict.service';
import { RealtimeNotesService } from './services/realtime-notes.service';
import { Capacitor } from '@capacitor/core';
import { NotesService } from './services/notes.service';
import { ToastMessageService } from './services/toast-message.service';
import { distinctUntilChanged, filter } from 'rxjs';
import { Component } from '@angular/core';
import { TranslatorService } from './services/translator.service';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Storage as IonicStorage } from '@ionic/storage-angular';
import { SyncWorkerService } from './services/sync-worker.service';
import { RemoteDownloadSyncService } from './services/remote-download-sync.service';


@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  constructor(
    private noteConflicts: NoteConflictService,
    private realtimeNotes: RealtimeNotesService,
    private notesState: NotesService,
    private toastMessages: ToastMessageService,
    private translator: TranslatorService,
    private storage: IonicStorage,
    private syncWorker: SyncWorkerService,
    private remoteDownloadSync: RemoteDownloadSyncService,
  ) {
    this.notesState.syncNeedsAttention$.pipe(distinctUntilChanged(), filter(Boolean)).subscribe(() => {
      void this.toastMessages.showError('Notes are saved on this device, but synchronization is not confirmed. We will retry automatically.');
    });
    this.syncWorker.init();
    this.realtimeNotes.init();
    this.noteConflicts.init();
    this.remoteDownloadSync.init();

    if (Capacitor.isNativePlatform()) {
      void StatusBar.setBackgroundColor({ color: '#F6F6FD' }).catch(() => {});
      void StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    }

    if (typeof navigator !== 'undefined') {
      this.translator.loadTranslations('./assets/i18n/').subscribe(() => {});
    }
  }
}
