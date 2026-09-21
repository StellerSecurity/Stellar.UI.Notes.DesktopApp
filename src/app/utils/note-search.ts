import { normalize } from './home-normalize.util';

export function noteSearchText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,template').forEach(node => node.remove());
  doc.querySelectorAll('br,p,div,li,h1,h2,h3,h4,h5,h6,blockquote').forEach(node => {
    node.after(doc.createTextNode(' '));
  });
  return normalize(doc.body.textContent ?? '');
}

export function matchesNoteSearch(terms: string[], title: string, folder: string, text: string, protectedNote: boolean): boolean {
  const fields = protectedNote ? [title, folder] : [title, folder, text];
  return terms.every(term => fields.some(field => field.includes(term)));
}
