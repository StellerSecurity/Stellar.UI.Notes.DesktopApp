import { parseDocument, DomUtils } from 'htmlparser2';
import { preserveNoteLineBreaks, preserveNoteSpaces } from './preserve-note-line-breaks';
export { legacyNoteHtml } from './legacy-note-html';
export { CompactImageExport } from './compact-image-export';

export function noteEditorModules() {
  return {
    clipboard: { matchers: [[3, preserveNoteSpaces], [1, preserveNoteLineBreaks]] },
    history: { delay: 0, maxStack: 300, userOnly: true },
    keyboard: { bindings: { 'list autofill': false } },
  };
}

export function sanitizeNoteContent(html: string, sanitize: (value: string) => string, doc: Document = document): string {
  if (!/data-checked|stellar-task-state-|checklist/i.test(html)) return sanitize(html);
  const input = parseDocument(html);
  const hasClass = (value: string | undefined, name: string) => (value || '').split(/\s+/).includes(name);
  const lists = DomUtils.findAll(node => node.name === 'ul' && hasClass(node.attribs['class'], 'checklist'), input.children);
  for (const list of lists) {
    const groups: typeof list[] = [];
    let group: typeof list | undefined;
    for (const child of [...list.children]) {
      if (!DomUtils.isTag(child)) continue;
      const checked = child.attribs['data-checked'] === 'true' ? 'true' : 'false';
      if (!group || group.attribs['data-checked'] !== checked) {
        group = list.cloneNode(false);
        group.attribs = { 'data-checked': checked };
        groups.push(group);
      }
      DomUtils.findAll(node => hasClass(node.attribs['class'], 'check-toggle'), child.children).forEach(DomUtils.removeElement);
      delete child.attribs['data-checked'];
      DomUtils.appendChild(group, child);
    }
    if (!groups.length) DomUtils.removeElement(list);
    else {
      DomUtils.replaceElement(list, groups[0]);
      for (let index = 1; index < groups.length; index++) DomUtils.append(groups[index - 1], groups[index]);
    }
  }
  const marker = 'stellar-task-state-';
  DomUtils.findAll(node => node.name === 'ul', input.children).forEach(list => {
    const state = list.attribs['data-checked'];
    if (state === 'true' || state === 'false') {
      list.attribs['class'] = [list.attribs['class'], marker + state].filter(Boolean).join(' ');
    }
  });
  const clean = sanitize(DomUtils.getInnerHTML(input));
  const output = doc.createElement('template');
  output.innerHTML = clean;
  output.content.querySelectorAll('ul').forEach(list => {
    for (const state of ['true', 'false']) {
      if (list.classList.contains(marker + state)) {
        list.setAttribute('data-checked', state);
        list.classList.remove(marker + state);
      }
    }
    if (!list.className) list.removeAttribute('class');
  });
  return output.innerHTML;
}
