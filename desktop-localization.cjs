'use strict';
const fs = require('node:fs');
const path = require('node:path');
const languages = Object.freeze(['en','da','de','tr','es','sv','nb','fr','it','nl','pl','pt-BR']);
function resolveLanguage(value) {
  const base = String(value || '').trim().replace(/_/g,'-').toLowerCase().split('-')[0];
  return base === 'pt' ? 'pt-BR' : base === 'no' || base === 'nb' ? 'nb' : languages.includes(base) ? base : 'en';
}
function createDesktopLocalization(app) {
  const catalogDir = path.join(__dirname, 'dist/StellerPhoneNotesApp/assets/i18n');
  const catalogs = new Map();
  function catalog(language) {
    if (!catalogs.has(language)) {
      try { catalogs.set(language, JSON.parse(fs.readFileSync(path.join(catalogDir, `${language}.json`), 'utf8'))); }
      catch { catalogs.set(language, {}); }
    }
    return catalogs.get(language);
  }
  const preferenceFile = path.join(app.getPath('userData'), 'language-preference.json');
  let preference = 'system';
  try {
    const saved = JSON.parse(fs.readFileSync(preferenceFile, 'utf8'));
    if (saved === 'system' || languages.includes(saved)) preference = saved;
  } catch { /* New profile or unavailable preference; use the OS language. */ }
  const locale = () => resolveLanguage(preference === 'system' ? app.getLocale() : preference);
  return {
    setPreference(value) {
      if (value !== 'system' && !languages.includes(value)) return false;
      if (value === preference) return true;
      preference = value;
      try { fs.writeFileSync(preferenceFile, JSON.stringify(preference), {encoding:'utf8', mode:0o600}); } catch { /* In-session choice still works. */ }
      return true;
    },
    text(key, params = {}) {
      const value = catalog(locale())[key];
      const text = typeof value === 'string' && value.trim() ? value : catalog('en')[key] || key;
      return text.replace(/{{\s*(\w+)\s*}}/g, (_,name) => String(params[name] ?? ''));
    }
  };
}
module.exports = {languages, resolveLanguage, createDesktopLocalization};
