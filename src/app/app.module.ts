import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { HttpClientModule } from '@angular/common/http';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { appCatalog, resolveAppLanguage } from './i18n';
import { ShareSecretModalComponent } from './share-secret-modal/share-secret-modal.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import sodium from 'libsodium-wrappers-sumo';
import { IonicStorageModule, Storage as IonicStorage } from '@ionic/storage-angular';
import { Drivers } from '@ionic/storage';
import { UserMenuComponent } from './user-menu/user-menu.component';

export class BundledTranslationLoader implements TranslateLoader {
  getTranslation(language: string) { return of(appCatalog(resolveAppLanguage(language))); }
}

export function initSodium() {
  return async () => {
    await (sodium as any).ready;
  };
}

@NgModule({
  declarations: [AppComponent, ShareSecretModalComponent, UserMenuComponent],
  imports: [
    HttpClientModule,
    BrowserModule,
    BrowserAnimationsModule,
    IonicStorageModule.forRoot({
      name: '__stellar_notes',
      driverOrder: [Drivers.IndexedDB, Drivers.LocalStorage],
    }),
    ToastrModule.forRoot({
      timeOut: 3000,
      positionClass: 'toast-bottom-center',
      preventDuplicates: true,
    }),
    IonicModule.forRoot({ innerHTMLTemplatesEnabled: true }),
    AppRoutingModule,
    CommonModule,
    FormsModule,
    TranslateModule.forRoot({
      loader: { provide: TranslateLoader, useClass: BundledTranslationLoader },
    }),
  ],
  providers: [provideZoneChangeDetection(), { provide: RouteReuseStrategy, useClass: IonicRouteStrategy }],
  bootstrap: [AppComponent],
})
export class AppModule {}
