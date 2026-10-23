import { Component, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NotePaneResizeDirective } from './note-pane-resize.directive';

@Component({standalone:true,imports:[NotePaneResizeDirective],styleUrls:['./home.page.scss'],template:`
  <div class="desktop-layout" [class.sidebar-hidden]="hidden" [style.width.px]="width" style="height:300px">
    <aside class="desktop-folders-pane" style="box-sizing:border-box"></aside>
    <div class="pane-divider folder-pane-divider" appNotePaneResize="folders" role="separator" aria-label="Folders width" [hidden]="hidden" tabindex="0"></div>
    <section class="desktop-notes-pane"><div class="note-row selected">Selected note</div></section>
    <div class="pane-divider note-pane-divider" appNotePaneResize="notes" role="separator" aria-label="Note list width" aria-orientation="vertical" tabindex="0"></div>
    <section class="desktop-editor-pane"><textarea aria-label="Note">Unchanged note</textarea></section>
  </div>`})
class ResizeFixture {width=1024;hidden=false;}

describe('Resizable note-list and editor panes',()=>{
  let fixture:any,root:HTMLElement,handle:HTMLElement,list:HTMLElement,editor:HTMLElement;
  let old:string|null,oldFolders:string|null,hydrated:boolean;
  const key='stellarNotesListWidth';
  function create():void {
    fixture=TestBed.createComponent(ResizeFixture);document.body.appendChild(fixture.nativeElement);fixture.changeDetectorRef.markForCheck();fixture.detectChanges();
    root=fixture.nativeElement.querySelector('.desktop-layout');handle=root.querySelector('.note-pane-divider')!;
    list=root.querySelector('.desktop-notes-pane')!;editor=root.querySelector('.desktop-editor-pane')!;
  }
  const width=()=>list.getBoundingClientRect().width;
  const pointer=(target:EventTarget,type:string,x:number,id=1)=>target.dispatchEvent(new PointerEvent(type,{clientX:x,pointerId:id,isPrimary:true,button:0,bubbles:true,cancelable:true}));
  const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  beforeEach(()=>{
    old=localStorage.getItem(key);localStorage.removeItem(key);
    oldFolders=localStorage.getItem('stellarNotesFoldersWidth');localStorage.removeItem('stellarNotesFoldersWidth');
    hydrated=document.documentElement.classList.contains('hydrated');document.documentElement.classList.add('hydrated');
    TestBed.configureTestingModule({imports:[ResizeFixture]});create();
  });
  afterEach(()=>{
    fixture?.destroy();TestBed.resetTestingModule();
    if(old===null)localStorage.removeItem(key);else localStorage.setItem(key,old);
    if(oldFolders===null)localStorage.removeItem('stellarNotesFoldersWidth');else localStorage.setItem('stellarNotesFoldersWidth',oldFolders);
    if(!hydrated)document.documentElement.classList.remove('hydrated');
  });
  it('resizes immediately outside Angular, sharing space with the editor without replacing note DOM',()=>{
    const note=list.querySelector('.note-row'),before=editor.getBoundingClientRect().width;
    const zone=fixture.ngZone as NgZone;
    zone.run(()=>pointer(handle,'pointerdown',520));
    expect(root.classList.contains('pane-resizing')).toBeTrue();expect(getComputedStyle(root).transitionProperty).toBe('none');
    zone.run(()=>pointer(window,'pointermove',640));
    expect(width()).toBeCloseTo(420,0);expect(editor.getBoundingClientRect().width).toBeCloseTo(before-120,0);
    expect(list.querySelector('.note-row')).toBe(note);expect(note!.classList.contains('selected')).toBeTrue();
    expect(root.querySelector('textarea')!.value).toBe('Unchanged note');
    expect(localStorage.getItem(key)).toBeNull();
    pointer(window,'pointerup',640);expect(localStorage.getItem(key)).toBe('420');
    expect(root.classList.contains('pane-resizing')).toBeFalse();
  });
  it('clamps both directions and retains at least 320px for the editor',()=>{
    pointer(handle,'pointerdown',520);pointer(window,'pointermove',2000);
    expect(width()).toBeCloseTo(482,0);expect(editor.getBoundingClientRect().width).toBeGreaterThanOrEqual(320);
    expect(handle.getAttribute('aria-valuenow')).toBe('482');
    pointer(window,'pointermove',0);expect(width()).toBeCloseTo(220,0);
    pointer(window,'pointerup',0);
  });
  it('ignores other pointers and secondary buttons and rolls back a cancelled drag',()=>{
    handle.dispatchEvent(new PointerEvent('pointerdown',{button:2,isPrimary:true,pointerId:1}));
    expect(root.classList.contains('pane-resizing')).toBeFalse();
    pointer(handle,'pointerdown',520);pointer(window,'pointermove',600,2);expect(width()).toBeCloseTo(300,0);
    pointer(window,'pointermove',600);pointer(window,'pointercancel',600);
    expect(root.classList.contains('pane-resizing')).toBeFalse();expect(localStorage.getItem(key)).toBeNull();
    expect(root.style.getPropertyValue('--notes-pane-width')).toBe('300px');
  });
  it('persists across re-entry and resets with double-click or adjusts using the keyboard',()=>{
    pointer(handle,'pointerdown',520);pointer(window,'pointerup',620);expect(localStorage.getItem(key)).toBe('400');fixture.destroy();create();
    expect(width()).toBeCloseTo(400,0);
    handle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));expect(localStorage.getItem(key)).toBe('300');
    handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));expect(localStorage.getItem(key)).toBe('310');
    handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}));expect(localStorage.getItem(key)).toBe('280');
    handle.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));expect(localStorage.getItem(key)).toBe('482');
    handle.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));expect(localStorage.getItem(key)).toBe('220');
  });
  it('clamps on window and sidebar changes without forgetting a wider saved preference',async()=>{
    fixture.destroy();localStorage.setItem(key,'600');create();root.style.transition='none';
    expect(width()).toBeCloseTo(482,0);
    fixture.componentInstance.hidden=true;fixture.changeDetectorRef.markForCheck();fixture.detectChanges();await frame();expect(width()).toBeCloseTo(600,0);
    fixture.componentInstance.hidden=false;fixture.changeDetectorRef.markForCheck();fixture.detectChanges();await frame();expect(width()).toBeCloseTo(482,0);
    fixture.componentInstance.width=900;fixture.changeDetectorRef.markForCheck();fixture.detectChanges();await frame();expect(width()).toBeCloseTo(358,0);
    fixture.componentInstance.width=1400;fixture.changeDetectorRef.markForCheck();fixture.detectChanges();await frame();expect(width()).toBeCloseTo(600,0);
    expect(localStorage.getItem(key)).toBe('600');
  });
  it('resizes the folder sidebar independently and remembers its own width',()=>{
    const folders=root.querySelector<HTMLElement>('.desktop-folders-pane')!;
    const divider=root.querySelector<HTMLElement>('.folder-pane-divider')!;
    pointer(divider,'pointerdown',220);pointer(window,'pointerup',300);
    expect(folders.getBoundingClientRect().width).toBeCloseTo(300,0);
    expect(width()).toBeCloseTo(300,0);expect(localStorage.getItem('stellarNotesFoldersWidth')).toBe('300');
    expect(localStorage.getItem(key)).toBeNull();
    fixture.destroy();create();expect(root.querySelector('.desktop-folders-pane')!.getBoundingClientRect().width).toBeCloseTo(300,0);
  });
  it('coordinates both dividers to preserve editor space and each preferred width',()=>{
    fixture.destroy();localStorage.setItem(key,'600');create();
    const divider=root.querySelector<HTMLElement>('.folder-pane-divider')!;
    pointer(divider,'pointerdown',220);pointer(window,'pointermove',1000);
    expect(root.querySelector('.desktop-folders-pane')!.getBoundingClientRect().width).toBeCloseTo(360,0);
    expect(width()).toBeCloseTo(342,0);expect(editor.getBoundingClientRect().width).toBeGreaterThanOrEqual(320);
    pointer(window,'pointerup',1000);expect(localStorage.getItem(key)).toBe('600');
    divider.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    expect(localStorage.getItem('stellarNotesFoldersWidth')).toBe('220');
    expect(root.style.getPropertyValue('--notes-pane-width')).toBe('482px');
    divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    expect(localStorage.getItem('stellarNotesFoldersWidth')).toBe('210');expect(divider.getAttribute('aria-valuenow')).toBe('210');
  });

  it('releases drag state on blur and removes global listeners when destroyed',()=>{
    pointer(handle,'pointerdown',520);pointer(window,'pointermove',600);window.dispatchEvent(new Event('blur'));
    expect(localStorage.getItem(key)).toBe('380');expect(root.classList.contains('pane-resizing')).toBeFalse();
    pointer(handle,'pointerdown',600);pointer(window,'pointermove',620);fixture.destroy();
    const value=root.style.getPropertyValue('--notes-pane-width');pointer(window,'pointermove',800);
    expect(root.style.getPropertyValue('--notes-pane-width')).toBe(value);expect(root.classList.contains('pane-resizing')).toBeFalse();
  });
});
