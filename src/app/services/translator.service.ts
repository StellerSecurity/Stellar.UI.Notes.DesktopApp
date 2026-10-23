import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { APP_LANGUAGES, AppLanguage, appCatalog, resolveAppLanguage, setAppLanguage } from '../i18n';

@Injectable({providedIn: 'root'})
export class TranslatorService {
  private readonly storageKey = 'stellarNotesLanguage';
  readonly languages = APP_LANGUAGES;
  readonly allTranslations: Record<string,string> = {};
  language: AppLanguage = 'en';
  preference = 'system';

  constructor(private translate: TranslateService) {
    this.translate.addLangs(APP_LANGUAGES.map(item => item.code));
    for (const item of APP_LANGUAGES) this.translate.setTranslation(item.code, appCatalog(item.code));
    this.translate.setDefaultLang('en');
    try { const saved = localStorage.getItem(this.storageKey); this.preference = !saved || saved === 'system' ? 'system' : resolveAppLanguage(saved); } catch { /* Storage may be unavailable. */ }
    this.applyLanguage();
  }

  selectLanguage(preference: string): void {
    this.preference = preference === 'system' ? 'system' : resolveAppLanguage(preference);
    try { localStorage.setItem(this.storageKey, this.preference); } catch { /* Keep the in-session choice usable. */ }
    this.applyLanguage();
  }

  private applyLanguage(): void {
    const system = typeof navigator === 'undefined' ? 'en' : navigator.languages?.[0] || navigator.language;
    this.language = resolveAppLanguage(this.preference === 'system' ? system : this.preference);
    setAppLanguage(this.language);
    // Keep references held by cached Ionic pages current after a settings change.
    Object.assign(this.allTranslations, appCatalog(this.language));
    this.translate.use(this.language);
    if (typeof document !== 'undefined') document.documentElement.lang = this.language;
    if (typeof window !== 'undefined') (window as any).electronAPI?.setLanguage?.(this.preference);
  }

  // Legacy callers receive the same bundled catalog; no network request is needed.
  loadTranslations(_path?: string) { return of(this.allTranslations); }
}
