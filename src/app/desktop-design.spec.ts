import { HomePage } from './home/home.page';
import { AddNotePage } from './add-note/add-note.page';
import { AppSettingsPage } from './app-settings/app-settings.page';
import { NoteLockedModalComponent } from './note-locked-modal/note-locked-modal.component';
import { ForgotPasswordComponent } from './profile/forgot-password/forgot-password.component';
import { CreateAccountComponent } from './profile/create-account/create-account.component';
import { AuthService } from './services/auth.service';
import { UserMenuComponent } from './user-menu/user-menu.component';
import { FormBuilder } from '@angular/forms';
import { desktopNoteDate, selectionRange } from './utils/desktop-note-presentation';
import { notePreviewText } from './utils/note-search';
import { CryptoService } from './services/crypto.service';
import { of } from 'rxjs';

function home(): any {
  const page: any = Object.create(HomePage.prototype);
  page.notes = ['a', 'b', 'c', 'd'].map(id => ({id, title: id, text: '<p>Text</p>', last_modified: 1}));
  page.filteredResults = page.notes;
  page.listOfCheckedCheckboxes = ['a']; page.selectionAnchor = 'a'; page.focusedNoteId = 'a';
  page.noteService = { selectedNoteId: 'a', isNoteTemporaryDescripted: false, notesPasswordStored: null };
  page.router = { url: '/note/a', navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
  page.openOrCheckbox = jasmine.createSpy('open'); page.persistUiState = () => {}; page.restoreNotesListScroll = () => {};
  page.displayCache = new WeakMap(); page.activeFolderName = '__all__'; page.activeFilter = 'all'; page.search_query = '';
  page.draggingNoteIds = []; page.folders = [];
  page.cdr = {detectChanges:jasmine.createSpy('detectChanges')};
  return page;
}
describe('Desktop design interactions', () => {
  it('selects a range in either direction using the filtered visual order', () => {
    expect(selectionRange(['a','c','d'], 'd', 'a')).toEqual(['a','c','d']);
    expect(selectionRange(['a','c'], 'missing', 'c')).toEqual(['c']);
    expect(selectionRange(['a'], 'a', 'missing')).toEqual([]);
  });
  it('uses command-click to select several notes and clears the temporary note password', () => {
    const p = home(); p.noteService.notesPasswordStored = 'synthetic'; p.noteService.isNoteTemporaryDescripted = true;
    p.selectDesktopNote(new MouseEvent('click', {metaKey:true}), p.notes[2]);
    expect(p.listOfCheckedCheckboxes).toEqual(['a','c']);
    expect(p.noteService.notesPasswordStored).toBeNull();
    expect(p.noteService.isNoteTemporaryDescripted).toBeFalse();
    expect(p.router.navigate).toHaveBeenCalledWith(['/home'], {queryParams:{selection:'multiple'}});
  });
  it('uses shift-click without moving the range anchor', () => {
    const p=home(); p.selectDesktopNote(new MouseEvent('click',{shiftKey:true}),p.notes[2]);
    expect(p.listOfCheckedCheckboxes).toEqual(['a','b','c']); expect(p.selectionAnchor).toBe('a');
  });
  it('opens the remaining note when command-click reduces selection to one', () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','c']; p.noteService.selectedNoteId=null;
    p.selectDesktopNote(new MouseEvent('click',{ctrlKey:true}),p.notes[0]);
    expect(p.listOfCheckedCheckboxes).toEqual(['c']); expect(p.openOrCheckbox).toHaveBeenCalledWith('c');
  });
  it('keeps the view count stable while searching and discards invisible selections', () => {
    const p=home(); p.search_query='a'; p.listOfCheckedCheckboxes=['b','c']; p.applyFilters();
    expect(p.viewCount()).toBe(4); expect(p.getNotes().map((n:any)=>n.id)).toEqual(['a']); expect(p.listOfCheckedCheckboxes).toEqual([]);
  });
  it('never uses encrypted title or body as a locked note preview', () => {
    const p=home(); const note={id:'private', protected:true, title:'cipher title',text:'cipher body'};
    expect(p.noteHeading(note)).toBe('Locked note'); expect(p.notePreview(note)).toBe('');
  });
  it('preserves casing and separates HTML blocks without interpreting markup', () => {
    expect(notePreviewText('<p>Milk &amp; Bread</p><p>Bring Apples</p>')).toBe('Milk & Bread Bring Apples');
    expect(notePreviewText('<script>private()</script><p>Safe</p>')).toBe('Safe');
    expect(notePreviewText('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>');
  });
  it('uses local calendar days for yesterday and includes the year for older notes', () => {
    const now=new Date(2026,9,23,0,5);
    expect(desktopNoteDate(new Date(2026,9,22,23,59).getTime(),now)).toBe('Yesterday');
    expect(desktopNoteDate(new Date(2024,1,3).getTime(),now)).toContain('2024');
  });
  it('retains duplicate folder input and shows an inline error without writing storage', async () => {
    const p=home(); p.folders=[{id:'1',name:'Work'}]; p.folderDialogTarget=null; p.folderDialogName='work'; p.folderDialogOpen=true;
    await p.saveFolderDialog(); expect(p.folderDialogOpen).toBeTrue(); expect(p.folderDialogName).toBe('work'); expect(p.folderDialogError).toContain('already exists');
  });
  it('moves the latest durable note without overwriting a newer edit', async () => {
    const p=home(); let saved=''; p.notes=[{id:'a',text:'stale',title:'old',last_modified:1}]; p.folders=[{id:'folder',name:'Work'}];
    const latest={id:'a',text:'new edit',title:'new title',protected:true,last_modified:2};
    p.noteService={getNotes:()=>JSON.stringify([latest]), appHasPasswordChallenge:()=>false, markPendingMutation:jasmine.createSpy(),currentNote:{...latest}};
    p.rebuildFolders=()=>{}; p.syncFoldersManifest=()=>{}; p.persistNotes=()=>{saved=JSON.stringify(p.notes);};
    await p.assignNoteToFolder('a','Work');
    expect(JSON.parse(saved)[0]).toEqual(jasmine.objectContaining({text:'new edit', title:'new title', protected:true, folder_id:'folder'}));
    expect(p.noteService.currentNote.folder).toBe('Work');
  });
  it('drags the entire selected group with a stack and keeps it stable until drop', async () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','b','c']; p.folders=[{id:'work',name:'Work'}];
    const transfer=new DataTransfer(); const stack=spyOn(transfer,'setDragImage');
    p.onNoteDragStart(new DragEvent('dragstart',{dataTransfer:transfer}),p.notes[1]);
    expect(p.draggingNoteIds).toEqual(['a','b','c']);
    expect(stack).toHaveBeenCalled(); expect(stack.calls.mostRecent().args[0] instanceof HTMLCanvasElement).toBeTrue();
    const ghost=stack.calls.mostRecent().args[0]; expect(ghost.isConnected).toBeTrue();
    p.onNoteDragMove(new DragEvent('dragover',{clientX:100,clientY:100}));
    expect(p.dragPreviewX).toBe(106); expect(p.dragPreviewY).toBe(106);
    p.onNoteDragMove(new DragEvent('dragover',{clientX:window.innerWidth,clientY:window.innerHeight}));
    expect(p.dragPreviewX+248).toBeLessThanOrEqual(window.innerWidth);
    expect(p.dragPreviewY+82).toBeLessThanOrEqual(window.innerHeight);
    expect(transfer.getData('text/plain')).toBe('');
    // A list refresh while dragging must not silently replace the dragged group.
    p.listOfCheckedCheckboxes=['d']; p.filteredResults=[p.notes[3]];
    p.assignNotesToFolder=jasmine.createSpy('move group').and.resolveTo();
    await p.onFolderDrop(new DragEvent('drop',{dataTransfer:transfer}),'Work');
    expect(p.assignNotesToFolder).toHaveBeenCalledOnceWith(['a','b','c'],'Work');
    expect(p.draggingNoteIds).toEqual([]); expect(p.draggingFolderTarget).toBeNull();
    expect(ghost.isConnected).toBeFalse();
  });
  it('drags only the grabbed note when it is outside the selected group', async () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','b']; p.folders=[{id:'work',name:'Work'}];
    const transfer=new DataTransfer(); const stack=spyOn(transfer,'setDragImage');
    p.onNoteDragStart(new DragEvent('dragstart',{dataTransfer:transfer}),p.notes[2]);
    p.assignNotesToFolder=jasmine.createSpy().and.resolveTo();
    await p.onFolderDrop(new DragEvent('drop',{dataTransfer:transfer}),'Work');
    expect(p.assignNotesToFolder).toHaveBeenCalledOnceWith(['c'],'Work'); expect(stack).not.toHaveBeenCalled();
  });
  it('does not move notes after cancellation or from an external drag payload', async () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','b']; p.folders=[{id:'work',name:'Work'}];
    const transfer=new DataTransfer();
    p.onNoteDragStart(new DragEvent('dragstart',{dataTransfer:transfer}),p.notes[0]);
    p.onFolderDragOver(new DragEvent('dragover',{dataTransfer:transfer}),'Work');
    expect(p.draggingFolderTarget).toBe('Work');
    p.onNoteDragEnd();
    transfer.setData('text/plain','a');
    p.assignNotesToFolder=jasmine.createSpy().and.resolveTo();
    await p.onFolderDrop(new DragEvent('drop',{dataTransfer:transfer}),'Work');
    expect(p.assignNotesToFolder).not.toHaveBeenCalled(); expect(p.draggingFolderTarget).toBeNull();
  });
  it('does not move a group into a folder removed during the drag', async () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','b'];
    p.onNoteDragStart(new DragEvent('dragstart'),p.notes[0]);
    p.assignNotesToFolder=jasmine.createSpy().and.resolveTo();
    await p.onFolderDrop(new DragEvent('drop'),'Removed folder');
    expect(p.assignNotesToFolder).not.toHaveBeenCalled(); expect(p.draggingNoteIds).toEqual([]);
  });
  it('finishes a drop on empty app space immediately without moving notes', () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','b'];
    const transfer=new DataTransfer(); p.onNoteDragStart(new DragEvent('dragstart',{dataTransfer:transfer}),p.notes[0]);
    const ghost=p.dragGhost;
    const over=new DragEvent('dragover',{dataTransfer:transfer,cancelable:true}); p.onNoteDragMove(over);
    expect(over.defaultPrevented).toBeTrue();
    p.assignNotesToFolder=jasmine.createSpy();
    const drop=new DragEvent('drop',{dataTransfer:transfer,cancelable:true}); p.onNoteBackgroundDrop(drop);
    expect(drop.defaultPrevented).toBeTrue(); expect(p.draggingNoteIds).toEqual([]); expect(ghost.isConnected).toBeFalse();
    expect(p.assignNotesToFolder).not.toHaveBeenCalled(); expect(p.listOfCheckedCheckboxes).toEqual(['a','b']);
    const external=new DragEvent('dragover',{cancelable:true}); p.onNoteDragMove(external);
    expect(external.defaultPrevented).toBeFalse();
  });
  it('clears the stack before starting folder persistence', async () => {
    const p=home(); p.listOfCheckedCheckboxes=['a','b']; p.folders=[{id:'work',name:'Work'}];
    p.onNoteDragStart(new DragEvent('dragstart'),p.notes[0]);
    p.assignNotesToFolder=jasmine.createSpy().and.resolveTo();
    const move=p.onFolderDrop(new DragEvent('drop'),'Work');
    expect(p.draggingNoteIds).toEqual([]); expect(p.cdr.detectChanges).toHaveBeenCalled();
    expect(p.assignNotesToFolder).not.toHaveBeenCalled();
    await move; expect(p.assignNotesToFolder).toHaveBeenCalledOnceWith(['a','b'],'Work');
  });
  it('persists a group once under app encryption while preserving current bodies, flags, and sync mutations', async () => {
    const p=home(); p.cryptoService=new CryptoService(); p.folders=[{id:'work',name:'Work'}]; p.activeFolderName='Inbox';
    const latest=[
      {id:'a',title:'Current title',text:'Current body',folder:'Inbox',favorite:true,last_modified:10},
      {id:'b',title:'encrypted title',text:'encrypted body',folder:'Inbox',protected:true,pinned:true,last_modified:11},
      {id:'c',title:'Unselected',text:'Keep me',folder:'Inbox',last_modified:12},
      {id:'d',deleted:true,folder:'Inbox',last_modified:13},
    ];
    const password='synthetic test password'; let stored=p.cryptoService.encrypt(JSON.stringify(latest),password);
    const write=jasmine.createSpy('write').and.callFake((value:string)=>{stored=value;});
    p.noteService={getNotes:()=>stored,setNotes:write,appHasPasswordChallenge:()=>true,getNotesAppPassword:()=>password,
      markPendingMutation:jasmine.createSpy(),setNoteIsUpdatedSubject:jasmine.createSpy(),currentNote:{...latest[0]}};
    p.rebuildFolders=jasmine.createSpy(); p.syncFoldersManifest=jasmine.createSpy();
    p.listOfCheckedCheckboxes=['a','b'];
    await p.assignNotesToFolder(['a','b','a','d'],'Work');
    expect(write).toHaveBeenCalledTimes(1); expect(stored).not.toContain('Current body');
    const saved=JSON.parse(p.cryptoService.decrypt(stored,password));
    expect(saved[0]).toEqual({...latest[0],folder:'Work',folder_id:'work',last_modified:saved[0].last_modified});
    expect(saved[1]).toEqual({...latest[1],folder:'Work',folder_id:'work',last_modified:saved[0].last_modified});
    expect(saved[0].last_modified).toBeGreaterThan(13); expect(saved.slice(2)).toEqual(latest.slice(2));
    expect(p.noteService.markPendingMutation.calls.allArgs()).toEqual([['a','move',saved[0].last_modified],['b','move',saved[0].last_modified]]);
    expect(p.listOfCheckedCheckboxes).toEqual([]); expect(p.noteService.currentNote.folder).toBe('Work');
  });
  it('keeps sidebar and account menu on the same restored session state', async () => {
    const secure={getItem:async(key:string)=>key==='ssToken'?'synthetic-token':JSON.stringify({email:'fixture@example.invalid'})};
    const auth=new AuthService({} as any,secure as any);
    const menu:any=Object.create(UserMenuComponent.prototype); menu.authService=auth; menu.secureStorageService=secure;
    const p=home(); p.authService=auth;
    await menu.loadUserData();
    expect(p.isLoggedIn()).toBeTrue(); expect(menu.isUserIsLoggedIn).toBeTrue();
    auth.setLoggedInState(false);
    expect(p.isLoggedIn()).toBeFalse(); expect(menu.isUserIsLoggedIn).toBeFalse();
  });
  it('does not let a delayed storage read overwrite a later login or logout', async () => {
    let finish!:(value:string|null)=>void;
    const auth=new AuthService({} as any,{getItem:()=>new Promise<string|null>(resolve=>{finish=resolve;})} as any);
    auth.setLoggedInState(true); finish(null); await Promise.resolve();
    expect(auth.isLoggedIn).toBeTrue();
    const refresh=auth.initializeAuthState(); auth.setLoggedInState(false); finish('stale-token'); await refresh;
    expect(auth.isLoggedIn).toBeFalse();
  });
  for (const failKey of [false,true]) {
    it(failKey ? 'does not publish a new account session if key import fails' : 'publishes a new account session only after its key and account are saved', async () => {
      const p:any=Object.create(CreateAccountComponent.prototype); const saved=new Map<string,string>();
      p.createUserForm=new FormBuilder().group({email:['fixture@example.invalid'],password:['synthetic password']});
      p.authService={createAccount:(payload:any)=>of({response_code:200,token:'synthetic-token',user:{id:'fixture',email:'fixture@example.invalid',crypto_version:payload.crypto_version,kdf_params:payload.kdf_params,kdf_salt_b64:payload.kdf_salt,eak_b64:payload.eak}}),
        setLoggedInState:jasmine.createSpy().and.callFake(()=>{expect(saved.has('ssToken')).toBeTrue();expect(saved.has('ssUser')).toBeTrue();expect(saved.has('ssEakB64')).toBeTrue();})};
      p.secureStorageService={setItem:async(key:string,value:string)=>{saved.set(key,value);}};
      p.cryptoKeyService={importEAK:async()=>{if(failKey)throw new Error('Synthetic import failure');}};
      p.notesService={appHasPasswordChallenge:()=>false,getNotes:()=>'',getDecryptedNotes:()=>null};
      p.dataService={setForceDownloadOnHome:()=>{}}; p.router={navigate:jasmine.createSpy().and.resolveTo(true)};
      await p.createAccount();
      if(failKey){expect(saved.has('ssToken')).toBeFalse();expect(p.authService.setLoggedInState).not.toHaveBeenCalled();}
      else {expect(p.authService.setLoggedInState).toHaveBeenCalledOnceWith(true);expect(p.router.navigate).toHaveBeenCalled();}
    });
  }
  it('rejects short new note passwords without touching note encryption', async () => {
    const p:any=Object.create(AddNotePage.prototype); p.notes_password_input='short';p.notes_password_confirm='short';
    await p.lockNote(); expect(p.lockError).toContain('6'); expect(p.notes_password_stored).toBeUndefined();
  });
  it('rejects mismatched new app passwords before touching key storage', async () => {
    const p:any=Object.create(AppSettingsPage.prototype); p.notesAppPassword='long enough'; p.confirmPassword='different';
    await p.save(); expect(p.passwordError).toContain('match');
  });
  it('keeps a wrong unlock password in the same modal and accepts a legacy short password', async () => {
    const dismiss=jasmine.createSpy().and.resolveTo(); const p=new NoteLockedModalComponent({dismiss} as any);
    p.passwordInput={value:'wrong'} as any; p.validatePassword=async value=>value==='ok';
    await p.dismiss(true); expect(dismiss).not.toHaveBeenCalled(); expect(p.passwordInput.value).toBe('wrong'); expect(p.error).toContain('Incorrect');
    p.passwordInput.value='ok'; await p.dismiss(true); expect(dismiss).toHaveBeenCalledWith({confirm:true,inputValue:'ok'});
  });
  it('keeps old two-character note passwords decryptable', () => {
    const p:any=Object.create(AddNotePage.prototype); p.cryptoService=new CryptoService();
    const note={text:p.cryptoService.encrypt('legacy note','ok'),title:p.cryptoService.encrypt('Legacy','ok')};
    expect(p.decryptNote('ok',note)).toBeTrue(); expect(p.note_text).toBe('legacy note');
  });
  it('continues reset through navigation state without placing the code in the URL', () => {
    const p:any=Object.create(ForgotPasswordComponent.prototype); p.otpValue='123456'; p.email='fixture@example.invalid';p.router={navigate:jasmine.createSpy()};
    p.continueWithCode(); expect(p.router.navigate).toHaveBeenCalledWith(['/profile/create-new-password'],{state:{email:p.email,confirmationCode:'123456'}});
  });
  it('resends through the existing API and rate-limits repeated clicks', () => {
    const p:any=Object.create(ForgotPasswordComponent.prototype); p.isProcessing=false;p.resendAfter=0;p.showVerification=true;
    p.forgotPasswordForm={valid:true,get:()=>({value:'fixture@example.invalid'})};p.authService={forgotPassword:jasmine.createSpy().and.returnValue(of({response_code:200}))};
    p.resendCode();p.resendCode();expect(p.authService.forgotPassword).toHaveBeenCalledTimes(1);expect(p.codeNotice).toContain('sent');
  });
});
