import type { DeltaStatic } from 'quill';

const TEXT_BLOCKS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'
]);

/** Preserve semantic lines even while Ionic is attaching the editor's view. */
export function preserveNoteLineBreaks(node: HTMLElement, delta: DeltaStatic): DeltaStatic {
  if (!TEXT_BLOCKS.has(node.tagName)) {
    return delta;
  }

  const operations = delta.ops ?? [];
  const last = operations[operations.length - 1];
  if (typeof last?.insert === 'string' && last.insert.endsWith('\n')) {
    return delta;
  }

  // Quill 1 detects blocks via computed display styles, which can be unavailable
  // during navigation. Keep the block boundary and any line formatting already
  // applied by its built-in matchers (heading, list, alignment, etc.).
  return delta.insert('\n', last?.attributes);
}
