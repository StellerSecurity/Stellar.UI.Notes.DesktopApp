import { getAppLanguage, translateText as t } from '../i18n';
/** Dates follow the selected app language and the device's local calendar. */
export function desktopNoteDate(value: number | string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const age = Math.round((day(now) - day(date)) / 86400000);
  if (age === 0) return date.toLocaleTimeString(getAppLanguage(), { hour: 'numeric', minute: '2-digit' });
  if (age === 1) return t('uiYesterday');
  if (age > 1 && age < 7) return date.toLocaleDateString(getAppLanguage(), { weekday: 'long' });
  return date.toLocaleDateString(getAppLanguage(), { month: 'short', day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) });
}

export function selectionRange(ids: string[], anchor: string, target: string): string[] {
  const end = ids.indexOf(target);
  const start = ids.indexOf(anchor);
  if (end < 0) return [];
  if (start < 0) return [target];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}
