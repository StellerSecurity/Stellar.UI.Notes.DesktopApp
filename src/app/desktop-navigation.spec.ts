import { DeleteNoteModalComponent } from './delete-note-modal/delete-note-modal.component';
import { ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HomePage } from './home/home.page';
import { NoteListWindow } from './utils/note-list-window';
import { FolderOrder } from './utils/folder-order';

function home(): any {
  const p:any=Object.create(HomePage.prototype);
  p.notes=Array.from({length:4},(_,i)=>({id:String(i),title:`Note ${i}`,text:`<p>Body ${i}</p>`,last_modified:i}));
  p.filteredResults=p.notes; p.listOfCheckedCheckboxes=['0','1']; p.focusedNoteId='0'; p.selectionAnchor='0';
  p.noteService={selectedNoteId:'0',isNoteTemporaryDescripted:false,notesPasswordStored:null};
  p.should_display=true; p.activeFolderName='__all__';p.activeFilter='all';p.search_query='';p.folders=[];
  p.persistUiState=jasmine.createSpy('persist');p.restoreNotesListScroll=()=>{};
  p.router={url:'/note/0',navigate:jasmine.createSpy().and.resolveTo()};
  p.openOrCheckbox=(id:string)=>p.noteService.selectedNoteId=id;
  p.cdr={detectChanges:()=>{}}; return p;
}
@Component({standalone:false,template:`<div class="viewport" style="height:400px;overflow:auto;overflow-anchor:none"><div [style.height.px]="page.topNoteSpacer"></div><ng-container *ngFor="let row of page.visibleNoteRows; trackBy:page.trackVisibleRow"><div [style.height.px]="row.height"><div *ngIf="row.note" [id]="row.note.id" tabindex="-1" role="option">{{row.note.title}}</div></div></ng-container><div [style.height.px]="page.bottomNoteSpacer"></div></div>`})
class WindowFixture { page=home(); }

describe('Desktop keyboard and large note lists',()=>{
  beforeEach(()=>TestBed.configureTestingModule({imports:[CommonModule,TranslateModule.forRoot()],declarations:[WindowFixture,DeleteNoteModalComponent],providers:[{provide:ModalController,useValue:{dismiss:jasmine.createSpy().and.resolveTo(true)}}]}));
  it('Backspace opens the existing plural confirmation; cancelling preserves every note',async()=>{
    const p=home(); let dismiss!:(value:any)=>void;
    const modal={onDidDismiss:()=>new Promise(resolve=>dismiss=resolve),present:jasmine.createSpy().and.resolveTo()};
    p.modalCtrl={create:jasmine.createSpy().and.resolveTo(modal)};
    p.deleteNotesConfirm=jasmine.createSpy().and.resolveTo();
    const key=new KeyboardEvent('keydown',{key:'Backspace',cancelable:true});
    p.handleDesktopShortcuts(key);await Promise.resolve();
    expect(key.defaultPrevented).toBeTrue();
    expect(p.modalCtrl.create.calls.mostRecent().args[0].componentProps).toEqual({isSingleDelete:false,count:2});
    expect(p.deleteNotesConfirm).not.toHaveBeenCalled();
    dismiss({data:{confirm:false}});await Promise.resolve();
    expect(p.deleteNotesConfirm).not.toHaveBeenCalled();expect(p.notes.length).toBe(4);
  });
  it('requires confirmation before deleting and ignores held-key repeats',async()=>{
    const p=home(); let dismiss!:(value:any)=>void;
    p.modalCtrl={create:jasmine.createSpy().and.resolveTo({onDidDismiss:()=>new Promise(resolve=>dismiss=resolve),present:async()=>{}})};
    p.deleteNotesConfirm=jasmine.createSpy().and.resolveTo();
    p.handleDesktopShortcuts(new KeyboardEvent('keydown',{key:'Backspace'}));await Promise.resolve();
    p.handleDesktopShortcuts(new KeyboardEvent('keydown',{key:'Backspace',repeat:true}));
    expect(p.modalCtrl.create).toHaveBeenCalledTimes(1);expect(p.deleteNotesConfirm).not.toHaveBeenCalled();
    dismiss({data:{confirm:true}});await Promise.resolve();expect(p.deleteNotesConfirm).toHaveBeenCalledTimes(1);
  });
  it('focuses the destructive confirmation so Enter activates it, and dismisses only once',()=>{
    const hydrated=document.documentElement.classList.contains('hydrated');document.documentElement.classList.add('hydrated');
    try {
      const fixture=TestBed.createComponent(DeleteNoteModalComponent);document.body.appendChild(fixture.nativeElement);fixture.detectChanges();
      fixture.componentInstance.ionViewDidEnter();
      const button=fixture.nativeElement.querySelector('.destructive') as HTMLButtonElement;
      expect(document.activeElement).toBe(button);
      button.click();button.click();
      expect(TestBed.inject(ModalController).dismiss).toHaveBeenCalledOnceWith({confirm:true});
    } finally {if(!hydrated)document.documentElement.classList.remove('hydrated');}
  });
  it('deletes confirmed notes locally without opening a loading overlay',async()=>{
    const p=home();let stored='';
    p.noteService.appHasPasswordChallenge=()=>false;
    p.noteService.setNotes=(value:string)=>stored=value;
    p.noteService.getNotes=()=>stored;
    p.noteService.setDecryptedNotes=()=>{};
    p.authService={isLoggedIn:false};p.allTranslations={theSelectedNotesHasBeenDeleted:'Deleted'};
    p.toastController={create:async()=>({present:async()=>{}})};
    p.loadingController={create:jasmine.createSpy('loading').and.throwError('Deletion must not block on an overlay')};
    await p.deleteNotesConfirm();
    expect(JSON.parse(stored).map((note:any)=>note.id)).toEqual(['2','3']);
    expect(p.filteredResults.map((note:any)=>note.id)).toEqual(['3','2']);
    expect(p.loadingController.create).not.toHaveBeenCalled();
  });
  it('leaves editing keys, empty selection, composing text and folder focus alone',()=>{
    const p=home();p.deleteSelectedNotes=jasmine.createSpy();
    for(const tag of ['input','textarea','ion-input','ion-searchbar','select','div']){
      const target=document.createElement(tag);if(tag==='div')target.contentEditable='true';
      target.addEventListener('keydown',e=>p.handleDesktopShortcuts(e));
      target.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace'}));
    }
    const folder=document.createElement('button');folder.dataset['folderId']='f';folder.addEventListener('keydown',e=>p.handleDesktopShortcuts(e));folder.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace'}));
    p.handleDesktopShortcuts(new KeyboardEvent('keydown',{key:'Backspace',isComposing:true}));
    p.listOfCheckedCheckboxes=[];p.noteService.selectedNoteId=null;p.handleDesktopShortcuts(new KeyboardEvent('keydown',{key:'Backspace'}));
    expect(p.deleteSelectedNotes).not.toHaveBeenCalled();
  });
  it('does not open a second deletion prompt through another open dialog',()=>{
    const p=home();p.deleteSelectedNotes=jasmine.createSpy();const dialog=document.createElement('ion-alert');document.body.append(dialog);
    try {p.handleDesktopShortcuts(new KeyboardEvent('keydown',{key:'Backspace'}));expect(p.deleteSelectedNotes).not.toHaveBeenCalled();}finally{dialog.remove();}
  });
  it('Enter requests body focus for the selected note without changing its content',()=>{
    const p=home();p.listOfCheckedCheckboxes=['0'];const content=p.notes[0].text;
    p.onListKeydown(new KeyboardEvent('keydown',{key:'Enter'}));
    expect(p.noteService.editorFocusNoteId).toBe('0');expect(p.notes[0].text).toBe(content);
  });
  it('Enter on a folder opens the existing rename dialog without activating note shortcuts',()=>{
    const p=home(),folder={id:'f',name:'Work'};p.requestRenameFolder=jasmine.createSpy();
    const key=new KeyboardEvent('keydown',{key:'Enter',cancelable:true});p.renameFolderFromKeyboard(key,folder);
    expect(key.defaultPrevented).toBeTrue();expect(p.requestRenameFolder).toHaveBeenCalledOnceWith(folder);
  });
  it('renders a bounded number of rows for 10,000 notes and reaches the end with the keyboard',()=>{
    const hydrated=document.documentElement.classList.contains('hydrated');
    document.documentElement.classList.add('hydrated');
    try {
    const fixture=TestBed.createComponent(WindowFixture),p=fixture.componentInstance.page;
    fixture.nativeElement.style.cssText='display:block;position:fixed;inset:0';
    document.body.appendChild(fixture.nativeElement);
    p.notes=p.filteredResults=Array.from({length:10000},(_,i)=>({id:`large-${i}`,title:`Note ${i}`,last_modified:i}));
    p.listOfCheckedCheckboxes=[];p.focusedNoteId='large-0';
    p.notesListScroll={nativeElement:{scrollTop:0,clientHeight:400}};fixture.detectChanges();
    p.notesListScroll.nativeElement=fixture.nativeElement.querySelector('.viewport');
    p.cdr={detectChanges:()=>{fixture.changeDetectorRef.markForCheck();fixture.detectChanges();}};
    expect(fixture.nativeElement.querySelectorAll('[role=option]').length).toBeLessThan(25);
    expect(p.notesListScroll.nativeElement.clientHeight).withContext('Ionic test viewport must be visible').toBe(400);
    p.onListKeydown(new KeyboardEvent('keydown',{key:'End'}));fixture.detectChanges();
    expect(document.getElementById('large-9999')).not.toBeNull();
    expect(document.activeElement?.id).toBe('large-9999');
    expect(fixture.nativeElement.querySelectorAll('[role=option]').length).toBeLessThan(25);
    expect(p.getNotes().length).toBe(10000);
    p.onListKeydown(new KeyboardEvent('keydown',{key:'Home',shiftKey:true}));
    expect(p.listOfCheckedCheckboxes.length).toBe(10000);
    } finally { if (!hydrated) document.documentElement.classList.remove('hydrated'); }
  });
  it('accounts for pinned section headers and folder rows when restoring a deep scroll',()=>{
    const view=new NoteListWindow(),notes=Array.from({length:1000},(_,i)=>({id:String(i),pinned:i<2,folder:i%2?'Work':''}));
    view.update(notes,true,0,400);expect(view.visible[0].key).toBe('group:pinned');
    view.update(notes,true,40000,400);expect(view.top).toBeGreaterThan(39000);expect(view.visible.length).toBeLessThan(25);
    const first=view.visible[0],last=view.visible[view.visible.length-1];
    expect(first.offset+first.height).toBeGreaterThan(39700);
    expect(view.top + view.visible.reduce((sum,row)=>sum+row.height,0)+view.bottom).toBe(view.height);
    expect(last.offset+last.height).toBeGreaterThanOrEqual(40700);
    view.update(notes.slice(0,1),true,40000,400);expect(view.visible.some(row=>row.note?.id==='0')).toBeTrue();
  });
  it('groups by modification month and year, keeping pinned notes in their own section',()=>{
    const view=new NoteListWindow();
    const notes=[
      {id:'p',pinned:true,last_modified:new Date(2020,0,1).getTime()},
      {id:'a',title:'Created in June',last_modified:new Date(2026,9,23).getTime()},
      {id:'b',last_modified:new Date(2026,9,2).getTime()},
      {id:'c',last_modified:new Date(2026,8,1).getTime()},
      {id:'d',last_modified:new Date(2025,9,1).getTime()}
    ];
    view.update(notes,true,0,1000);
    expect(view.visible.filter(row=>!row.note).map(row=>row.key)).toEqual(['group:pinned','month:2026-9','month:2026-8','month:2025-9']);
    expect(view.visible.filter(row=>row.note).map(row=>row.note.id)).toEqual(['p','a','b','c','d']);
  });
  it('reuses extracted search fields and invalidates edits without indexing protected bodies',()=>{
    const p=home();p.search_query='body';p.search();
    const extracted=p.cachedSearchFields(p.notes[0]);
    for(const query of ['Body','note 2','body 3']){p.search_query=query;p.search();}
    expect(p.cachedSearchFields(p.notes[0])).toBe(extracted);
    p.notes[0].text='<p>Changed text</p>';p.search_query='changed';p.search();expect(p.getNotes().map((n:any)=>n.id)).toEqual(['0']);
    p.notes[0].protected=true;p.search();expect(p.getNotes()).toEqual([]);
    p.notes[0].protected=false;p.search();expect(p.getNotes().length).toBe(1);
  });
  it('coalesces scrolling storage writes instead of blocking each scroll event',fakeAsync(()=>{
    const p=home();for(let i=0;i<50;i++){p.onNotesListScroll();tick(10);}
    expect(p.persistUiState).not.toHaveBeenCalled();tick(180);expect(p.persistUiState).toHaveBeenCalledTimes(1);
  }));
});

describe('Folder order preferences',()=>{
  let saved:string|null;
  beforeEach(()=>{saved=localStorage.getItem('stellarNotesFolderOrder');localStorage.removeItem('stellarNotesFolderOrder');});
  afterEach(()=>{if(saved===null)localStorage.removeItem('stellarNotesFolderOrder');else localStorage.setItem('stellarNotesFolderOrder',saved);});
  it('persists alphabetical and custom order across reloads without altering folder records',()=>{
    const folders=[{id:'a',name:'Work'},{id:'b',name:'Alpha'},{id:'c',name:'Folder 2'}],copy=JSON.stringify(folders),order=new FolderOrder();
    expect(order.sort(folders).map(f=>f.id)).toEqual(['b','c','a']);
    expect(order.select('desc',folders).map(f=>f.id)).toEqual(['a','c','b']);
    expect(new FolderOrder().mode).toBe('desc');
    expect(order.move(folders,'c','a',false).map(f=>f.id)).toEqual(['c','a','b']);
    expect(new FolderOrder().sort([...folders].reverse()).map(f=>f.id)).toEqual(['c','a','b']);
    expect(JSON.stringify(folders)).toBe(copy);
    expect(order.move(folders,'missing','a',false)).toBe(folders);
  });
});
