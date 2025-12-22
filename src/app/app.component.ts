import { Component } from '@angular/core';
import { TranslatorService } from './services/translator.service';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Storage as IonicStorage } from '@ionic/storage-angular';
import { SyncWorkerService } from './services/sync-worker.service';


@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  constructor(
    private translator: TranslatorService,
    private storage: IonicStorage,
    private syncWorker: SyncWorkerService,
  ) {
    this.syncWorker.init();

    StatusBar.setBackgroundColor({ color: '#F6F6FD' }).then((r) => {});
    StatusBar.setStyle({ style: Style.Light }).then((r) => {});

    if (typeof navigator !== 'undefined') {
      this.translator.loadTranslations('./assets/i18n/').subscribe(() => {});
    }
  }
}
