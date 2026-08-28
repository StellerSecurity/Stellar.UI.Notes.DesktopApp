import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { AlertController } from '@ionic/angular';
import { QuillModule } from 'ngx-quill';

import { RichTextEditorComponent } from './rich-text-editor.component';

const formattingFixtures = [
  '<p>Line one</p><p>Line two</p><p>Line three</p>',
  '<p>Line one</p><p><br></p><p><br></p><p>Line four</p>',
  '<p><br></p><p><br></p><p><br></p>',
  '<p><br></p><p>Leading blank line</p>',
  '<p>Trailing blank lines</p><p><br></p><p><br></p>',
  '<h2>Heading</h2><p><br></p><p>Body</p>',
  '<ol><li>First</li><li>Second</li></ol>',
  '<ul><li>First</li><li>Second</li></ul>',
  '<p><strong>Bold</strong> <s>strike</s> <a href="https://example.com">link</a></p>',
  '<h3>Mixed</h3><ul><li><strong>Bold item</strong></li></ul><p><br></p><p>Tail</p>',
  '<p>Unicode: Grüezi 👋🏽 — こんにちは</p>',
  '<p>Image</p><p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></p>',
];

describe('RichTextEditorComponent', () => {
  let component: RichTextEditorComponent;
  let fixture: ComponentFixture<RichTextEditorComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [RichTextEditorComponent],
      imports: [FormsModule, QuillModule.forRoot()],
      providers: [{ provide: AlertController, useValue: { create: jasmine.createSpy('create') } }],
    }).compileComponents();

    fixture = TestBed.createComponent(RichTextEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('uses the same Quill HTML model as Mobile Notes', () => {
    expect(component.quill).toBeTruthy();
  });

  formattingFixtures.forEach((html, index) => {
    it(`keeps formatting fixture ${index + 1} idempotent across repeated editor round trips`, () => {
      component.quill.clipboard.dangerouslyPasteHTML(html, 'silent');
      const first = component.quill.root.innerHTML;

      component.quill.clipboard.dangerouslyPasteHTML(first, 'silent');
      const second = component.quill.root.innerHTML;

      component.quill.clipboard.dangerouslyPasteHTML(second, 'silent');
      expect(component.quill.root.innerHTML).toBe(second);
    });
  });

  it('converts legacy desktop div and br blocks once and then remains stable', () => {
    component.quill.clipboard.dangerouslyPasteHTML(
      '<div>Line one</div><div><br></div><div>Line three</div>',
      'silent'
    );
    const canonical = component.quill.root.innerHTML;

    component.quill.clipboard.dangerouslyPasteHTML(canonical, 'silent');

    expect(component.quill.root.innerHTML).toBe(canonical);
    expect(component.quill.getText()).toBe('Line one\n\nLine three\n');
  });

  it('does not turn a remote refresh into a local edit', () => {
    const emitted: string[] = [];
    component.noteChange.subscribe((value) => emitted.push(value));

    component.setExternalContent('<p>Remote</p><p><br></p><p>Update</p>');

    expect(emitted).toEqual([]);
    expect(component.quill.getText()).toBe('Remote\n\nUpdate\n');
  });

  [
    'test\ntest\n\n\ntest',
    'test\ntest<br><br><br>test',
    '<p>test\ntest</p><p><br></p><p><br></p><p>test</p>',
  ].forEach((legacyContent, index) => {
    it(`preserves exact mobile line boundaries for legacy fixture ${index + 1}`, () => {
      component.setExternalContent(legacyContent);

      expect(component.quill.root.innerHTML).toBe(
        '<p>test</p><p>test</p><p><br></p><p><br></p><p>test</p>'
      );
      expect(component.quill.getText()).toBe('test\ntest\n\n\ntest\n');
    });
  });

  it('does not turn pretty-printed HTML whitespace into note lines', () => {
    component.setExternalContent('<p>test</p>\n<p>test</p>');

    expect(component.quill.root.innerHTML).toBe('<p>test</p><p>test</p>');
    expect(component.quill.getText()).toBe('test\ntest\n');
  });
});
