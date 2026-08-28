const RICH_TEXT_TAG_PATTERN = /<\/?(?:p|div|br|h[1-6]|ol|ul|li|blockquote|pre|strong|b|em|i|u|s|strike|a|img|span)(?:\s[^>]*)?>/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function preserveLiteralHtmlNewlines(value: string): string {
  const source = value.replace(/\r\n?/g, '\n');
  let result = '';
  let insideTag = false;
  let quote = '';
  let tagStart = -1;
  let preDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (!insideTag && character === '<') {
      insideTag = true;
      tagStart = index;
    } else if (insideTag && quote) {
      if (character === quote) {
        quote = '';
      }
    } else if (insideTag && (character === '"' || character === "'")) {
      quote = character;
    } else if (insideTag && character === '>') {
      const tag = source.slice(tagStart, index + 1);
      if (/^<\s*\/\s*pre\b/i.test(tag)) {
        preDepth = Math.max(0, preDepth - 1);
      } else if (/^<\s*pre\b/i.test(tag) && !/\/\s*>$/.test(tag)) {
        preDepth += 1;
      }
      insideTag = false;
    }

    if (character !== '\n' || insideTag || preDepth > 0) {
      result += character;
      continue;
    }

    const before = source.slice(0, index).match(/\S(?=\s*$)/)?.[0];
    const after = source.slice(index + 1).match(/^\s*(\S)/)?.[1];
    result += before === '>' && after === '<' ? character : '<br>';
  }

  return result;
}

export function normalizeNoteBodyForRichTextEditor(value: unknown): string {
  const source = typeof value === 'string' ? value : String(value ?? '');
  if (!source) {
    return source;
  }

  if (RICH_TEXT_TAG_PATTERN.test(source)) {
    return preserveLiteralHtmlNewlines(source);
  }

  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.length > 0 ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
    .join('');
}
