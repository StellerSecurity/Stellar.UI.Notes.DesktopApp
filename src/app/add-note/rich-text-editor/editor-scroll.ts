/** Keep the native caret in Ionic's scroll viewport after keyboard resizing. */
export function bindEditorScroll(quill: any, scroll: HTMLElement, toolbar: HTMLElement): () => void {
  const root: HTMLElement = quill.root;
  const previous = quill.scrollingContainer;
  quill.scrollingContainer = scroll;
  let frame = 0;
  let focusScroll: { ion: number; document: number; editor: number } | null = null;
  const captureFocusScroll = () => {
    if (document.activeElement === root) return;
    focusScroll = {
      ion: scroll.scrollTop,
      document: document.scrollingElement?.scrollTop ?? 0,
      editor: root.scrollTop
    };
  };
  const keyboardShown = () => {
    if (document.activeElement !== root) { focusScroll = null; return; }
    // Android may scroll both the WebView document and Ionic while opening IME.
    // Restore the pre-tap viewport, then reveal the NEW caret, not Quill's old range.
    if (focusScroll) {
      scroll.scrollTop = focusScroll.ion;
      root.scrollTop = focusScroll.editor;
      if (document.scrollingElement) document.scrollingElement.scrollTop = focusScroll.document;
      focusScroll = null;
    }
    keepVisible();
  };
  const clearFocusScroll = () => { focusScroll = null; };
  const keepVisible = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const selection = document.getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed || !root.contains(selection.anchorNode) || document.activeElement !== root) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.height) return;
      const viewport = window.visualViewport;
      const bounds = scroll.getBoundingClientRect();
      const top = Math.max(bounds.top, toolbar.getBoundingClientRect().bottom, viewport?.offsetTop ?? 0) + 8;
      const bottom = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 8;
      if (bottom <= top) return;
      if (rect.top < top) scroll.scrollTop -= top - rect.top;
      else if (rect.bottom > bottom) scroll.scrollTop += rect.bottom - bottom;
    });
  };
  document.addEventListener('selectionchange', keepVisible);
  root.addEventListener('pointerdown', captureFocusScroll, true);
  root.addEventListener('blur', clearFocusScroll);
  window.addEventListener('keyboardDidShow', keyboardShown);
  window.addEventListener('resize', keepVisible);
  window.visualViewport?.addEventListener('resize', keepVisible);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('selectionchange', keepVisible);
    root.removeEventListener('pointerdown', captureFocusScroll, true);
    root.removeEventListener('blur', clearFocusScroll);
    window.removeEventListener('keyboardDidShow', keyboardShown);
    window.removeEventListener('resize', keepVisible);
    window.visualViewport?.removeEventListener('resize', keepVisible);
    quill.scrollingContainer = previous;
  };
}
