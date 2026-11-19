import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserModule, DomSanitizer } from '@angular/platform-browser';
import { sanitizeNoteContent } from './editor-document';

describe('Shared note HTML import', () => {
  let sanitize: (value: string) => string;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BrowserModule] });
    const sanitizer = TestBed.inject(DomSanitizer);
    sanitize = value => sanitizer.sanitize(SecurityContext.HTML, value) ?? '';
  });
  function read(html: string): HTMLTemplateElement {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template;
  }
  it('sanitizes before the imported tree reaches the browser document', () => {
    let sanitized = false;
    const doc = { createElement: (name: string) => {
      expect(sanitized).toBeTrue();
      return document.createElement(name);
    } } as Document;
    const output = sanitizeNoteContent('<ul data-checked="true" onclick="alert(1)"><li>Task<script>alert(1)</script></li></ul>', value => {
      sanitized = true;
      return sanitize(value);
    }, doc);
    expect(output).toContain('data-checked="true"');
    expect(output).not.toMatch(/onclick|<script/i);
  });
  it('preserves mixed legacy checklist states and removes only their toggle controls', () => {
    const input = '<p>Before</p><ul class="checklist"><li data-checked="true"><button class="check-toggle">toggle</button>Done</li><li data-checked="false">Todo</li><li data-checked="true">Done again</li></ul><p><br></p><p>After</p>';
    const output = read(sanitizeNoteContent(input, sanitize));
    const lists = Array.from(output.content.querySelectorAll('ul'));
    expect(lists.map(list => list.getAttribute('data-checked'))).toEqual(['true', 'false', 'true']);
    expect(lists.map(list => list.textContent)).toEqual(['Done', 'Todo', 'Done again']);
    expect(output.content.querySelectorAll('p').length).toBe(3);
    expect(output.content.querySelector('.check-toggle')).toBeNull();
  });
  it('keeps intentional blank paragraphs, whitespace, unicode and literal markup text', () => {
    const input = '<p><br></p><p>æøå 😀  two spaces &lt;ul data-checked="true"&gt;</p><p><br></p><ul data-checked="false"><li>Task &amp; text</li></ul><p><br></p><p><br></p>';
    const once = sanitizeNoteContent(input, sanitize);
    const twice = sanitizeNoteContent(once, sanitize);
    expect(twice).toBe(once);
    const parsed = read(twice);
    expect(parsed.content.querySelectorAll('p').length).toBe(5);
    expect(parsed.content.querySelectorAll('ul').length).toBe(1);
    expect(parsed.content.querySelectorAll('p')[1].textContent).toBe('æøå 😀  two spaces <ul data-checked="true">');
    expect(parsed.content.querySelector('li')!.textContent).toBe('Task & text');
  });
  for (const attack of [
    '<script>alert(1)</script><img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">link</a><iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<svg><g onload="alert(1)"></g></svg><math><mtext>text</mtext></math>',
    '<form><input name="innerHTML"><button formaction="javascript:alert(1)">go</button></form>',
    '</template><img src="x" onerror="alert(1)"><template>',
  ]) {
    it('removes executable markup from checklist import: ' + attack.slice(0, 25), () => {
      const output = read(sanitizeNoteContent('<ul data-checked="false"><li>Keep' + attack + '</li></ul>', sanitize));
      expect(output.content.querySelector('script,iframe,svg,math,form,input,template')).toBeNull();
      expect(output.content.querySelector('[onerror],[onload],[onclick],[srcdoc],[formaction]')).toBeNull();
      for (const link of Array.from(output.content.querySelectorAll('a'))) {
        expect(link.getAttribute('href')).toBe('unsafe:javascript:alert(1)');
      }
      expect(output.content.textContent).toContain('Keep');
      expect(output.content.querySelector('ul')?.getAttribute('data-checked')).toBe('false');
    });
  }
});
