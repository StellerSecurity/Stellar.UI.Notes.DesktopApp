import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/** Sanitize before Quill 1 inserts clipboard HTML into its live DOM container. */
export function bindSafeNotePaste(quill: any, sanitizer: DomSanitizer): () => void {
  const root: HTMLElement = quill.root;
  const onPaste = (event: ClipboardEvent) => {
    const html = event.clipboardData?.getData('text/html');
    if (!html || event.defaultPrevented || !quill.isEnabled()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const range = quill.getSelection(true);
    if (!range) return;
    const safeHtml = sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
    const pasted = quill.clipboard.convert(safeHtml);
    quill.updateContents({ops: [
      ...(range.index ? [{retain: range.index}] : []),
      ...pasted.ops,
      ...(range.length ? [{delete: range.length}] : [])
    ]}, 'user');
    quill.setSelection(range.index + pasted.length(), 0, 'silent');
  };
  root.addEventListener('paste', onPaste, true);
  return () => root.removeEventListener('paste', onPaste, true);
}
