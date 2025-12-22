// Pure text normalizer used by search()
export function normalize(input: any): string {
  if (input === null || input === undefined) return '';
  let s = String(input);

  try {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    s = ta.value;
  } catch { /* SSR/defensive */ }

  if ((s as any).normalize) s = s.normalize('NFKC');
  s = s.toLowerCase();

  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');

  if ((s as any).normalize) s = s.normalize('NFD');
  s = s.replace(/[\u0300-\u036f]/g, '');
  if ((s as any).normalize) s = s.normalize('NFC');

  s = s.replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/ß/g, 'ss');

  return s.replace(/\s+/g, ' ').trim();
}
