import { legacyNoteHtml } from './legacy-note-html';

describe('Legacy note HTML export for the editor migration', () => {
  function root(html: string): HTMLElement {
    const node = document.createElement('div');
    node.innerHTML = html;
    return node;
  }

  it('preserves existing mobile HTML, unicode, spaces, images and links exactly', () => {
    const html = '<p>æøå 😀  two spaces</p><p><br></p><ul><li class="ql-indent-1">bullet</li></ul><ol><li>number</li></ol><p><strong>bold</strong> <s>strike</s><a href="https://example.com">link</a><img src="data:image/png;base64,AA==" alt="image"></p>';
    const editor = root(html);
    expect(legacyNoteHtml(editor)).toBe(editor.innerHTML);
  });

  it('keeps mixed list order and indentation readable by Quill 1 clients', () => {
    const editor = root('<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>one</li><li data-list="bullet" class="ql-indent-1">nested</li><li data-list="ordered">two</li><li data-list="bullet">three</li></ol>');
    expect(legacyNoteHtml(editor)).toBe('<ul><li>one</li><li class="ql-indent-1">nested</li></ul><ol><li>two</li></ol><ul><li>three</li></ul>');
  });

  it('preserves checked and unchecked task lists', () => {
    expect(legacyNoteHtml(root('<ol><li data-list="checked">done</li><li data-list="unchecked">todo</li></ol>')))
      .toBe('<ul data-checked="true"><li>done</li></ul><ul data-checked="false"><li>todo</li></ul>');
  });

  it('does not mutate the live editor DOM or replace its caret nodes', () => {
    const editor = root('<ol><li data-list="bullet">text</li></ol>');
    const item = editor.querySelector('li');
    const before = editor.innerHTML;
    legacyNoteHtml(editor);
    expect(editor.innerHTML).toBe(before);
    expect(editor.querySelector('li')).toBe(item);
  });

  it('normalizes nested lists without losing their parent item', () => {
    expect(legacyNoteHtml(root('<ol><li data-list="bullet">outer<ol><li data-list="ordered">inner</li></ol></li></ol>')))
      .toBe('<ul><li>outer<ol><li>inner</li></ol></li></ul>');
  });

  it('uses DOM attribute escaping instead of interpolating embed values into markup', () => {
    const editor = root('<ol><li data-list="bullet">text</li></ol><span class="ql-formula"></span>');
    editor.querySelector('span')!.setAttribute('data-value', '\"><img src=x onerror=alert(1)>');
    const output = root(legacyNoteHtml(editor));
    expect(output.querySelector('img')).toBe(null);
    expect(output.querySelector('[onerror]')).toBe(null);
    expect(output.querySelector('span')!.getAttribute('data-value')).toBe('\"><img src=x onerror=alert(1)>');
  });

  it('keeps literal dash-space text as text', () => {
    expect(legacyNoteHtml(root('<p>- not a list</p>'))).toBe('<p>- not a list</p>');
  });

  it('exports code blocks as escaped legacy PRE markup with blank lines intact', () => {
    const editor = root('<div class="ql-code-block-container"><div class="ql-code-block">&lt;script&gt;</div><div class="ql-code-block"><br></div><div class="ql-code-block">end</div></div>');
    const output = root(legacyNoteHtml(editor));
    expect(output.querySelector('script')).toBeNull();
    expect(output.querySelector('pre.ql-syntax')?.textContent).toBe('<script>\n\nend\n');
    expect(editor.querySelector('.ql-code-block-container')).not.toBeNull();
  });

  it('rejects unknown list formats without changing the local editor', () => {
    const editor = root('<ol><li data-list="future">keep me</li></ol>');
    const before = editor.innerHTML;
    expect(() => legacyNoteHtml(editor)).toThrowError('Unsupported note list format');
    expect(editor.innerHTML).toBe(before);
  });
});
