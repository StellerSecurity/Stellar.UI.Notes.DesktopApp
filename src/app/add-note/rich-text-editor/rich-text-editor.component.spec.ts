import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QuillModule } from 'ngx-quill';
import { SimpleChange } from '@angular/core';

import { APP_CATALOGS } from '../../i18n';

import { RichTextEditorComponent } from './rich-text-editor.component';

describe('RichTextEditorComponent', () => {
  let component: RichTextEditorComponent;
  let fixture: ComponentFixture<RichTextEditorComponent>;

  beforeEach(waitForAsync(async () => {
    await TestBed.configureTestingModule({
      declarations: [ RichTextEditorComponent ],
      imports: [IonicModule.forRoot(), FormsModule, TranslateModule.forRoot(), QuillModule.forRoot()]
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', APP_CATALOGS.en);
    translate.setDefaultLang('en');
    translate.use('en');
    fixture = TestBed.createComponent(RichTextEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  for (const [language, catalog] of Object.entries(APP_CATALOGS)) {
    it(`renders the ${language} note prompt without inserting it into note content`, async () => {
      const expected = (catalog as Record<string, string>)['enterYourNoteHere'];
      expect(expected).withContext('Every shipped language needs the editor prompt').toBeTruthy();
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation(language, catalog);
      translate.use(language);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const editor: HTMLElement = fixture.nativeElement.querySelector('.ql-editor');
      expect(editor.getAttribute('data-placeholder')).toBe(expected);
      expect(editor.textContent?.trim()).toBe('');
      expect(component.quill.getText()).toBe('\n');
    });
  }

  it('uses a readable prompt while translations are missing', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const editor: HTMLElement = fixture.nativeElement.querySelector('.ql-editor');
    expect(editor.getAttribute('data-placeholder')).toBe('Enter your note here..');
    expect(editor.textContent?.trim()).toBe('');
  });

  it('lets the editor fill the desktop pane instead of using a fixed viewport subtraction', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const editorContainer = host.querySelector('.editor-container') as HTMLElement;
    const quillEditor = host.querySelector('quill-editor') as HTMLElement;
    const qlContainer = host.querySelector('.ql-container') as HTMLElement;
    const qlEditor = host.querySelector('.ql-editor') as HTMLElement;
    expect(getComputedStyle(editorContainer).height).not.toBe('auto');
    expect(getComputedStyle(quillEditor).display).toBe('flex');
    expect(getComputedStyle(qlContainer).flexGrow).toBe('1');
    expect(getComputedStyle(qlEditor).height).not.toContain('calc');
  });

  it('focuses the body of a new note even when the New note button had focus', async () => {
    await fixture.whenStable();
    const button = document.createElement('button'); document.body.appendChild(button); button.focus();
    component.autoFocusNewNote = true;
    component.focusEmptyEditor();
    expect(document.activeElement).toBe(component.quill.root);
    button.remove();
  });

  it('focuses an existing note body on an explicit Enter request without changing content', async () => {
    await fixture.whenStable(); component.quill.setText('Existing body');
    const row=document.createElement('button');document.body.appendChild(row);row.focus();
    component.focusBodyRequested=true;const handled=spyOn(component.bodyFocusHandled,'emit');
    const before=component.quill.getContents();component.focusRequestedBody();
    expect(document.activeElement).toBe(component.quill.root);expect(component.quill.getContents()).toEqual(before);expect(handled).toHaveBeenCalled();row.remove();
  });

  it('does not steal a deliberate title focus during new-note autofocus', async () => {
    await fixture.whenStable();
    component.autoFocusNewNote = true;
    const title = fixture.nativeElement.querySelector('.document-title') as HTMLInputElement;
    title.focus(); component.focusEmptyEditor();
    expect(document.activeElement).toBe(title);
  });

  it('aligns title, body and placeholder and hides history buttons in a narrow editor', async () => {
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    host.style.width = '504px'; host.style.height = '600px';
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const title = host.querySelector('.document-title') as HTMLElement;
    const body = host.querySelector('.ql-editor') as HTMLElement;
    const titleLeft = title.getBoundingClientRect().left;
    const bodyLeft = body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft);
    const placeholderLeft = body.getBoundingClientRect().left + parseFloat(getComputedStyle(body, '::before').left);
    expect(Math.abs(titleLeft - bodyLeft)).toBeLessThan(1);
    expect(Math.abs(titleLeft - placeholderLeft)).toBeLessThan(1);
    expect(getComputedStyle(host.querySelector('.history-tool') as HTMLElement).display).toBe('none');
  });

  it('imports a saved note into a freshly created editor instead of caching its blank DOM', async () => {
    const loaded = TestBed.createComponent(RichTextEditorComponent);
    loaded.componentInstance.note_text = '<p>Previously saved body</p>';
    loaded.componentInstance.noteId = 'existing-note';
    loaded.detectChanges(); await loaded.whenStable(); loaded.detectChanges();
    expect(loaded.componentInstance.quill.getText()).toContain('Previously saved body');
    loaded.destroy();
  });

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7XkAAAAASUVORK5CYII=';
  function imageTransfer(): DataTransfer {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(png), character => character.charCodeAt(0))], 'desktop-image.png', {type:'image/png'}));
    return transfer;
  }

  it('drops local images on blank body space, saves embedded HTML, and undoes the group together', async () => {
    await fixture.whenStable();
    const quill=component.quill; quill.setText('Keep this text\n','silent'); quill.history.clear();
    const transfer=imageTransfer(); transfer.items.add(transfer.files[0]);
    const event=new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true,clientX:-100,clientY:-100});
    const change=new Promise<void>(resolve=>quill.once('text-change',()=>resolve()));
    quill.container.dispatchEvent(event);
    expect(event.defaultPrevented).toBeTrue();
    await change;
    expect(quill.root.querySelectorAll('img').length).toBe(2);
    const saved=component.editorValueGetter(quill);
    expect(saved).toContain('data:image/png;base64,'); expect(saved).toContain('Keep this text');
    quill.history.undo(); expect(quill.root.querySelector('img')).toBeNull(); expect(quill.getText()).toContain('Keep this text');
    quill.history.redo(); expect(quill.root.querySelectorAll('img').length).toBe(2);
    const imported=quill.clipboard.convert({html:saved}); quill.setContents(imported,'silent');
    expect(quill.root.querySelectorAll('img').length).toBe(2);
  });

  it('inserts a dropped image at the drop caret without replacing selected text', async () => {
    await fixture.whenStable(); const quill=component.quill;
    quill.setText('before after\n','silent'); quill.setSelection(0,6,'silent');
    const range=document.createRange(); range.setStart(quill.root.querySelector('p').firstChild,7); range.collapse(true);
    spyOn(document,'caretRangeFromPoint').and.returnValue(range);
    const change=new Promise<void>(resolve=>quill.once('text-change',()=>resolve()));
    quill.root.dispatchEvent(new DragEvent('drop',{dataTransfer:imageTransfer(),bubbles:true,cancelable:true}));
    await change;
    expect(quill.getContents().ops).toEqual([{insert:'before '},{insert:{image:`data:image/png;base64,${png}`}},{insert:'after\n'}]);
  });

  it('rejects executable image formats and prevents file navigation', async () => {
    await fixture.whenStable(); const transfer=new DataTransfer();
    transfer.items.add(new File(['<svg onload="alert(1)"></svg>'],'untrusted.svg',{type:'image/svg+xml'}));
    const event=new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});
    component.quill.container.dispatchEvent(event);
    expect(event.defaultPrevented).toBeTrue(); expect(component.quill.root.querySelector('img')).toBeNull();
    expect(component.imageDropError).toContain('PNG, JPEG, GIF or WebP');
  });

  it('never inserts a file into another note if navigation happens during the read', async () => {
    await fixture.whenStable(); let reader!:FileReader;
    spyOn(FileReader.prototype,'readAsDataURL').and.callFake(function(this:FileReader){reader=this;});
    component.quill.container.dispatchEvent(new DragEvent('drop',{dataTransfer:imageTransfer(),bubbles:true,cancelable:true}));
    component.noteId='different-note'; component.ngOnChanges({noteId:new SimpleChange(null,'different-note',false)});
    Object.defineProperty(reader,'result',{value:`data:image/png;base64,${png}`}); reader.onload!(new ProgressEvent('load') as any);
    await Promise.resolve(); await Promise.resolve();
    expect(component.quill.root.querySelector('img')).toBeNull();
  });

  it('shows a copy target only for file drags and clears it when leaving', async () => {
    await fixture.whenStable(); const quill=component.quill;
    const event=new DragEvent('dragover',{dataTransfer:imageTransfer(),bubbles:true,cancelable:true});
    quill.container.dispatchEvent(event);
    expect(event.defaultPrevented).toBeTrue(); expect(quill.container.classList.contains('image-drop-target')).toBeTrue();
    quill.container.dispatchEvent(new DragEvent('dragleave',{bubbles:true}));
    expect(quill.container.classList.contains('image-drop-target')).toBeFalse();
    const notes=new DataTransfer(); notes.setData('application/x-stellar-note-ids','["a"]');
    const noteDrag=new DragEvent('dragover',{dataTransfer:notes,bubbles:true,cancelable:true});
    quill.container.dispatchEvent(noteDrag); expect(noteDrag.defaultPrevented).toBeFalse();
  });

  it('opens an image inside the editor and closes with Escape without editing the note', async () => {
    await fixture.whenStable(); const quill=component.quill;
    quill.insertEmbed(0,'image',`data:image/png;base64,${png}`,'silent'); quill.setSelection(1,0,'silent');
    const original=component.editorValueGetter(quill);
    quill.root.querySelector('img').click(); fixture.detectChanges();
    const preview=fixture.nativeElement.querySelector('.image-preview') as HTMLElement;
    expect(preview).toBeTruthy(); expect(preview.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${png}`);
    const close=preview.querySelector('button') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.image-preview')).toBeNull();
    expect(component.editorValueGetter(quill)).toBe(original); expect(document.activeElement).toBe(quill.root);
  });

  it('closes an image preview when switching notes or leaving the editor', async () => {
    await fixture.whenStable(); const quill=component.quill;
    quill.insertEmbed(0,'image',`data:image/png;base64,${png}`,'silent'); quill.root.querySelector('img').click();
    component.noteId='next'; component.ngOnChanges({noteId:new SimpleChange('previous','next',false)});
    expect(component.previewImageSrc).toBeNull();
    quill.root.querySelector('img').click(); expect(component.previewImageSrc).not.toBeNull();
    component.onLeave(); expect(component.previewImageSrc).toBeNull();
  });

  it('removes only the previewed duplicate image, publishes the edit and supports undo/redo', async () => {
    await fixture.whenStable(); const quill=component.quill; const src=`data:image/png;base64,${png}`;
    quill.setContents([{insert:'Before '},{insert:{image:src}},{insert:' middle '},{insert:{image:src}},{insert:' after\n'}],'silent');
    quill.history.clear();const original=JSON.stringify(quill.getContents());const text=quill.getText();
    const images=quill.root.querySelectorAll('img'); const first=images[0];images[1].click();fixture.detectChanges();
    const save=spyOn(component.noteChange,'emit');
    (fixture.nativeElement.querySelector('.image-preview-remove') as HTMLButtonElement).click();fixture.detectChanges();await fixture.whenStable();
    expect(component.previewImageSrc).toBeNull();expect(quill.root.querySelectorAll('img').length).toBe(1);
    expect(quill.root.querySelector('img')).toBe(first);expect(quill.getText()).toBe(text);
    expect(save).toHaveBeenCalledTimes(1);expect(save.calls.mostRecent().args[0]!.match(/<img\b/g)?.length).toBe(1);
    expect(document.activeElement).toBe(quill.root);
    component.undo();expect(JSON.stringify(quill.getContents())).toBe(original);
    component.redo();expect(quill.root.querySelectorAll('img').length).toBe(1);
  });

  for(const key of ['Backspace','Delete']) it(`${key} removes the previewed image without reaching note deletion shortcuts`,async()=>{
    await fixture.whenStable();const quill=component.quill;
    quill.setContents([{insert:'Keep '},{insert:{image:`data:image/png;base64,${png}`}},{insert:' text\n'}],'silent');quill.history.clear();
    quill.root.querySelector('img').click();fixture.detectChanges();
    const globalKey=jasmine.createSpy('global note shortcut');window.addEventListener('keydown',globalKey);
    try {
      const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
      (fixture.nativeElement.querySelector('.image-preview-close') as HTMLButtonElement).dispatchEvent(event);fixture.detectChanges();
      expect(event.defaultPrevented).toBeTrue();expect(globalKey).not.toHaveBeenCalled();
      expect(quill.root.querySelector('img')).toBeNull();expect(quill.getText()).toBe('Keep  text\n');
      expect(fixture.nativeElement.querySelector('.image-preview')).toBeNull();
      component.removePreviewImage();expect(quill.getText()).toBe('Keep  text\n');
      component.undo();expect(quill.root.querySelector('img')).not.toBeNull();
    } finally {window.removeEventListener('keydown',globalKey);}
  });

  it('finds the current embed position after edits received while previewing',async()=>{
    await fixture.whenStable();const quill=component.quill;
    quill.setContents([{insert:'Before '},{insert:{image:`data:image/png;base64,${png}`}},{insert:' after\n'}],'silent');
    quill.root.querySelector('img').click();quill.insertText(0,'New text ','silent');
    component.removePreviewImage();expect(quill.getText()).toBe('New text Before  after\n');expect(quill.root.querySelector('img')).toBeNull();
  });

  it('does not remove another identical image if the original embed has disappeared',async()=>{
    await fixture.whenStable();const quill=component.quill;const src=`data:image/png;base64,${png}`;
    quill.setContents([{insert:{image:src}},{insert:' middle '},{insert:{image:src}},{insert:'\n'}],'silent');
    const target=quill.root.querySelectorAll('img')[1];target.click();
    const index=quill.getIndex(quill.constructor.find(target));quill.deleteText(index,1,'silent');
    const expected=JSON.stringify(quill.getContents());component.removePreviewImage();
    expect(JSON.stringify(quill.getContents())).toBe(expected);expect(quill.root.querySelectorAll('img').length).toBe(1);
  });

  it('never removes an image from a disabled editor or after switching notes',async()=>{
    await fixture.whenStable();const quill=component.quill;
    quill.insertEmbed(0,'image',`data:image/png;base64,${png}`,'silent');quill.root.querySelector('img').click();quill.disable();
    component.removePreviewImage();expect(quill.root.querySelector('img')).not.toBeNull();
    quill.enable();quill.root.querySelector('img').click();
    component.noteId='next';component.ngOnChanges({noteId:new SimpleChange('previous','next',false)});
    const expected=JSON.stringify(quill.getContents());component.removePreviewImage();expect(JSON.stringify(quill.getContents())).toBe(expected);
  });

  async function openLargePreview(): Promise<HTMLElement> {
    await fixture.whenStable();
    fixture.nativeElement.style.cssText = 'display:block;width:500px;height:600px';
    const canvas=document.createElement('canvas'); canvas.width=1000; canvas.height=600;
    const context=canvas.getContext('2d')!; context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height);
    component.quill.insertEmbed(0,'image',canvas.toDataURL(),'silent');
    component.quill.root.querySelector('img').click(); fixture.detectChanges();
    const preview=fixture.nativeElement.querySelector('.image-preview') as HTMLElement;
    await (preview.querySelector('img') as HTMLImageElement).decode();
    // Let the entry animation finish so geometric assertions use its final size.
    preview.style.animation='none';
    return preview;
  }

  it('fits the actual image bounds and closes on black letterbox space', async () => {
    const preview=await openLargePreview();
    const image=preview.querySelector('img')!;
    const stage=preview.querySelector('.image-preview-stage') as HTMLElement;
    const bounds=image.getBoundingClientRect(); const stageBounds=stage.getBoundingClientRect();
    expect(bounds.width / bounds.height).toBeCloseTo(1000 / 600, 2);
    expect(bounds.height).toBeLessThan(stageBounds.height - 20);
    const background=document.elementFromPoint(stageBounds.left+stageBounds.width/2,stageBounds.top+4) as HTMLElement;
    expect(background).toBe(stage);
    image.click(); fixture.detectChanges(); expect(component.previewImageSrc).not.toBeNull();
    background.click(); fixture.detectChanges(); expect(component.previewImageSrc).toBeNull();
  });

  it('keeps controls readable and clickable over a zoomed white image', async () => {
    const preview=await openLargePreview();
    component.zoomPreview(5); fixture.detectChanges();
    for (const selector of ['.image-preview-close','.image-preview-zoom']) {
      const control=preview.querySelector(selector) as HTMLElement;
      const style=getComputedStyle(control);
      const background=style.backgroundColor.match(/[\d.]+/g)!.map(Number);
      // Opaque dark chrome keeps white labels legible regardless of image content.
      expect(background.length===3 || background[3]===1).toBeTrue();
      expect(Math.max(...background.slice(0,3))).toBeLessThan(80);
      expect(style.color).toBe('rgb(255, 255, 255)');
      const button=(control.querySelector('.zoom-value') || control) as HTMLElement;
      const bounds=button.getBoundingClientRect();
      const target=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2);
      expect(target===button || button.contains(target)).toBeTrue();
    }
    (preview.querySelector('.zoom-value') as HTMLButtonElement).click();
    expect(component.previewZoom).toBe(1);
    (preview.querySelector('.image-preview-close') as HTMLButtonElement).click();
    expect(component.previewImageSrc).toBeNull();
  });

  it('zooms on one click and with controls or trackpad events without changing note HTML', async () => {
    const preview=await openLargePreview(); const original=component.editorValueGetter(component.quill);
    (preview.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(component.previewZoom).toBe(1.25); expect(component.previewImageSrc).not.toBeNull();
    (preview.querySelector('[aria-label="Fit image"]') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(component.previewZoom).toBe(1);
    preview.querySelector('img')!.dispatchEvent(new MouseEvent('click',{detail:1,bubbles:true,cancelable:true}));
    expect(component.previewZoom).toBe(2); expect(component.previewAnimateZoom).toBeTrue();
    preview.querySelector('img')!.dispatchEvent(new MouseEvent('click',{detail:2,bubbles:true,cancelable:true}));
    expect(component.previewZoom).toBe(2);
    const pinch=new WheelEvent('wheel',{ctrlKey:true,deltaY:-20,bubbles:true,cancelable:true});
    preview.dispatchEvent(pinch); expect(pinch.defaultPrevented).toBeTrue(); expect(component.previewZoom).toBeGreaterThan(2);
    expect(component.previewAnimateZoom).toBeFalse();
    const wheel=new WheelEvent('wheel',{deltaY:20,bubbles:true,cancelable:true});
    preview.dispatchEvent(wheel); expect(wheel.defaultPrevented).toBeTrue();
    const beforeGesture=component.previewZoom;
    preview.dispatchEvent(new Event('gesturestart',{cancelable:true}));
    const gesture=new Event('gesturechange',{cancelable:true}); Object.assign(gesture,{scale:2,clientX:250,clientY:300});
    preview.dispatchEvent(gesture); expect(gesture.defaultPrevented).toBeTrue(); expect(component.previewZoom).toBe(Math.min(5,beforeGesture*2));
    component.zoomPreview(100); expect(component.previewZoom).toBe(5);
    component.zoomPreview(-100); expect(component.previewZoom).toBe(1);
    expect(component.editorValueGetter(component.quill)).toBe(original);
  });

  it('renders pinch zoom immediately even when the native listener was registered outside Angular', async () => {
    const preview=await openLargePreview();
    const image=preview.querySelector('img')!;
    fixture.ngZone!.runOutsideAngular(()=>{
      component.previewSurface = {nativeElement:preview};
      preview.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-35,bubbles:true,cancelable:true}));
    });
    expect(component.previewZoom).toBeGreaterThan(1);
    expect(new DOMMatrix(image.style.transform).a).toBeCloseTo(component.previewZoom,4);
    const before=component.previewZoom;
    fixture.ngZone!.runOutsideAngular(()=>preview.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:15,bubbles:true,cancelable:true})));
    expect(component.previewZoom).toBeLessThan(before);
    expect(new DOMMatrix(image.style.transform).a).toBeCloseTo(component.previewZoom,4);
  });

  it('supports two-finger touch pinch without changing the note',async()=>{
    const preview=await openLargePreview();const original=component.editorValueGetter(component.quill);
    const touch=(type:string,distance:number)=>{
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:[{clientX:200,clientY:200},{clientX:200+distance,clientY:200}]});
      preview.dispatchEvent(event);return event;
    };
    touch('touchstart',100);expect(touch('touchmove',200).defaultPrevented).toBeTrue();expect(component.previewZoom).toBe(2);
    touch('touchmove',150);expect(component.previewZoom).toBe(1.5);
    preview.dispatchEvent(new Event('touchend'));
    expect(component.editorValueGetter(component.quill)).toBe(original);
  });

  it('pans a zoomed image, clamps its edges and resets the view without closing it', async () => {
    const preview=await openLargePreview(); const image=preview.querySelector('img')!;
    spyOn(image,'setPointerCapture'); spyOn(image,'hasPointerCapture').and.returnValue(true); const release=spyOn(image,'releasePointerCapture');
    component.zoomPreview(2); fixture.detectChanges();
    image.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,clientX:200,clientY:200,bubbles:true}));
    image.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:240,clientY:220,bubbles:true}));
    expect(component.previewPanX).toBe(40); expect(component.previewPanning).toBeTrue();
    image.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:10000,clientY:10000,bubbles:true}));
    expect(component.previewPanX).toBeLessThan(500); expect(component.previewPanY).toBeLessThan(300);
    image.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true})); image.click();
    expect(release).toHaveBeenCalledWith(1); expect(component.previewPanning).toBeFalse(); expect(component.previewImageSrc).not.toBeNull();
    expect(component.previewZoom).toBe(2);
    image.click(); expect(component.previewZoom).toBe(1);
    preview.dispatchEvent(new KeyboardEvent('keydown',{key:'0',bubbles:true,cancelable:true}));
    expect(component.previewZoom).toBe(1); expect(component.previewPanX).toBe(0); expect(component.previewPanY).toBe(0);
    component.closeImagePreview(); fixture.detectChanges();
    // Detached controls must not keep a gesture listener alive.
    const pinch=new WheelEvent('wheel',{ctrlKey:true,cancelable:true}); preview.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBeFalse();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
