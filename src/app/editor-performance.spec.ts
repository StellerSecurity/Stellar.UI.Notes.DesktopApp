import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { AlertController } from '@ionic/angular';
import { QuillModule } from 'ngx-quill';
import Quill from 'quill';
import { QuillService } from 'ngx-quill';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import { RichTextEditorComponent } from './add-note/rich-text-editor/rich-text-editor.component';
import { AddNotePage } from './add-note/add-note.page';
import { HomePage } from './home/home.page';
import { CryptoService } from './services/crypto.service';

function sidebar(): any {
  const page: any = Object.create(HomePage.prototype);
  page.notes = [];
  page.filteredResults = [];
  page.activeFolderName = '__all__';
  page.activeFilter = 'all';
  page.search_query = '';
  page.noteService = {isNoteTemporaryDescripted: false, selectedNoteId: null, notesPasswordStored: null};
  page.restoreNotesListScroll = () => {};
  return page;
}

@Component({template: '<app-rich-text-editor [note_text]="text" (noteChange)="changed($event)"></app-rich-text-editor>'})
class EditorFixture {
  text = '';
  changes: string[] = [];
  changed(value: string): void { this.text = value; this.changes.push(value); }
}

@Component({template: '<div *ngFor="let note of page.getNotes(); trackBy: page.trackNoteById" [attr.data-note-id]="note.id">{{note.text}}</div>'})
class SidebarFixture { page = sidebar(); }

describe('Desktop typing and sidebar rendering', () => {
  beforeEach(() => TestBed.configureTestingModule({
    declarations: [EditorFixture, SidebarFixture, RichTextEditorComponent],
    imports: [CommonModule, FormsModule, HttpClientTestingModule, QuillModule.forRoot(), TranslateModule.forRoot()],
    providers: [{provide: AlertController, useValue: {}}, {provide: QuillService, useValue: { config: {}, getQuill: () => of(Quill), registerCustomModules: () => Promise.resolve() }}],
  }));

  it('does not filter, sort, or write storage during repeated sidebar rendering', () => {
    const fixture = TestBed.createComponent(SidebarFixture);
    const page = fixture.componentInstance.page;
    page.notes = Array.from({length: 200}, (_, id) => ({id: String(id), text: 'test '.repeat(100), last_modified: id}));
    page.applyFilters();
    const filter = spyOn(page, 'applyFilters').and.callThrough();
    const write = spyOn(Storage.prototype, 'setItem');
    for (let i = 0; i < 100; i++) fixture.detectChanges();
    expect(filter).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('[data-note-id]').length).toBe(200);
  });

  it('retains existing sidebar DOM nodes when a saved note refreshes the list', () => {
    const fixture = TestBed.createComponent(SidebarFixture);
    const page = fixture.componentInstance.page;
    page.notes = [{id:'a',text:'before',last_modified:1}, {id:'b',text:'other',last_modified:2}];
    page.applyFilters(); fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('[data-note-id="a"]');
    page.notes = page.notes.map((note: any) => ({...note, ...(note.id === 'a' ? {text:'after',last_modified:3} : {})}));
    page.applyFilters(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-note-id="a"]')).toBe(row);
    expect(row.textContent).toBe('after');
  });

  it('keeps search and clearing search within the selected folder and favorites', () => {
    const page = sidebar(); page.activeFolderName = 'Work'; page.activeFilter = 'favorites';
    page.notes = [
      {id:'a',title:'Plan',text:'<p>test</p>',folder:'Work',favorite:true,last_modified:1},
      {id:'b',title:'Plan',text:'test',folder:'Home',favorite:true,last_modified:2},
      {id:'c',title:'Plan',text:'test',folder:'Work',favorite:false,last_modified:3},
    ];
    page.search_query = 'plan test'; page.search();
    expect(page.getNotes().map((note: any) => note.id)).toEqual(['a']);
    page.search_query = ''; page.search();
    expect(page.getNotes().map((note: any) => note.id)).toEqual(['a']);
  });

  it('updates the sidebar at a bounded rate during continuous typing and cancels on leave', fakeAsync(() => {
    const page = sidebar(); const changes = new BehaviorSubject(false);
    page.noteService.noteIsUpdated$ = changes.asObservable(); page.noteService.getNotesAppPassword = () => '';
    page.subscriptions = []; page.setData = jasmine.createSpy('refresh');
    page.subscribeNoteUpdated();
    for (let i = 0; i < 50; i++) { changes.next(true); tick(10); }
    expect(page.setData.calls.count()).toBe(5);
    changes.next(true); page.subscriptions.forEach((sub: any) => sub.unsubscribe()); tick(500);
    expect(page.setData.calls.count()).toBe(5);
  }));

  it('caches protected previews without modifying ciphertext and forgets them on relock', () => {
    const page = sidebar(); page.cryptoService = new CryptoService();
    const cipher = page.cryptoService.encrypt('<p>private</p>', 'fixture-pass');
    page.filteredResults = [{id:'a',text:cipher,title:cipher,protected:true}];
    page.noteService = {selectedNoteId:'a', isNoteTemporaryDescripted:true, notesPasswordStored:'fixture-pass'};
    const decrypt = spyOn(page.cryptoService, 'decrypt').and.callThrough();
    const first = page.getNotes();
    expect(first[0].text).toBe('<p>private</p>');
    for (let i=0;i<100;i++) expect(page.getNotes()).toBe(first);
    expect(decrypt.calls.count()).toBe(2); expect(page.filteredResults[0].text).toBe(cipher);
    page.noteService.notesPasswordStored = null;
    expect(page.getNotes()[0].text).toBe(cipher);
    expect(page.previewPassword).toBeNull();
  });

  it('keeps input, cursor nodes and line breaks intact in a 2,000-line editor', fakeAsync(() => {
    const fixture = TestBed.createComponent(EditorFixture);
    const host = fixture.componentInstance;
    host.text = '<p>test æøå</p>'.repeat(2000);
    fixture.detectChanges(); tick(600); fixture.detectChanges(); tick();
    const root: HTMLElement = fixture.nativeElement.querySelector('.ql-editor');
    const quill = fixture.debugElement.children[0].componentInstance.quill;
    const line = root.firstElementChild!;
    const text = line.firstChild as Text;
    root.focus({preventScroll:true}); tick(100);
    const range = document.createRange(); range.setStart(text, 2); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    host.changes = [];
    const writes = spyOn(quill, 'setContents').and.callThrough();
    for (let i = 0; i < 30; i++) {
      text.insertData(2 + i, 'x');
      range.setStart(text, 3 + i); range.collapse(true);
      root.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:'x'}));
      // Drain Quill's MutationObserver synchronously inside fakeAsync.
      quill.update('user');
      fixture.detectChanges(); tick(1);
    }
    expect(host.changes.length).toBe(30);
    expect(writes).not.toHaveBeenCalled();
    expect(root.firstElementChild).toBe(line);
    expect(window.getSelection()!.anchorNode).toBe(text);
    expect(root.querySelectorAll('p').length).toBe(2000);
    root.dispatchEvent(new FocusEvent('blur')); fixture.detectChanges(); tick(400);
    expect(host.changes.length).toBe(30);
    fixture.destroy(); tick(1000);
  }));

  it('sanitizes each new input and avoids re-sanitizing the same parent echo', fakeAsync(() => {
    const fixture = TestBed.createComponent(EditorFixture); fixture.detectChanges(); tick(600);
    const c = fixture.debugElement.children[0].componentInstance as RichTextEditorComponent;
    const sanitizer = spyOn(TestBed.inject(DomSanitizer), 'sanitize').and.callThrough();
    c.onContentChange('<p>safe</p><img src=x onerror="alert(1)"><script>alert(2)</script>');
    fixture.detectChanges(); tick();
    expect(fixture.componentInstance.text).not.toContain('onerror');
    expect(fixture.componentInstance.text).not.toContain('<script');
    const calls = sanitizer.calls.count();
    fixture.detectChanges(); tick();
    expect(sanitizer.calls.count()).toBe(calls);
    c.onContentChange(fixture.componentInstance.text);
    expect(fixture.componentInstance.changes.length).toBe(1);
    fixture.destroy(); tick(1000);
  }));

  it('still saves every character locally before returning from the editor event', fakeAsync(() => {
    const page: any = Object.create(AddNotePage.prototype);
    let stored = JSON.stringify([{id:'other',text:'keep',last_modified:1}]);
    page.notes_id = 'typing'; page.note_locked = false; page.note_text = ''; page.note_title = 'Typing';
    page.notes_password_stored = ''; page.notes = []; page.currentNote = null;
    page.authService = {isLoggedIn:false};
    page.notesService = {getNotes:()=>stored, appHasPasswordChallenge:()=>false, setNotes:(value: string)=>stored=value,
      markPendingMutation:()=>{}, setNoteIsUpdatedSubject:()=>{}};
    for (let i=1;i<=50;i++) {
      page.onSave('x'.repeat(i));
      const notes = JSON.parse(stored);
      expect(notes.find((note: any)=>note.id==='typing').text).toBe('x'.repeat(i));
      expect(notes.find((note: any)=>note.id==='other').text).toBe('keep');
    }
    tick(10000);
  }));

  it('keeps automatic sync quiet but displays progress for an explicit refresh', async () => {
    const page = sidebar(); page.manualSyncRequests = 0; page.should_display = true;
    page.authService = {isLoggedIn:true}; page.hasInternetConnection = ()=>true;
    page.noteService.shouldAskForPassword = ()=>false;
    page.dataService = {setForceDownloadOnHome:()=>{}};
    let finish!: (result: boolean)=>void;
    page.remoteDownloadSync = {requestImmediateSync:()=>new Promise<boolean>(resolve=>finish=resolve)};
    const automatic = page.syncFromServer();
    expect(page.waitForSync && page.manualSyncRequests > 0).toBeFalse(); finish(false); await automatic;
    const manual = page.syncFromServer('manual');
    expect(page.waitForSync && page.manualSyncRequests > 0).toBeTrue(); finish(false); await manual;
    expect(page.waitForSync && page.manualSyncRequests > 0).toBeFalse();
  });
});

describe('Open desktop note receives persisted sync updates', () => {
  function setup() {
    const page: any = Object.create(AddNotePage.prototype);
    const local = {id:'open', text:'<p>before</p>', title:'Before', last_modified:1, protected:false};
    let stored: any[] = [{...local, text:'<p>phone</p><p>test</p><p>test</p>', title:'Phone', last_modified:2}];
    let pending: any = null;
    Object.assign(page, {viewActive:true, note_locked:false, notes_id:'open', currentNote:{...local},
      notes:[{...local}], note_text:local.text, note_title:local.title, editorFocused:true,
      authService:{isLoggedIn:true}, navController:{navigateRoot:jasmine.createSpy('navigateRoot')},
      richTextEditorComponent:{setExternalContent:jasmine.createSpy('setExternalContent')},
      notesService:{shouldAskForPassword:()=>false, getNotes:()=>JSON.stringify(stored),
        appHasPasswordChallenge:()=>false, getPendingMutation:()=>pending,
        reconcileServerConfirmation:jasmine.createSpy('reconcileServerConfirmation')}});
    return {page, store:(value:any[])=>stored=value, pending:(value:any)=>pending=value};
  }
  it('updates a focused but clean editor without reopening or uploading', () => {
    const {page}=setup(); page.refreshSyncedNote();
    expect(page.note_text).toBe('<p>phone</p><p>test</p><p>test</p>');
    expect(page.note_title).toBe('Phone');
    expect(page.richTextEditorComponent.setExternalContent).toHaveBeenCalledWith(page.note_text);
  });
  it('retains pending edits for the outbox conflict/version-choice flow, even on blur', () => {
    const f=setup(); f.pending({type:'upsert',localUpdatedAt:3});
    f.page.pendingLiveNote={text:'stale deferred response',last_modified:99};
    f.page.onEditorFocusChange(false);
    expect(f.page.note_text).toBe('<p>before</p>');
    expect(f.page.notesService.reconcileServerConfirmation).not.toHaveBeenCalled();
    f.pending(null); f.page.refreshSyncedNote();
    expect(f.page.note_title).toBe('Phone');
  });
  for (const flag of ['typing','isEditingTitle','note_locked']) {
    it('does not replace content while '+flag, () => {
      const {page}=setup(); page[flag]=true; page.refreshSyncedNote();
      expect(page.richTextEditorComponent.setExternalContent).not.toHaveBeenCalled();
    });
  }
  it('ignores updates after logout or leaving the view', () => {
    const {page}=setup(); page.authService.isLoggedIn=false; page.refreshSyncedNote();
    page.authService.isLoggedIn=true; page.viewActive=false; page.refreshSyncedNote();
    expect(page.richTextEditorComponent.setExternalContent).not.toHaveBeenCalled();
  });
  it('does not apply an older version or a different note', () => {
    const f=setup(); f.page.currentNote.last_modified=3; f.page.refreshSyncedNote();
    expect(f.page.richTextEditorComponent.setExternalContent).not.toHaveBeenCalled();
    f.page.notes_id='other'; f.page.currentNote={id:'other',last_modified:3};
    f.store([{id:'open',text:'wrong note',last_modified:10}]); f.page.refreshSyncedNote();
    expect(f.page.richTextEditorComponent.setExternalContent).not.toHaveBeenCalled();
  });
  it('closes a remotely deleted note instead of resurrecting it', () => {
    const f=setup(); f.store([]); f.page.refreshSyncedNote();
    expect(f.page.note_text).toBe(''); expect(f.page.note_locked).toBeTrue();
    expect(f.page.navController.navigateRoot).toHaveBeenCalledWith('/home');
  });
  it('does not expose newly protected ciphertext', () => {
    const f=setup(); f.store([{id:'open',protected:true,text:'ciphertext',last_modified:2}]);
    f.page.refreshSyncedNote(); expect(f.page.note_text).toBe('');
    expect(f.page.richTextEditorComponent.setExternalContent).not.toHaveBeenCalled();
  });
});
