import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { legacyNoteHtml } from './legacy-note-html';

/** Keep Quill's semantic exporter out of the copy/cut path as well as saving. */
export function bindSafeNoteCopy(quill: any, sanitizer: DomSanitizer): () => void {
  const root: HTMLElement = quill.root;
  const copy = (event: ClipboardEvent) => {
    const range = quill.getSelection();
    if (!event.clipboardData || !range?.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData('text/plain', quill.getText(range.index, range.length));

    // Text-only copying retains the existing exact-line behavior. For embedded
    // content, use the browser's selected DOM fragment and sanitize the result.
    if (quill.getContents(range.index, range.length).ops?.some((op: any) => typeof op.insert !== 'string')) {
      const selection = root.ownerDocument.getSelection();
      if (selection?.rangeCount) {
        const selected = selection.getRangeAt(0);
        if (root.contains(selected.startContainer) && root.contains(selected.endContainer)) {
          const detached = root.ownerDocument.createElement('div');
          detached.appendChild(selected.cloneContents());
          const html = sanitizer.sanitize(SecurityContext.HTML, legacyNoteHtml(detached)) ?? '';
          event.clipboardData.setData('text/html', html);
        }
      }
    }
    if (event.type === 'cut' && quill.isEnabled()) {
      quill.deleteText(range.index, range.length, 'user');
      quill.setSelection(range.index, 0, 'silent');
    }
  };
  root.addEventListener('copy', copy, true);
  root.addEventListener('cut', copy, true);
  return () => {
    root.removeEventListener('copy', copy, true);
    root.removeEventListener('cut', copy, true);
  };
}
