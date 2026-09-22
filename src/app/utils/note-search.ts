import { normalize } from './home-normalize.util';

export function noteSearchText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Read the detached tree only; never insert untrusted nodes into any DOM.
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    const tag = node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName : '';
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT'].includes(tag)) return '';
    const text = Array.from(node.childNodes).map(read).join('');
    return text + (['BR', 'P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'].includes(tag) ? ' ' : '');
  };
  return normalize(read(doc.body));
}

export function matchesNoteSearch(terms: string[], title: string, folder: string, text: string, protectedNote: boolean): boolean {
  const fields = protectedNote ? [title, folder] : [title, folder, text];
  return terms.every(term => fields.some(field => field.includes(term)));
}
