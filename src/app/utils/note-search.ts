import { normalize } from './home-normalize.util';

/** Extract searchable text without giving note markup to a browser HTML parser.
 * This is a text extractor, not an HTML sanitizer or rendering API.
 */
export function noteSearchText(html: string): string {
  const hidden = new Set(['script', 'style', 'template', 'iframe', 'object']);
  const blocks = new Set(['br', 'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  const suppressed: string[] = [];
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) { if (!suppressed.length) parts.push(html.slice(cursor)); break; }
    if (!suppressed.length) parts.push(html.slice(cursor, start));
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    const closing = html[start + 1] === '/';
    const nameStart = start + (closing ? 2 : 1);
    let end = nameStart;
    while (end < html.length && /[a-z0-9:-]/i.test(html[end])) end++;
    if (!/[a-z]/i.test(html[nameStart] ?? '') || !/[\s/>]/.test(html[end] ?? '')) {
      if (!suppressed.length) parts.push(html.slice(start, Math.max(end, start + 1)));
      cursor = Math.max(end, start + 1);
      continue;
    }
    const tag = html.slice(nameStart, end).toLowerCase();
    let quote = '';
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>' || ch === '<') break;
    }
    if (html[end] !== '>') {
      if (!suppressed.length) parts.push(html.slice(start, end));
      cursor = end;
      continue;
    }
    if (hidden.has(tag)) {
      if (closing && suppressed[suppressed.length - 1] === tag) suppressed.pop();
      else if (!closing && (!suppressed.length || suppressed[suppressed.length - 1] === 'template')) suppressed.push(tag);
    }
    if (!suppressed.length && blocks.has(tag)) parts.push(' ');
    cursor = end + 1;
  }
  // normalize decodes entities only after escaping every literal '<'.
  return normalize(parts.join(''));
}

export function matchesNoteSearch(terms: string[], title: string, folder: string, text: string, protectedNote: boolean): boolean {
  const fields = protectedNote ? [title, folder] : [title, folder, text];
  return terms.every(term => fields.some(field => field.includes(term)));
}
