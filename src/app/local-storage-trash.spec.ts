import { LocalNoteStorage } from './services/local-note-storage.service';
import { NotesService } from './services/notes.service';
import { CryptoService } from './services/crypto.service';
import { searchPresentation } from './utils/search-presentation';
import { FolderPickerComponent } from './folder-picker/folder-picker.component';
import { HomePage } from './home/home.page';

const image='data:image/png;base64,aGVsbG8=';
const sample=()=>[{id:'one',title:'Private title',text:`<p>Hello<img src="${image}"></p>`,last_modified:100},{id:'two',title:'Second',text:'<p>Other</p>',last_modified:200}];
const crypt=new CryptoService();
const req=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});

describe('Encrypted local note records, attachments and opt-in Trash',()=>{
  const stores:LocalNoteStorage[]=[];
  const store=()=>{const value=new LocalNoteStorage();stores.push(value);return value;};
  beforeEach(async()=>{localStorage.clear();await req(indexedDB.deleteDatabase('stellar-notes-local-v2'));});
  afterEach(async()=>{for(const value of stores)(value as any).db?.close();stores.length=0;await req(indexedDB.deleteDatabase('stellar-notes-local-v2'));localStorage.clear();});
  async function boot(notes=sample()) {
    localStorage.setItem('notes',JSON.stringify(notes));
    const disk=store(),service=new NotesService(disk);await service.initializePersistence();return {disk,service};
  }
  it('migrates only after a successful atomic write and stores attachments outside note records',async()=>{
    const {disk,service}=await boot();expect(localStorage.getItem('notes')).toBeNull();
    expect(JSON.parse(service.getNotes())).toEqual(sample());
    const db=(disk as any).db as IDBDatabase;
    const sealed=await req(db.transaction('records').objectStore('records').getAll());
    expect(sealed.length).toBe(2);expect(sealed.every(value=>value.cipher instanceof ArrayBuffer)).toBeTrue();
    const records=await Promise.all(sealed.map(value=>(disk as any).unseal(value)));
    expect(JSON.stringify(records)).not.toContain(image);expect(JSON.stringify(records)).toContain('stellar-local-asset:');
    const assets=await req(db.transaction('assets').objectStore('assets').getAll());expect(assets.length).toBe(1);
    expect(new TextDecoder().decode(assets[0].cipher)).not.toContain('aGVsbG8=');
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(JSON.parse(reloaded.getNotes())).toEqual(sample());
  });
  it('stores a large image without writing the notes collection to localStorage',async()=>{
    const {service}=await boot([]);const large='data:image/png;base64,'+'A'.repeat(6*1024*1024);
    const write=spyOn(Storage.prototype,'setItem').and.callThrough();
    service.setNotes(JSON.stringify([{id:'large',text:`<p><img src="${large}"></p>`}]));await service.flushPersistence();
    expect(write.calls.allArgs().some(args=>args[0]==='notes')).toBeFalse();
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(JSON.parse(reloaded.getNotes())[0].text).toContain(large);
  });
  it('writes only changed records and reuses image blobs when another note changes',async()=>{
    const {service}=await boot();const put=spyOn(IDBObjectStore.prototype,'put').and.callThrough();
    const notes=sample();notes[1].title='Edited';service.setNotes(JSON.stringify(notes));await service.flushPersistence();
    const calls=put.calls.all();
    expect(calls.filter(call=>(call.object as IDBObjectStore).name==='assets').length).toBe(0);
    expect(calls.filter(call=>(call.object as IDBObjectStore).name==='records').map(call=>String(call.args[1]))).toEqual(['notes:two']);
  });
  it('roundtrips password-protected notes, images and empty collections across restart',async()=>{
    const {service}=await boot();const password='synthetic password';
    service.setNotesAppPassword(password);service.setNotes(crypt.encrypt(JSON.stringify(sample()),password));localStorage.setItem('app_password_challenge','1');await service.flushPersistence();
    const reloaded=new NotesService(store());await reloaded.initializePersistence();
    expect(()=>crypt.decrypt(reloaded.getNotes(),'wrong')).toThrow();
    expect(JSON.parse(crypt.decrypt(reloaded.getNotes(),password))).toEqual(sample());
    reloaded.setNotesAppPassword(password);reloaded.setNotes(crypt.encrypt('[]',password));await reloaded.flushPersistence();
    const empty=new NotesService(store());await empty.initializePersistence();
    expect(()=>crypt.decrypt(empty.getNotes(),'wrong')).toThrow();expect(crypt.decrypt(empty.getNotes(),password)).toBe('[]');
  });
  it('encrypts every record and asset when the app password is enabled immediately after restart',async()=>{
    await boot();const service=new NotesService(store());await service.initializePersistence();const password='new password after restart';
    service.setNotesAppPassword(password);service.setNotes(crypt.encrypt(JSON.stringify(sample()),password));localStorage.setItem('app_password_challenge','1');await service.flushPersistence();
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(()=>crypt.decrypt(reloaded.getNotes(),'wrong')).toThrow();expect(JSON.parse(crypt.decrypt(reloaded.getNotes(),password))).toEqual(sample());
    expect(reloaded.getNotes()).not.toContain('Private title');
  });
  it('recovers lock state from the committed transaction if the settings flag update was interrupted',async()=>{
    const {service}=await boot();const password='interrupted password setup';service.setNotesAppPassword(password);service.setNotes(crypt.encrypt(JSON.stringify(sample()),password));await service.flushPersistence();
    localStorage.removeItem('app_password_challenge');
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(reloaded.appHasPasswordChallenge()).toBeTrue();expect(JSON.parse(crypt.decrypt(reloaded.getNotes(),password))).toEqual(sample());
    expect(()=>reloaded.setNotes('[]')).toThrow();
  });
  it('preserves locked legacy ciphertext until unlocking, then separates its attachments',async()=>{
    const password='legacy test password',cipher=crypt.encrypt(JSON.stringify(sample()),password);
    localStorage.setItem('notes',cipher);localStorage.setItem('app_password_challenge','1');
    const service=new NotesService(store());await service.initializePersistence();expect(service.getNotes()).toBe(cipher);
    expect(JSON.parse(crypt.decrypt(service.getNotes(),password))).toEqual(sample());
    service.setNotesAppPassword(password);await service.flushPersistence();
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(JSON.parse(crypt.decrypt(reloaded.getNotes(),password))).toEqual(sample());
  });
  it('preserves the legacy source when migration storage fails',async()=>{
    const source=JSON.stringify(sample());localStorage.setItem('notes',source);
    const disk=store();spyOn(disk,'write').and.rejectWith(new Error('quota'));
    const service=new NotesService(disk);await expectAsync(service.initializePersistence()).toBeRejected();
    expect(localStorage.getItem('notes')).toBe(source);await expectAsync(service.flushPersistence()).toBeRejected();
  });
  it('keeps Trash disabled unless explicitly enabled and stores the canonical protected note',async()=>{
    const {service}=await boot();expect(service.trashEnabled).toBeFalse();expect(await service.captureTrash(sample())).toEqual([]);expect(service.getTrash()).toEqual([]);
    const protectedNote={id:'locked',protected:true,title:'cipher-title',text:'cipher-body'};
    service.setNotes(JSON.stringify([protectedNote]));await service.flushPersistence();service.trashEnabled=true;
    await service.captureTrash([{...protectedNote,text:'temporary plaintext'}]);expect(service.getTrash()[0].note.text).toBe('cipher-body');
    service.trashEnabled=false;expect(service.getTrash().length).toBe(1);
  });
  it('restores a new ID to avoid server tombstones, keeps formatting and persists the result',async()=>{
    const {service}=await boot();service.trashEnabled=true;const ids=await service.captureTrash([sample()[0]]);
    service.setNotes(JSON.stringify([sample()[1]]));await service.flushPersistence();
    const restored=await service.restoreTrash(ids);expect(restored.length).toBe(1);expect(restored[0].id).not.toBe('one');expect(restored[0].text).toBe(sample()[0].text);expect(restored[0].base_version).toBe(0);expect(service.getTrash()).toEqual([]);
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(JSON.parse(reloaded.getNotes()).length).toBe(2);expect(reloaded.getTrash()).toEqual([]);
  });
  it('keeps Trash locked across restart, rewraps it on password removal and expires only old entries',async()=>{
    const {service}=await boot();const password='trash test password';service.setNotesAppPassword(password);service.setNotes(crypt.encrypt(JSON.stringify(sample()),password));localStorage.setItem('app_password_challenge','1');service.trashEnabled=true;
    await service.captureTrash(sample());const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(reloaded.getTrash()).toEqual([]);
    reloaded.setNotesAppPassword(password);expect(reloaded.getTrash().length).toBe(2);
    const plain=crypt.decrypt(reloaded.getNotes(),password);localStorage.removeItem('app_password_challenge');reloaded.setNotesAppPassword('');reloaded.setNotes(plain);await reloaded.flushPersistence();
    const unlocked=new NotesService(store());await unlocked.initializePersistence();expect(unlocked.getTrash().length).toBe(2);
    const entries=unlocked.getTrash().map((entry,i)=>({...entry,trashedAt:Date.now()-(i?1:31)*86400000}));(unlocked as any).saveTrash(entries);await unlocked.expireTrash();expect(unlocked.getTrash().length).toBe(1);
  });
  it('clears persisted active notes, Trash and attachments when the app data is wiped',async()=>{
    const {service}=await boot();service.trashEnabled=true;await service.captureTrash(sample());await service.clearLocalPersistence();
    const reloaded=new NotesService(store());await reloaded.initializePersistence();expect(reloaded.getNotes()).toBe('[]');expect(reloaded.getTrash()).toEqual([]);
  });
});

describe('Shared folder picker and safe search presentation',()=>{
  it('uses the same searchable, inline-create picker for a batch and a single note',()=>{
    const picker=new FolderPickerComponent();picker.folders=[{id:'a',name:'Work'},{id:'b',name:'Personal'}];picker.query=' PER ';expect(picker.filteredFolders.map(folder=>folder.name)).toEqual(['Personal']);
    spyOn(picker.picked,'emit');picker.target='Work';picker.confirm();expect(picker.picked.emit).toHaveBeenCalledWith({folderName:'Work',create:false});
    picker.creating=true;picker.name=' Projects ';picker.confirm();expect(picker.picked.emit).toHaveBeenCalledWith({folderName:'Projects',create:true});
  });
  it('highlights accents and ligatures without returning executable HTML',()=>{
    const parts=searchPresentation('<img onerror=bad> Æbler og café','aebler cafe');
    expect(parts.filter(part=>part.match).map(part=>part.text)).toEqual(['Æbler','café']);
    expect(parts.map(part=>part.text).join('')).toBe('<img onerror=bad> Æbler og café');
  });
  it('shows a relevant excerpt around the match instead of always the first words',()=>{
    const parts=searchPresentation('Unrelated '.repeat(60)+'needle in the note','needle',true);
    expect(parts[0].text).toBe('…');expect(parts.some(part=>part.match && part.text==='needle')).toBeTrue();
    expect(parts.map(part=>part.text).join('').length).toBeLessThan(183);
  });
  it('combines folder/type filters and never indexes locked bodies',()=>{
    const page:any=Object.create(HomePage.prototype);page.notes=[{id:'a',text:'<img src="data:image/png;base64,eA==">',folder:'Work'},{id:'b',protected:true,title:'Locked',text:'needle',folder:'Work'},{id:'c',text:'<p>needle</p>',folder:'Personal'}];
    page.search_query='';page.activeFolderName='Work';page.activeFilter='all';page.listOfCheckedCheckboxes=[];page.persistUiState=()=>{};page.restoreNotesListScroll=()=>{};
    page.searchType='images';page.applyFilters();expect(page.filteredResults.map((note:any)=>note.id)).toEqual(['a']);
    page.searchType='locked';page.applyFilters();expect(page.filteredResults.map((note:any)=>note.id)).toEqual(['b']);
    page.search_query='needle';page.applyFilters();expect(page.filteredResults).toEqual([]);
  });
});

describe('Restore the last open note on desktop startup',()=>{
  afterEach(()=>localStorage.removeItem('recentOpenedNoteId'));
  function page() {
    const value:any=Object.create(HomePage.prototype);value.notes=[{id:'last',text:'body',folder:'Work'}];value.filteredResults=value.notes;
    value.noteService={restoreLastNoteAttempted:false,shouldAskForPassword:()=>false};value.router={url:'/home',navigate:jasmine.createSpy().and.resolveTo(true)};
    value.listOfCheckedCheckboxes=[];value.focusNoteRow=jasmine.createSpy('reveal');value.persistUiState=()=>{};return value;
  }
  it('opens an existing recent note once and retains its selection',async()=>{
    const value=page();localStorage.setItem('recentOpenedNoteId','last');await value.restoreLastOpenNote();await value.restoreLastOpenNote();
    expect(value.router.navigate).toHaveBeenCalledOnceWith(['/note','last'],{replaceUrl:true});expect(value.listOfCheckedCheckboxes).toEqual(['last']);
  });
  it('waits for app unlock and never overrides an explicit note route',async()=>{
    const value=page();localStorage.setItem('recentOpenedNoteId','last');value.noteService.shouldAskForPassword=()=>true;
    await value.restoreLastOpenNote();expect(value.router.navigate).not.toHaveBeenCalled();expect(value.noteService.restoreLastNoteAttempted).toBeFalse();
    value.noteService.shouldAskForPassword=()=>false;value.router.url='/note/another';await value.restoreLastOpenNote();expect(value.router.navigate).not.toHaveBeenCalled();
  });
  it('stays on the empty state when the previous note has been deleted',async()=>{
    const value=page();localStorage.setItem('recentOpenedNoteId','missing');await value.restoreLastOpenNote();expect(value.router.navigate).not.toHaveBeenCalled();expect(localStorage.getItem('recentOpenedNoteId')).toBeNull();
  });
});

describe('Trash uses the normal sidebar list with read-only batch selection',()=>{
  function page() {
    const value:any=Object.create(HomePage.prototype);
    value.notes=[{id:'active',title:'Active',text:'keep'}];value.activeFilter='trash';value.activeFolderName='__all__';value.search_query='';value.searchType='all';value.listOfCheckedCheckboxes=[];value.displayCache=new WeakMap();
    value.noteService={selectedNoteId:null,isNoteTemporaryDescripted:false,getTrash:()=>[
      {id:'trash-a',trashedAt:Date.now(),note:{id:'original-a',title:'Archived',text:'<p>Read only</p>'}},
      {id:'trash-b',trashedAt:Date.now(),note:{id:'original-b',title:'cipher',text:'cipher',protected:true}},
    ]};
    value.persistUiState=()=>{};value.restoreNotesListScroll=()=>{};value.cdr={detectChanges:()=>{}};value.router={navigate:jasmine.createSpy()};return value;
  }
  it('selects multiple trash entries without opening an editable note route or changing active notes',()=>{
    const value=page();value.applyFilters();const notes=value.getNotes();
    value.selectDesktopNote(new MouseEvent('click'),notes[0]);value.selectDesktopNote(new MouseEvent('click',{ctrlKey:true}),notes[1]);
    expect(value.selectedNotes().length).toBe(2);expect(value.router.navigate).not.toHaveBeenCalled();expect(value.notes[0].text).toBe('keep');
    expect(value.notePreview(notes.find((note:any)=>note.protected))).toBe('');
  });
  it('routes deletion shortcuts to permanent trash deletion rather than active-note deletion',async()=>{
    const value=page();value.permanentlyDeleteTrashSelection=jasmine.createSpy().and.resolveTo();await value.deleteSelectedNotes();expect(value.permanentlyDeleteTrashSelection).toHaveBeenCalledTimes(1);
  });
  it('focuses folder deletion confirmation for native Enter activation without deleting anything',async()=>{
    const hydrated=document.documentElement.classList.contains('hydrated');document.documentElement.classList.add('hydrated');
    const value=page(),button=document.createElement('button');document.body.appendChild(button);
    value.alertCtrl={create:async()=>({present:async()=>{},querySelector:()=>button})};
    try {await value.promptDeleteFolder('Synthetic folder');expect(document.activeElement).toBe(button);}finally{button.remove();if(!hydrated)document.documentElement.classList.remove('hydrated');}
  });
});
