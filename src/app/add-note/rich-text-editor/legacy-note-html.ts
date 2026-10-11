/** Export Quill's DOM using the list markup understood by older Notes clients.
 * This does not call getSemanticHTML(), whose embed string interpolation has
 * CVE-2025-15056. Sanitize the returned HTML before publishing it to a note.
 * Only the detached clone is changed; selection and undo history stay intact.
 */
export function legacyNoteHtml(root: HTMLElement): string {
  // Quill 1 already uses the legacy format. Preserve its exact serialization.
  if (!root.querySelector('li[data-list], .ql-code-block-container')) return root.innerHTML;
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.ql-ui').forEach(node => node.remove());

  // Quill 1 persists code as a PRE. Preserve literal code and line boundaries,
  // without allowing code text to become HTML when another client opens it.
  copy.querySelectorAll('.ql-code-block-container').forEach(container => {
    const pre = root.ownerDocument.createElement('pre');
    pre.className = 'ql-syntax';
    pre.setAttribute('spellcheck', 'false');
    pre.textContent = Array.from(container.children)
      .map(line => line.textContent ?? '').join('\n') + '\n';
    container.replaceWith(pre);
  });

  // Work from inner lists outwards so detached child lists stay in their item.
  Array.from(copy.querySelectorAll('ol,ul')).reverse().forEach(list => {
    if (!Array.from(list.children).some(item => item.hasAttribute('data-list'))) return;
    const fragment = root.ownerDocument.createDocumentFragment();
    let group: HTMLElement | undefined;
    let previousKind: string | undefined;
    for (const node of Array.from(list.childNodes)) {
      if (node.nodeType !== 1 || (node as Element).tagName !== 'LI') {
        fragment.appendChild(node);
        group = undefined;
        previousKind = undefined;
        continue;
      }
      const item = node as HTMLElement;
      const kind = item.getAttribute('data-list') ?? (list.tagName === 'OL' ? 'ordered' : 'bullet');
      if (!['ordered', 'bullet', 'checked', 'unchecked'].includes(kind)) {
        // Do not silently discard content from an unknown future list format.
        throw new Error('Unsupported note list format');
      }
      if (!group || kind !== previousKind) {
        group = root.ownerDocument.createElement(kind === 'ordered' ? 'ol' : 'ul');
        for (const attribute of Array.from(list.attributes)) {
          if (attribute.name !== 'data-checked') group.setAttribute(attribute.name, attribute.value);
        }
        if (kind === 'checked' || kind === 'unchecked') group.setAttribute('data-checked', String(kind === 'checked'));
        fragment.appendChild(group);
        previousKind = kind;
      }
      item.removeAttribute('data-list');
      group.appendChild(item);
    }
    list.replaceWith(fragment);
  });
  return copy.innerHTML;
}
