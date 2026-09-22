import type { DeltaStatic } from 'quill';

const TEXT_BLOCKS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'
]);

/** Quill's HTML importer collapses ordinary spaces although its editor displays
 * them verbatim. Preserve note text; leave pretty-printed HTML line indentation
 * and whitespace outside blocks to the normal HTML importer. */
export function preserveNoteSpaces(node: Text, delta: DeltaStatic): DeltaStatic {
  const text = node.data;
  if (/[\r\n]/.test(text) || (!text.trim() && node.parentElement?.classList.contains('ql-clipboard'))) return delta;
  const last = delta.ops?.[delta.ops.length - 1];
  const result = delta.slice(0, 0).insert(text);
  // Quill may already have recognized a boundary before the following block.
  if (typeof last?.insert === 'string' && last.insert.endsWith('\n')) result.insert('\n', last.attributes);
  return result;
}

/** Preserve semantic lines even while Ionic is attaching the editor's view. */
export function preserveNoteLineBreaks(node: HTMLElement, delta: DeltaStatic): DeltaStatic {
  if (!TEXT_BLOCKS.has(node.tagName)) {
    return delta;
  }

  const operations = delta.ops ?? [];
  const last = operations[operations.length - 1];
  // Quill 1 detects blocks via computed display styles, which can be unavailable
  // during navigation. Keep the block boundary and any line formatting already
  // applied by its built-in matchers (heading, list, alignment, etc.).
  if (!(typeof last?.insert === 'string' && last.insert.endsWith('\n'))) delta.insert('\n', last?.attributes);

  // convert() removes an unformatted terminal newline. For a trailing empty
  // paragraph, setContents() does not restore it because another newline remains.
  // Preserve that explicit blank paragraph, including legacy outer DIV wrappers.
  const final = delta.ops?.[delta.ops.length - 1];
  if (node.parentElement?.classList.contains('ql-clipboard') && !node.nextElementSibling && !final?.attributes) {
    let tail = node;
    while (tail.lastElementChild && tail.lastElementChild.tagName !== 'BR') tail = tail.lastElementChild as HTMLElement;
    if (TEXT_BLOCKS.has(tail.tagName) && !tail.textContent && Array.from(tail.children).every(child => child.tagName === 'BR')) {
      delta.insert('\n');
    }
  }
  return delta;
}
