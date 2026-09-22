import { Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { AlertController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { QuillModule, QuillService } from 'ngx-quill';
import Quill from 'quill';
import { of } from 'rxjs';
import { RichTextEditorComponent } from './add-note/rich-text-editor/rich-text-editor.component';
import { preserveNoteLineBreaks } from './add-note/rich-text-editor/preserve-note-line-breaks';

@Component({template: '<app-rich-text-editor [note_text]="html" [noteId]="id" (noteChange)="save($event)"></app-rich-text-editor>'})
class EditorHost {
  html = ''; id = 'first'; changes: string[] = [];
  save(value: string): void { this.html = value; this.changes.push(value); }
}

describe('Desktop Quill / mobile HTML compatibility', () => {
  beforeEach(() => TestBed.configureTestingModule({
    declarations: [EditorHost, RichTextEditorComponent],
    imports: [FormsModule, QuillModule.forRoot(), TranslateModule.forRoot()],
    providers: [
      {provide: AlertController, useValue: {}},
      {provide: QuillService, useValue: {config:{}, getQuill:()=>of(Quill), registerCustomModules:()=>Promise.resolve()}},
    ],
  }));

  function editor(html = '') {
    const fixture = TestBed.createComponent(EditorHost);
    fixture.componentInstance.html = html; fixture.detectChanges(); tick(600); fixture.detectChanges();
    const component = fixture.debugElement.children[0].componentInstance as RichTextEditorComponent;
    expect(component.quill).toBeDefined();
    return {fixture, component, quill:component.quill, host:fixture.componentInstance};
  }

  const legacy = [
    '<p>test</p><p>test</p><p>test</p>',
    'test<div>test</div><div>test</div>',
    '<div>test</div><div>test</div><div>test</div>',
    'test<br>test<br>test',
    '<h2>Title</h2><p><b>bold</b> <strike>strike</strike></p><ul><li>first</li><li>second</li></ul><ol><li>numbered</li></ol><p><a href="https://example.com">link</a></p>',
    '<p>æøå 😀 中文</p><p><br></p><p>end</p>',
    '<p>image<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7XkAAAAASUVORK5CYII=" width="1" height="1" alt="tiny"></p>',
  ];
  legacy.forEach((html, index) => it('round-trips legacy HTML case '+index+' through the mobile importer', fakeAsync(() => {
    const {fixture, component, quill, host} = editor(html);
    expect(host.changes).toEqual([]); // Opening old HTML must not silently resave it.
    const text = quill.getText(); const contents = quill.getContents();
    if (index < 4) expect(text).toBe('test\ntest\ntest\n');
    const node = document.createElement('div'); document.body.append(node);
    const mobile: any = new Quill(node, {modules:{toolbar:false,clipboard:{matchVisual:false,matchers:[[1,preserveNoteLineBreaks]]}}});
    mobile.setContents(mobile.clipboard.convert(quill.root.innerHTML), 'silent');
    expect(mobile.getText()).toBe(text);
    expect(mobile.getContents()).toEqual(contents);
    component.setExternalContent(mobile.root.innerHTML); fixture.detectChanges(); tick();
    expect(quill.getContents()).toEqual(contents);
    expect(host.changes).toEqual([]);
    node.remove(); fixture.destroy(); tick(500);
  })));

  it('never executes untrusted saved, remote or pasted HTML', fakeAsync(() => {
    (window as any).__editorXss = 0;
    const payload = '<p>safe</p><img src="data:image/png;base64,AA==" onerror="window.__editorXss++"><svg onload="window.__editorXss++"></svg><script>window.__editorXss++</script><iframe srcdoc="<script>parent.__editorXss++</script>"></iframe><a href="javascript:window.__editorXss++">link</a>';
    const {fixture, component, quill} = editor(payload);
    component.setExternalContent('<p>remote</p>'+payload); fixture.detectChanges(); tick(100);
    quill.setSelection(0, 6, 'silent');
    const data = new DataTransfer(); data.setData('text/html',payload);
    quill.root.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); tick(200);
    expect((window as any).__editorXss).toBe(0);
    expect(quill.root.querySelector('[onerror],[onload],script,svg,iframe,a[href^="javascript:"]')).toBeNull();
    fixture.destroy(); tick(500); delete (window as any).__editorXss;
  }));

  it('replaces a selection on paste, preserves paragraphs, and supports undo / redo', fakeAsync(() => {
    const {fixture, component, quill, host} = editor('<p>replace me</p>');
    quill.setSelection(0,10,'silent');
    const data = new DataTransfer(); data.setData('text/html','<p><strong>test</strong></p><p>test</p><p>test</p>');
    quill.root.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); tick();
    expect(quill.getText()).toBe('test\ntest\ntest\n');
    expect(quill.root.querySelector('strong')?.textContent).toBe('test');
    expect(host.changes.length).toBe(1);
    component.undo(); tick(); expect(quill.getText()).toBe('replace me\n');
    component.redo(); tick(); expect(quill.getText()).toBe('test\ntest\ntest\n');
    fixture.destroy(); tick(500);
  }));

  it('does not write remote changes back or let undo resurrect the previous note', fakeAsync(() => {
    const {fixture, component, quill, host} = editor('<p>old</p>');
    quill.insertText(0,'local ','user'); fixture.detectChanges(); tick();
    host.html = '<p>remote</p>';
    component.setExternalContent('<p>remote</p>'); fixture.detectChanges(); tick();
    expect(host.changes.length).toBe(1); component.undo(); tick(); expect(quill.getText()).toBe('remote\n');
    quill.insertText(0,'edit ','user'); tick();
    host.id='second';host.html='<p>second note</p>';fixture.detectChanges();tick();
    component.undo();tick();expect(quill.getText()).toBe('second note\n');
    fixture.destroy();tick(500);
  }));

  it('keeps a first-line caret in a long note and cancels focus on leave', fakeAsync(() => {
    const {fixture,component,quill} = editor('<p>first</p>'+ '<p>line</p>'.repeat(500));
    quill.root.scrollTop=0;quill.root.focus({preventScroll:true});quill.setSelection(0,0,'silent');tick(60);
    expect(quill.getSelection().index).toBe(0);expect(quill.root.scrollTop).toBe(0);
    const focus=spyOn(quill.root,'focus');component.onEnter();component.onLeave();tick(600);expect(focus).not.toHaveBeenCalled();
    fixture.destroy();tick(500);
  }));

  it('clears text, copies text without doubled lines, and blocks unsafe external links', fakeAsync(() => {
    const {fixture,quill,host}=editor('<p>one</p><p>two</p>');
    quill.setSelection(0,7,'silent');const data=new DataTransfer();
    quill.root.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
    expect(data.getData('text/plain')).toBe('one\ntwo');
    const open=spyOn(window,'open');
    const anchor=document.createElement('a');anchor.href='file:///tmp/no';anchor.textContent='unsafe';quill.root.append(anchor);
    anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));expect(open).not.toHaveBeenCalled();
    anchor.remove();quill.deleteText(0,quill.getLength(),'user');tick();expect(host.html).toBe('');
    fixture.destroy();tick(500);
  }));
});
