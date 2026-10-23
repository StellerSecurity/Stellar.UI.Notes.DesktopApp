import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { APP_LANGUAGES, APP_CATALOGS, appCatalog, getAppLanguage, resolveAppLanguage, setAppLanguage, translateText, formatAppDate } from './i18n';
import { TranslatorService } from './services/translator.service';

@Component({standalone:false, template:`<h1>{{'settings' | translate}}</h1><p>{{'noteCount' | translate:{count:1} }}</p>`})
class LanguageView {}

describe('Bundled app languages', () => {
  let stored: string | null;
  beforeEach(() => {
    stored = localStorage.getItem('stellarNotesLanguage');
    localStorage.removeItem('stellarNotesLanguage');
    TestBed.configureTestingModule({imports:[TranslateModule.forRoot()], declarations:[LanguageView]});
  });
  afterEach(() => {
    if (stored === null) localStorage.removeItem('stellarNotesLanguage');
    else localStorage.setItem('stellarNotesLanguage', stored);
    setAppLanguage('en'); document.documentElement.lang = 'en';
  });

  it('recognizes supported regional locales and falls back to English for unsupported or absent locales', () => {
    for (const [input, expected] of Object.entries({'en-US':'en','da-DK':'da','de_AT':'de','tr-TR':'tr','es-MX':'es','sv-SE':'sv','nb-NO':'nb','no-NO':'nb','fr-CA':'fr','it-IT':'it','nl-BE':'nl','pl-PL':'pl','pt_BR':'pt-BR','pt-PT':'pt-BR','ja-JP':'en','se':'en','nn':'en','':'en'})) {
      expect(resolveAppLanguage(input)).withContext(input).toBe(expected);
    }
    expect(resolveAppLanguage(undefined)).toBe('en');
  });

  it('uses the device language by default and English when it is unsupported', () => {
    spyOnProperty(navigator, 'languages', 'get').and.returnValue(['da-DK']);
    const service = TestBed.inject(TranslatorService);
    expect(service.preference).toBe('system'); expect(service.language).toBe('da');
    (Object.getOwnPropertyDescriptor(navigator, 'languages')!.get as jasmine.Spy).and.returnValue(['ja-JP']);
    service.selectLanguage('system');
    expect(service.language).toBe('en');
  });

  it('switches every language immediately in templates, shared references and date formatting without reloading', () => {
    const service = TestBed.inject(TranslatorService), reference = service.allTranslations;
    const fixture = TestBed.createComponent(LanguageView);
    for (const {code} of APP_LANGUAGES) {
      service.selectLanguage(code); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h1').textContent).toBe(APP_CATALOGS[code]['settings']);
      expect(fixture.nativeElement.querySelector('p').textContent).toBe(APP_CATALOGS[code]['noteCount'].replace('{{count}}','1'));
      expect(reference).toBe(service.allTranslations); expect(reference['settings']).toBe(APP_CATALOGS[code]['settings']);
      expect(document.documentElement.lang).toBe(code); expect(getAppLanguage()).toBe(code);
      const instant = new Date(2026, 9, 23, 12).getTime();
      expect(formatAppDate(instant,{weekday:'long'})).toBe(new Intl.DateTimeFormat(code,{weekday:'long'}).format(instant));
    }
  });

  it('restores an explicit saved choice on startup and saves switching back to system language', () => {
    localStorage.setItem('stellarNotesLanguage','pl');
    const service = TestBed.inject(TranslatorService);
    expect(service.language).toBe('pl');
    service.selectLanguage('pt-BR');
    const restarted = new TranslatorService(TestBed.inject(TranslateService));
    expect(restarted.language).toBe('pt-BR'); expect(restarted.preference).toBe('pt-BR');
    restarted.selectLanguage('system'); expect(localStorage.getItem('stellarNotesLanguage')).toBe('system');
  });

  it('falls back per missing or blank translated key in both helpers and template catalogs', () => {
    const original = APP_CATALOGS.da['settings'];
    try {
      setAppLanguage('da'); delete APP_CATALOGS.da['settings'];
      expect(translateText('settings')).toBe(APP_CATALOGS.en['settings']);
      expect(appCatalog('da')['settings']).toBe(APP_CATALOGS.en['settings']);
      APP_CATALOGS.da['settings'] = '   ';
      expect(translateText('settings')).toBe(APP_CATALOGS.en['settings']);
      expect(appCatalog('da')['settings']).toBe(APP_CATALOGS.en['settings']);
      expect(translateText('unregistered-key')).toBe('unregistered-key');
    } finally { APP_CATALOGS.da['settings'] = original; }
  });

  it('keeps language switching usable when preference storage is blocked', () => {
    const service = TestBed.inject(TranslatorService);
    spyOn(localStorage, 'setItem').and.throwError('Storage blocked');
    expect(() => service.selectLanguage('tr')).not.toThrow();
    expect(service.language).toBe('tr');
  });
});
