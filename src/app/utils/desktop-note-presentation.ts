import { getAppLanguage, translateText as t } from '../i18n';
const dateFormatters = new Map<string,Intl.DateTimeFormat>();
function formatDate(date: Date, style: string, options: Intl.DateTimeFormatOptions): string {
  const key = getAppLanguage() + ':' + style;
  let formatter = dateFormatters.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat(getAppLanguage(),options); dateFormatters.set(key,formatter); }
  return formatter.format(date);
}
/** Dates follow the selected app language and the device's local calendar. */
export function desktopNoteDate(value: number | string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const age = Math.round((day(now) - day(date)) / 86400000);
  if (age === 0) return formatDate(date,'time',{ hour: 'numeric', minute: '2-digit' });
  if (age === 1) return t('uiYesterday');
  if (age > 1 && age < 7) return formatDate(date,'weekday',{ weekday: 'long' });
  return formatDate(date,date.getFullYear() !== now.getFullYear() ? 'date-year' : 'date', { month: 'short', day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) });
}

export function desktopNoteMonth(value?: number | string): string {
  if (value == null) return t('uiNotes');
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDate(date,'month',{month:'long',year:'numeric'}) : t('uiNotes');
}

export function selectionRange(ids: string[], anchor: string, target: string): string[] {
  const end = ids.indexOf(target);
  const start = ids.indexOf(anchor);
  if (end < 0) return [];
  if (start < 0) return [target];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}
