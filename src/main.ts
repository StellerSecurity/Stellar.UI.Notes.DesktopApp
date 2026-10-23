import { translateText as t } from './app/i18n';
import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(() => {
    const screen=document.createElement('main');screen.className='sn-dialog-content';screen.style.cssText='max-width:480px;margin:12vh auto;text-align:center';
    const title=document.createElement('h1');title.textContent='Stellar Notes';
    const message=document.createElement('p');message.textContent=t('uiSavedNotesCouldNotBeReadKeepThis');
    screen.append(title,message);document.body.replaceChildren(screen);
  });
