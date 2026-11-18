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
  const input = doc.createElement('template');
  input.innerHTML = html;
  input.content.querySelectorAll('ul.checklist').forEach(list => {
    const groups = doc.createDocumentFragment();
    let group: HTMLElement | undefined;
    for (const child of Array.from(list.children)) {
      const checked = child.getAttribute('data-checked') === 'true' ? 'true' : 'false';
      if (!group || group.getAttribute('data-checked') !== checked) {
        group = doc.createElement('ul');
        group.setAttribute('data-checked', checked);
        groups.appendChild(group);
      }
      child.querySelectorAll('.check-toggle').forEach(button => button.remove());
      child.removeAttribute('data-checked');
      group.appendChild(child);
    }
    list.replaceWith(groups);
  });
  const marker = 'stellar-task-state-';
  input.content.querySelectorAll('ul[data-checked]').forEach(list => {
    const state = list.getAttribute('data-checked');
    if (state === 'true' || state === 'false') list.classList.add(marker + state);
  });
  const output = doc.createElement('template');
  output.innerHTML = sanitize(input.innerHTML);
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
