import catalog0 from '../assets/i18n/en.json';
import catalog1 from '../assets/i18n/da.json';
import catalog2 from '../assets/i18n/de.json';
import catalog3 from '../assets/i18n/tr.json';
import catalog4 from '../assets/i18n/es.json';
import catalog5 from '../assets/i18n/sv.json';
import catalog6 from '../assets/i18n/nb.json';
import catalog7 from '../assets/i18n/fr.json';
import catalog8 from '../assets/i18n/it.json';
import catalog9 from '../assets/i18n/nl.json';
import catalog10 from '../assets/i18n/pl.json';
import catalog11 from '../assets/i18n/pt-BR.json';

export const APP_LANGUAGES = [
  {
    "code": "en",
    "name": "English"
  },
  {
    "code": "da",
    "name": "Dansk"
  },
  {
    "code": "de",
    "name": "Deutsch"
  },
  {
    "code": "tr",
    "name": "Türkçe"
  },
  {
    "code": "es",
    "name": "Español"
  },
  {
    "code": "sv",
    "name": "Svenska"
  },
  {
    "code": "nb",
    "name": "Norsk (bokmål)"
  },
  {
    "code": "fr",
    "name": "Français"
  },
  {
    "code": "it",
    "name": "Italiano"
  },
  {
    "code": "nl",
    "name": "Nederlands"
  },
  {
    "code": "pl",
    "name": "Polski"
  },
  {
    "code": "pt-BR",
    "name": "Português (Brasil)"
  }
] as const;
export type AppLanguage = typeof APP_LANGUAGES[number]['code'];
export const APP_CATALOGS: Record<AppLanguage, Record<string,string>> = {'en':catalog0,'da':catalog1,'de':catalog2,'tr':catalog3,'es':catalog4,'sv':catalog5,'nb':catalog6,'fr':catalog7,'it':catalog8,'nl':catalog9,'pl':catalog10,'pt-BR':catalog11};
let activeLanguage: AppLanguage = 'en';

export function resolveAppLanguage(value?: string | null): AppLanguage {
  const locale = String(value || '').trim().replace(/_/g, '-').toLowerCase();
  const base = locale.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  if (base === 'no' || base === 'nb') return 'nb';
  return APP_LANGUAGES.find(item => item.code === base)?.code || 'en';
}

export function getAppLanguage(): AppLanguage { return activeLanguage; }
export function setAppLanguage(language: AppLanguage): void { activeLanguage = language; }
export function appCatalog(language: AppLanguage): Record<string,string> {
  const translated: Record<string,string> = {};
  for (const [key, value] of Object.entries(APP_CATALOGS[language])) {
    if (typeof value === 'string' && value.trim()) translated[key] = value;
  }
  return {...APP_CATALOGS.en, ...translated};
}

/** One local catalog shared by template pipes, plain helpers and native dialogs. */
export function translateText(key: string, params: Record<string,unknown> = {}): string {
  const value = APP_CATALOGS[activeLanguage]?.[key];
  const text = typeof value === 'string' && value.trim() ? value : APP_CATALOGS.en[key] || key;
  return text.replace(/{{\s*(\w+)\s*}}/g, (_,name) => String(params[name] ?? ''));
}

export function formatAppDate(value: number | string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(activeLanguage, options).format(date) : '';
}
