import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { AlertController } from '@ionic/angular';
import { AngularEditorModule } from '@wfpena/angular-wysiwyg';
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
    imports: [CommonModule, FormsModule, HttpClientTestingModule, AngularEditorModule],
    providers: [{provide: AlertController, useValue: {}}],
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
    fixture.detectChanges(); tick(600); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement.querySelector('.angular-editor-textarea');
    const line = root.firstElementChild!;
    const text = line.firstChild as Text;
    root.focus({preventScroll:true}); tick(100);
    const range = document.createRange(); range.setStart(text, 2); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    host.changes = [];
    const started = performance.now();
    for (let i = 0; i < 30; i++) {
      text.insertData(2 + i, 'x');
      range.setStart(text, 3 + i); range.collapse(true);
      root.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:'x'}));
      fixture.detectChanges(); tick(1);
    }
    console.info('EDITOR_PERFORMANCE_2000_LINES_30_INPUTS_MS', Math.round(performance.now()-started));
    expect(host.changes.length).toBe(30);
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
    expect(sanitizer.calls.count()).toBe(1);
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
