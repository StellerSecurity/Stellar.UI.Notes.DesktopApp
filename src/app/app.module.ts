import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { PasswordStrengthMeterModule } from 'angular-password-strength-meter';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { ShareSecretModalComponent } from './share-secret-modal/share-secret-modal.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import * as sodium from 'libsodium-wrappers';
import { IonicStorageModule, Storage as IonicStorage } from '@ionic/storage-angular';
import { Drivers } from '@ionic/storage'; // <-- driver enums
import { UserMenuComponent } from './user-menu/user-menu.component';

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http);
}

export function initSodium() {
  return async () => {
    // On mobile, ensure path is correct for your WebView base href:
    await sodium.ready;
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
      driverOrder: [
        Drivers.IndexedDB,
        Drivers.LocalStorage, // fallback for Safari Private Mode / restrictive envs
      ],
    }),
    ToastrModule.forRoot({
      timeOut: 3000,
      positionClass: 'toast-bottom-center',
      preventDuplicates: true,
    }),
    PasswordStrengthMeterModule.forRoot(),
    IonicModule.forRoot({ innerHTMLTemplatesEnabled: true }),
    AppRoutingModule,
    CommonModule,
    FormsModule,
    TranslateModule.forRoot({
      loader: { provide: TranslateLoader, useFactory: HttpLoaderFactory, deps: [HttpClient] },
    }),
  ],
  providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }],
  bootstrap: [AppComponent],
})
export class AppModule {}
