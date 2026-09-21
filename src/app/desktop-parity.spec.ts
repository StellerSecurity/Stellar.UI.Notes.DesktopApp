import { NoteConflictService, conflictPreview } from './services/note-conflict.service';
import { RealtimeNotesService, validRealtimeGrant } from './services/realtime-notes.service';
import { readUnlockedAppKey } from './utils/legacy-app-key';
import { HomePage } from './home/home.page';
import { FormBuilder } from '@angular/forms';
import { LoginComponent } from './profile/login/login.component';
import { ProfileComponent } from './profile/profile.component';
import { CryptoService } from './services/crypto.service';
import { createVault, exportServerBundleFromHeader, encryptTextWithMK, decryptTextWithMK, packCipherBlob, unpackCipherBlob } from '@stellarsecurity/stellar-crypto';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ElementRef } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { NotesApiV1Service } from './services/notes-api-v1.service';
import { CryptoKeyService } from './services/crypto-key.service';
import { confirmUpload } from './services/upload-confirmation';
import { RichTextEditorComponent } from './add-note/rich-text-editor/rich-text-editor.component';
import { NoteLockedModalComponent } from './note-locked-modal/note-locked-modal.component';
import { RemoteDownloadSyncService } from './services/remote-download-sync.service';
import { nextNoteVersion } from './utils/note-version';
import { Subject, from, of, throwError } from 'rxjs';
import { OutboxStorage } from './services/outbox-storage.service';
import { SyncWorkerService } from './services/sync-worker.service';
import { NotesService } from './services/notes.service';
import { AddNotePage } from './add-note/add-note.page';

function queue() {
 let saved: any[] = [];
 return new OutboxStorage({create: async () => {}, get: async () => JSON.parse(JSON.stringify(saved)), set: async (_: string, value: any[]) => { await Promise.resolve(); saved = JSON.parse(JSON.stringify(value)); }} as any);
}
const op = (id: string): any => ({opId:id,type:'upload',payload:{op_id:id,since:0,notes:[{id,text:'cipher',last_modified:100}]},attempt:0,nextAt:0});
function worker(q: OutboxStorage, post: any): SyncWorkerService {
 const w = new SyncWorkerService({post} as any,q,{} as any,{getItem:async () => 'test'} as any,new NotesService());
 spyOn<any>(w,'isOnline').and.resolveTo(true); return w;
}
describe('Desktop mobile parity', () => {
 it('retains concurrent saves',async () => {
  const q=queue(); await Promise.all([q.enqueue(op('a')),q.enqueue(op('b'))]);
  expect((await q.getAll()).map(x=>x.opId)).toEqual(['a','b']);
 });
 it('keeps a note if upload fails after a legacy sync-plan response', async () => {
  const q=queue(); await q.enqueue(op('a'));
  await worker(q,(url:string)=>url.endsWith('upload')?throwError(()=>({status:500})):of({})).trySync();
  expect((await q.getAll()).map(x=>x.opId)).toEqual(['a']);
 });
 it('does not treat legacy HTTP 200 as confirmation of missing data',async () => {
  const q=queue(); await q.enqueue(op('a'));
  await worker(q,()=>of({ok:true,notes:[]})).trySync();
  expect((await q.getAll()).length).toBe(1);
 });
 it('preserves spaces while typing a multiword title',()=>{
  const page:any=Object.create(AddNotePage.prototype); page.notes=[];page.onSave=()=>{};
  page.noteTitleChange({detail:{value:'Shopping '}});expect(page.note_title).toBe('Shopping ');
 });
});

describe('Desktop legacy API contracts', () => {
 const note = {id:'a',text:'cipher',title:'title',last_modified:100,favorite:true,folder_id:'folder'};
 it('accepts explicit new-server acknowledgement',async()=>{
  const post=jasmine.createSpy('post');
  await confirmUpload({post} as any,'/',new HttpHeaders(),{notes:[note]},{note_ack_v1:true});
  expect(post).not.toHaveBeenCalled();
 });
 it('accepts a legacy response only after matching downloaded content and metadata',async()=>{
  const post=jasmine.createSpy('post').and.returnValue(of({notes:[note]}));
  await confirmUpload({post} as any,'/',new HttpHeaders(),{notes:[note]},{ok:true});
  expect(post.calls.mostRecent().args[0]).toBe('/download');
 });
 it('rejects ignored favorite changes on legacy server',async()=>{
  await expectAsync(confirmUpload({post:()=>of({notes:[{...note,favorite:false}]})} as any,'/',new HttpHeaders(),{notes:[note]},{ok:true})).toBeRejected();
 });
 it('keeps retries after more than eight failures',async()=>{
  const q=queue(); await q.enqueue({...op('old'),attempt:8});
  await worker(q,()=>throwError(()=>({status:503}))).trySync();
  expect((await q.getAll())[0].attempt).toBe(9);
 });
 it('does not start overlapping uploads',async()=>{
  const q=queue(); await q.enqueue(op('a'));
  const post=jasmine.createSpy('post').and.returnValue(of({note_ack_v1:true}));const w=worker(q,post);
  await Promise.all([w.trySync(),w.trySync(),w.trySync()]);expect(post).toHaveBeenCalledTimes(1);
 });
 it('retains 200 interleaved queue operations without lost updates',async()=>{
  const q=queue();await Promise.all(Array.from({length:100},(_,i)=>q.enqueue(op('old'+i))));
  await Promise.all(Array.from({length:100},(_,i)=>[q.drop(['old'+i]),q.enqueue(op('new'+i))]).reduce((all,row)=>all.concat(row),[] as Promise<void>[]));
  const all=await q.getAll();expect(all.length).toBe(100);expect(all.every(x=>x.opId.startsWith('new'))).toBeTrue();
 });
 it('increments versions despite a backwards system clock',()=>{
  expect(nextNoteVersion([{last_modified:9000}],100)).toBe(9001);
 });
 it('persists direct uploads before HTTP and retains them after false success',async()=>{
  const q=queue();let persisted=false;
  const http={post:(_url:string,_body:any,_options:any)=>of({notes:[],ok:true})};
  const post=spyOn(http,'post').and.callFake(()=>of({notes:[],ok:true}));
  const enqueue=spyOn(q,'enqueue').and.callThrough();
  const api=new NotesApiV1Service(http as any,{getItem:async()=>null} as any,{encryptText:async()=>({v:1,iv_b64:btoa('123456789012'),ct_b64:btoa('ciphertext123456789')})} as any,q,new NotesService());
  const result:any=await api.upload(0,[note]);
  expect(enqueue).toHaveBeenCalledBefore(post);expect(result.queued).toBeTrue();expect((await q.getAll()).length).toBe(1);
  expect(post.calls.allArgs().every(args=>!String(args[0]).includes('controller//'))).toBeTrue();
 });
});

describe('Desktop HTML editor parity',()=>{
 function editor() {
  const host=document.createElement('div');host.innerHTML='<div class="angular-editor-textarea" contenteditable="true"></div>';document.body.append(host);
  const renderer={listen:(el:HTMLElement,event:string,fn:any)=>{el.addEventListener(event,fn);return()=>el.removeEventListener(event,fn);}};
  const c=new RichTextEditorComponent(renderer as any,{detectChanges:()=>{}} as any,{setNoteIsUpdatedSubject:()=>{}} as any,{} as any,TestBed.inject(DomSanitizer));
  c.editorWrapper=new ElementRef(host);return {c,host,root:host.firstElementChild as HTMLElement};
 }
 it('sanitizes initial and remotely downloaded HTML before insertion',fakeAsync(()=>{
  const {c,host,root}=editor();c.note_text='<img src=x onerror="alert(1)"><script>alert(2)</script><p>line 1</p><p>line 2</p>';
  c.ngOnChanges();expect(c.note_text).not.toContain('onerror');expect(c.note_text).not.toContain('<script');
  c.setExternalContent('<h1>Heading</h1><p>test</p><p>test</p><a href="javascript:alert(1)">link</a>');tick(350);
  expect(root.querySelectorAll('p').length).toBe(2);expect(root.querySelector('h1')?.textContent).toBe('Heading');
  expect(root.querySelector('a')?.getAttribute('href')).not.toBe('javascript:alert(1)');c.ngOnDestroy();host.remove();
 }));
 it('does not autofocus the end of a long existing note',fakeAsync(()=>{
  const {c,host,root}=editor();root.textContent='Existing long note';const focus=spyOn(root,'focus');c.ngAfterViewInit();tick(600);
  expect(focus).not.toHaveBeenCalled();c.ngOnDestroy();host.remove();
 }));
 it('cancels delayed focus after leaving a blank note',fakeAsync(()=>{
  const {c,host,root}=editor();const focus=spyOn(root,'focus');c.ngAfterViewInit();c.onLeave();tick(600);
  expect(focus).not.toHaveBeenCalled();c.ngOnDestroy();host.remove();
 }));
 it('cancels password modal focus on dismissal',fakeAsync(()=>{
  const c=new NoteLockedModalComponent({dismiss:()=>{}} as any);const focus=jasmine.createSpy('focus');c.passwordInput={value:'',setFocus:focus} as any;
  c.ionViewDidEnter();c.dismiss(false);tick(500);expect(focus).not.toHaveBeenCalled();
 }));
});

describe('Desktop session download isolation',()=>{
 it('does not persist an in-flight download after logout',async()=>{
  let finish:any;const response=new Promise(resolve=>finish=resolve);const auth={isLoggedIn:true};
  const notes=new NotesService();spyOn(notes,'shouldAskForPassword').and.returnValue(false);
  const save=spyOn(notes,'setNotes');const service=new RemoteDownloadSyncService({download:()=>response} as any,notes,{} as any,{getItem:async()=>auth.isLoggedIn?'token':null} as any,{setForceDownloadOnHome:()=>{}} as any,auth as any,{run:(fn:any)=>fn()} as any);
  spyOn<any>(service,'getMkRaw').and.resolveTo(new Uint8Array(32));
  const sync=service.requestImmediateSync();await Promise.resolve();await Promise.resolve();auth.isLoggedIn=false;finish({notes:[],folders:[]});await sync;expect(save).not.toHaveBeenCalled();
 });
});

describe('Desktop and mobile encrypted note compatibility',()=>{
 const keyText='12345678901234567890123456789012';
 const key=Uint8Array.from(keyText,c=>c.charCodeAt(0));
 it('reads mobile SDK ciphertext and produces ciphertext readable by mobile',async()=>{
  const service=new CryptoKeyService();await service.importEAK(btoa(keyText));
  for (const [aad,text] of [['id','<h1>Title</h1><p>test</p><p>test</p><p>æøå 😀</p>'],['id#title','My title'],['folder#folder-name','My folder']]) {
   const mobile=packCipherBlob(await encryptTextWithMK(key,text,aad));
   expect(await service.decryptText(unpackCipherBlob(mobile),aad)).toBe(text);
   const desktop=unpackCipherBlob(packCipherBlob(await service.encryptText(text,aad)));
   expect(await decryptTextWithMK(key,{...desktop,v:1,aad_b64:btoa(aad)})).toBe(text);
  }
 });
 it('does not decrypt a note with another note identity',async()=>{
  const service=new CryptoKeyService();await service.importEAK(btoa(keyText));
  const blob=await service.encryptText('private','first');
  await expectAsync(service.decryptText(blob,'second')).toBeRejected();
 });
 it('keeps a protected note encrypted while displaying its decrypted draft',()=>{
  const crypto=new CryptoService();const cipher=crypto.encrypt('<p>private note</p>','test-password');
  const page:any=Object.create(AddNotePage.prototype);page.cryptoService=crypto;
  page.currentNote={id:'a',text:cipher,title:crypto.encrypt('private title','test-password'),protected:true};
  expect(page.decryptNote('test-password',page.currentNote)).toBeTrue();
  expect(page.note_text).toBe('<p>private note</p>');expect(page.currentNote.text).toBe(cipher);
  page.notesService={notesPasswordStored:'test-password'};page.relockProtectedNote();
  expect(page.note_locked).toBeTrue();expect(page.note_text).toBe('');expect(page.notes_password_stored).toBe('');
 });
 it('wraps the EAK with the app password on login and activates sync state',async()=>{
  const password='fixture-password-123';const {header}=await createVault(password);const bundle=exportServerBundleFromHeader(header);
  const saved=new Map<string,string>();const crypto=new CryptoService();
  const auth={loginHandling:()=>of({response_code:200,token:'fixture-token',user:{crypto_version:bundle.crypto_version,kdf_params:bundle.kdf_params,kdf_salt_b64:bundle.kdf_salt,eak_b64:bundle.eak}}),setLoggedInState:jasmine.createSpy('loggedIn')};
  const page=new LoginComponent({navigate:async()=>true} as any,new FormBuilder(),auth as any,{showError:()=>{}} as any,{setItem:async(k:string,v:string)=>{saved.set(k,v);}} as any,
   {appHasPasswordChallenge:()=>true,getNotesAppPassword:()=> 'app-pass',getNotes:()=> '[]',getDecryptedNotes:()=>null} as any,
   {upload:async()=>({})} as any,{setForceDownloadOnHome:()=>{}} as any,crypto,new CryptoKeyService(),{} as any);
  page.ngOnInit();page.loginForm.setValue({email:'fixture@example.com',password});await page.login();
  expect(auth.setLoggedInState).toHaveBeenCalledWith(true);
  const wrapped=saved.get('ssEakB64_Encrypted')!;expect(wrapped.startsWith('U2FsdGVk')).toBeTrue();
  expect(atob(crypto.decrypt(wrapped,'app-pass')).length).toBe(32);expect(saved.has('ssEakB64')).toBeFalse();
 });
 it('blocks logout while uploads are queued',async()=>{
  const page:any=Object.create(ProfileComponent.prototype);const logout=jasmine.createSpy('logout');const present=jasmine.createSpy('present');
  page.notesState={hasPendingMutations:()=>false};page.outbox={getAll:async()=>[op('a')]};
  page.alertController={create:async()=>({present})};page.dataService={logoutAndResetApp:logout};await page.logout();
  expect(logout).not.toHaveBeenCalled();expect(present).toHaveBeenCalled();
 });
 it('queues without contacting the server when a save is being debounced',async()=>{
  const q=queue();const http={post:jasmine.createSpy('post')};
  const api=new NotesApiV1Service(http as any,{getItem:async()=>null} as any,{encryptText:async()=>({v:1,iv_b64:btoa('123456789012'),ct_b64:btoa('ciphertext123456789')})} as any,q,new NotesService());
  await api.upload(0,[{id:'fixture',text:'test',last_modified:1}],undefined,[],true);
  expect(http.post).not.toHaveBeenCalled();expect((await q.getAll()).length).toBe(1);
 });
});

describe('Desktop save and download conflict rules',()=>{
 it('preserves auto-wipe and notes saved by another view',()=>{
  const page:any=Object.create(AddNotePage.prototype);
  const other={id:'other',text:'newly synced',last_modified:5000};
  page.notes_id='edited';page.note_locked=false;page.note_text='<p>edit</p>';page.note_title='Title';page.notes_password_stored='';
  page.currentNote={id:'edited',text:'old',last_modified:9000,auto_wipe:false};page.notes=[];
  page.notesService={getNotes:()=>JSON.stringify([other]),appHasPasswordChallenge:()=>false,markPendingMutation:()=>{},setNoteIsUpdatedSubject:()=>{}};
  page.storeNoteInStorage=async()=>{};spyOn(Date,'now').and.returnValue(1000);
  page.save(null);expect(page.currentNote.auto_wipe).toBeFalse();expect(page.currentNote.last_modified).toBe(9001);
  expect(page.notes.some((n:any)=>n.id==='other'&&n.text==='newly synced')).toBeTrue();
 });
 async function download(server:any, before:any[], latest:any[]) {
  const notes=new NotesService();spyOn(notes,'shouldAskForPassword').and.returnValue(false);spyOn(notes,'appHasPasswordChallenge').and.returnValue(false);
  const save=spyOn(notes,'setNotes');spyOn(notes,'setFolders');
  const service=new RemoteDownloadSyncService({download:async()=>({notes:[server],folders:[]})} as any,notes,{} as any,{getItem:async()=> 'fixture-token'} as any,{setForceDownloadOnHome:()=>{}} as any,{isLoggedIn:true} as any,{run:(fn:any)=>fn()} as any);
  spyOn<any>(service,'getMkRaw').and.resolveTo(Uint8Array.from('12345678901234567890123456789012',c=>c.charCodeAt(0)));
  spyOn<any>(service,'getStoredNotes').and.returnValues(before,latest);spyOn<any>(service,'getStoredFolders').and.returnValue([]);
  const result=await service.requestImmediateSync();expect(result).toBeTrue();return JSON.parse(save.calls.mostRecent().args[0]);
 }
 it('preserves edits made while remote notes are being decrypted',async()=>{
  const key=Uint8Array.from('12345678901234567890123456789012',c=>c.charCodeAt(0));
  const server={id:'a',last_modified:200,text:packCipherBlob(await encryptTextWithMK(key,'remote','a')),folder:'Legacy folder'};
  const result=await download(server,[{id:'a',text:'old',last_modified:100}],[{id:'a',text:'latest edit',last_modified:300}]);
  expect(result[0].text).toBe('latest edit');
 });
 it('keeps a newer server deletion instead of resurrecting the local snapshot',async()=>{
  const result=await download({id:'a',deleted:true,last_modified:200},[{id:'a',text:'old',last_modified:100}],[{id:'a',text:'old',last_modified:100}]);
  expect(result).toEqual([]);
 });
 it('preserves a legacy note folder when no folder manifest is returned',async()=>{
  const key=Uint8Array.from('12345678901234567890123456789012',c=>c.charCodeAt(0));
  const result=await download({id:'a',last_modified:200,text:packCipherBlob(await encryptTextWithMK(key,'remote','a')),folder:'Legacy folder'},[],[]);
  expect(result[0].folder).toBe('Legacy folder');
 });
 it('decrypts current SDK folder names and still accepts legacy plain names',async()=>{
  const key=Uint8Array.from('12345678901234567890123456789012',c=>c.charCodeAt(0));
  const cryptoService=new CryptoKeyService();await cryptoService.importEAK(btoa('12345678901234567890123456789012'));
  const cipher=packCipherBlob(await encryptTextWithMK(key,'Private folder','folder#folder-name'));
  const api=new NotesApiV1Service({post:()=>of({notes:[],folders:[{id:'folder',name:cipher,last_modified:1},{id:'legacy',name:'Old plain folder',last_modified:1}]})} as any,{getItem:async()=> 'fixture-token'} as any,cryptoService,queue(),new NotesService());
  const result=await api.download(0);expect(result.folders.map(x=>x.name)).toEqual(['Private folder','Old plain folder']);
 });
});

describe('Desktop list search integration',()=>{
 it('uses mobile word matching in the actual desktop filter and excludes protected bodies',()=>{
  const page:any=Object.create(HomePage.prototype);page.activeFolderName='__all__';page.activeFilter='all';page.search_query='æøå fælles';page.persistUiState=()=>{};page.restoreNotesListScroll=()=>{};
  page.notes=[{id:'visible',title:'Desktop fælles regler',text:'<p>Dansk æøå</p>'},{id:'locked',title:'Desktop fælles regler',text:'<p>Dansk æøå</p>',protected:true}];
  page.applyFilters();expect(page.filteredResults.map((note:any)=>note.id)).toEqual(['visible']);
 });
});

describe('Legacy desktop app-key upgrade after verified unlock',()=>{
 it('recognizes old raw keys and keeps the exact key when wrapping them',()=>{
  const key=btoa('12345678901234567890123456789012');const crypto=new CryptoService();
  const legacy=readUnlockedAppKey(key,'app-password',(value,password)=>crypto.decrypt(value,password));
  expect(legacy.needsWrapping).toBeTrue();expect(legacy.key).toBe(key);
  const current=readUnlockedAppKey(crypto.encrypt(legacy.key,'app-password'),'app-password',(value,password)=>crypto.decrypt(value,password));
  expect(current.needsWrapping).toBeFalse();expect(current.key).toBe(key);
 });
 it('rejects wrong passwords and corrupted keys instead of importing an empty key',()=>{
  const crypto=new CryptoService();const wrapped=crypto.encrypt(btoa('12345678901234567890123456789012'),'correct');
  expect(()=>readUnlockedAppKey(wrapped,'wrong',(value,password)=>crypto.decrypt(value,password))).toThrow();
  expect(()=>readUnlockedAppKey('invalid','correct',()=> '')).toThrow();
 });
});

describe('Metadata version consistency',()=>{
 it('keeps favorite and pin changes newer than the previous note version',async()=>{
  const page:any=Object.create(AddNotePage.prototype);page.currentNote={id:'fixture',last_modified:9000};page.save=()=>{};
  spyOn(Date,'now').and.returnValue(1000);await page.toggleFavorite();expect(page.currentNote.last_modified).toBe(9001);
  await page.togglePinned();expect(page.currentNote.last_modified).toBe(9002);
 });
});


describe('Coalesced desktop uploads', () => {
 const snapshot = (version: number): any => ({...op('save-' + version), payload:{op_id:'save-' + version,since:0,notes:[{id:'same-note',text:'cipher-' + version,last_modified:version}]}});
 it('keeps only the latest of 100 offline edits', async () => {
  const q=queue(); for(let n=1;n<=100;n++) await q.enqueue(snapshot(n),true);
  const all=await q.getAll(); expect(all.length).toBe(1); expect(all[0].payload.notes[0].last_modified).toBe(100);
 });
 it('does not replace a newer version when encryption finishes late',async()=>{
  const q=queue(); await q.enqueue(snapshot(2),true);await q.enqueue(snapshot(1),true);
  expect((await q.getAll())[0].opId).toBe('save-2');
 });
 it('an acknowledgement of an in-flight snapshot cannot delete a newer edit',async()=>{
  const q=queue();await q.enqueue(snapshot(1),true);await q.enqueue(snapshot(2),true);await q.drop(['save-1']);
  expect((await q.getAll()).map(x=>x.opId)).toEqual(['save-2']);
 });
 it('preserves delete barriers and unrelated notes',async()=>{
  const q=queue();await q.enqueue(snapshot(1),true);await q.enqueue({opId:'delete',type:'delete',payload:{op_id:'delete',since:0,notes:[],deleted_ids:['same-note']}});
  await q.enqueue(op('other'),true);await q.enqueue(snapshot(2),true);
  expect((await q.getAll()).map(x=>x.opId)).toEqual(['save-1','delete','other','save-2']);
 });
 it('caps the debounce window during continuous typing',async()=>{
  const q=queue();spyOn(Date,'now').and.returnValue(10000);await q.enqueue(snapshot(1),true);
  (Date.now as jasmine.Spy).and.returnValue(14900);await q.enqueue(snapshot(2),true);
  expect((await q.getAll())[0].nextAt).toBe(15000);
 });
 it('refreshes the queue after an in-flight upload instead of sending an obsolete snapshot',async()=>{
  const q=queue();await q.enqueue(op('first'));await q.enqueue(snapshot(1));
  const sent:string[]=[];
  const post=(_url:string,payload:any)=>{
   sent.push(payload.op_id);
   if(payload.op_id==='first') return from((async()=>{
    await q.enqueue(snapshot(2),true);await q.update('save-2',item=>({...item,nextAt:0}));
    return {note_ack_v1:true};
   })());
   return of({note_ack_v1:true});
  };
  await worker(q,post).trySync();expect(sent).toEqual(['first','save-2']);expect(await q.getAll()).toEqual([]);
 });
});

 describe('Seeded randomized queue stress',()=>{
  for(const seed of [17,97,733,2026,65537]) it('preserves every operation across randomized concurrent batches, seed '+seed,async()=>{
   const q=queue();
   let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
   const expected=new Map<string,any>();let sequence=0;
   for(let batch=0;batch<100;batch++) {
    const work:Promise<any>[]=[];
    for(let k=0;k<10;k++) {
     const choice=random()%4;const id='op-'+(random()%80);
     if(choice<2){const item:any={opId:id,type:choice===0?'upload':'delete',payload:{op_id:id,since:0,notes:choice===0?[{id:'note-'+(random()%10),text:'random æøå\n'+random(),last_modified:++sequence}]:[],deleted_ids:choice===1?['note-'+(random()%10)]:[]},attempt:0,nextAt:0};expected.set(id,JSON.parse(JSON.stringify(item)));work.push(q.enqueue(item));}
     else if(choice===2){expected.delete(id);work.push(q.drop([id]));}
     else {if(expected.has(id))expected.get(id).attempt++;work.push(q.update(id,item=>({...item,attempt:(item.attempt??0)+1})));}
    }
    await Promise.all(work);
    expect(await q.getAll()).withContext('seed '+seed+' batch '+batch).toEqual([...expected.values()]);
   }
  });
 });


describe('Realtime security and fallback',()=>{
 const grant=(url='wss://notes-test.webpubsub.azure.com/client/hubs/notes?access_token=synthetic')=>({enabled:true,url,expires_at:Date.now()+30000});
 it('accepts only short-lived WSS grants on Azure notes hub',()=>{expect(validRealtimeGrant(grant())).toBeTrue();});
 it('rejects insecure, foreign and credential-bearing URLs',()=>{
  for(const url of ['ws://notes-test.webpubsub.azure.com/client/hubs/notes?access_token=x','wss://evil.example/client/hubs/notes?access_token=x','wss://user:pass@notes-test.webpubsub.azure.com/client/hubs/notes?access_token=x','wss://notes-test.webpubsub.azure.com/client/hubs/other?access_token=x'])expect(validRealtimeGrant(grant(url))).toBeFalse();
 });
 it('rejects expired, long-lived and disabled grants',()=>{
  expect(validRealtimeGrant({...grant(),expires_at:Date.now()-1})).toBeFalse();
  expect(validRealtimeGrant({...grant(),expires_at:Date.now()+3600000})).toBeFalse();
  expect(validRealtimeGrant({...grant(),enabled:false})).toBeFalse();
 });
 it('keeps fallback untouched when negotiation fails',async()=>{
  const service:any=new RealtimeNotesService({post:()=>throwError(()=>new Error('offline'))} as any,{isLoggedIn:true} as any,{getItem:async()=> 'synthetic'} as any);
  await service.connect(0);expect(service.socket).toBeUndefined();expect(service.retry).toBeDefined();service.stop();
 });
 it('does not open a socket after logout during negotiation',async()=>{
  const reply=new Subject<any>();let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  const service:any=new RealtimeNotesService({post:()=>{started();return reply;}} as any,{isLoggedIn:true} as any,{getItem:async()=> 'synthetic'} as any);
  const connecting=service.connect(0);await ready;service.stop();reply.next(grant());reply.complete();await connecting;
  expect(service.socket).toBeUndefined();expect(service.retry).toBeUndefined();
 });
 it('closes sockets and cancels renewal on logout',()=>{
  const service:any=new RealtimeNotesService({} as any,{} as any,{} as any);const close=jasmine.createSpy('close');service.socket={close};service.stop();expect(close).toHaveBeenCalled();expect(service.socket).toBeUndefined();
 });

 it('rejects a negotiated grant if the account token changed while waiting',async()=>{
  let token='account-A';const reply=new Subject<any>();let started!:()=>void;const ready=new Promise<void>(r=>started=r);
  const service:any=new RealtimeNotesService({post:()=>{started();return reply;}} as any,{isLoggedIn:true} as any,{getItem:async()=>token} as any);
  const connecting=service.connect(0);await ready;token='account-B';reply.next({enabled:true,url:'wss://notes-test.webpubsub.azure.com/client/hubs/notes?access_token=synthetic',expires_at:Date.now()+30000});reply.complete();await connecting;
  expect(service.socket).toBeUndefined();service.stop();
 });
 it('does not dispatch stale-account hints',async()=>{
  const service:any=new RealtimeNotesService({} as any,{isLoggedIn:false} as any,{getItem:async()=> 'account-B'} as any);
  const dispatch=spyOn(window,'dispatchEvent');await service.hint(0,'account-A');expect(dispatch).not.toHaveBeenCalled();service.stop();
 });
});

describe('Explicit multi-device conflict choices', () => {
 const blob = (text: string) => packCipherBlob({iv_b64:'AAAAAAAAAAAAAAAA',ct_b64:btoa('0123456789abcdef'+text)});
 async function setup(choice: string, during?: (ctx: any) => void) {
  const q = queue();
  let local: any[] = [{id:'n',text:'local text',title:'local',last_modified:200,base_version:100}];
  let token = 'account-a';
  const sent = {id:'n',text:blob('local text'),title:blob('local'),last_modified:200,base_version:100,edit_session:'desktop-111111111111'};
  await q.enqueue({opId:'conflict',type:'upload',payload:{op_id:'conflict',since:0,notes:[sent]},conflict:true});
  const remote: any = {id:'n',text:blob('remote text'),title:blob('remote'),last_modified:300};
  const state: any = {getNotes:()=>JSON.stringify(local),setNotes:(s:string)=>{local=JSON.parse(s);},appHasPasswordChallenge:()=>false,shouldAskForPassword:()=>false,
    flushPersistence:async()=>{},getPendingMutation:()=>null,clearPendingMutation:()=>{},setNoteIsUpdatedSubject:()=>{},refreshRequested$:{next:()=>{}},syncNeedsAttention$:{next:()=>{}}};
  const context: any = {q,state,remote,edit:()=>{local[0].text='new typing';local[0].last_modified=400;},logout:()=>{token='account-b';},local:()=>local};
  const alerts: any = {create:jasmine.createSpy('create').and.callFake(async () => ({present:async()=>{},dismiss:async()=>{},onDidDismiss:async()=>{
    during?.(context); return choice==='later'?{role:'cancel'}:{role:'confirm',data:{values:choice}};
  }}))};
  const keys: any = {importEAK:async()=>{},decryptText:async(b:any)=>atob(b.ct_b64).slice(16),encryptText:async(t:string)=>({v:1,iv_b64:'AAAAAAAAAAAAAAAA',ct_b64:btoa('0123456789abcdef'+t)})};
  const resolver = new NoteConflictService(q,state,{getItem:async(k:string)=>k==='ssToken'?token:null} as any,keys,{} as any,{post:()=>of({notes:[remote]})} as any,alerts);
  return {...context,resolver,alerts};
 }
 beforeEach(()=>{spyOnProperty(document,'hidden','get').and.returnValue(false);spyOnProperty(navigator,'onLine','get').and.returnValue(true);});
 it('Later preserves both local text and encrypted pending operation',async()=>{
  const c=await setup('later');await c.resolver.check();expect(c.local()[0].text).toBe('local text');expect((await c.q.getAll()).length).toBe(1);
 });
 it('Later also postpones older queued snapshots of the same note',async()=>{
  const c=await setup('later');const first=(await c.q.getAll())[0];await c.q.enqueue({...first,opId:'older',payload:{...first.payload,op_id:'older',notes:first.payload.notes.map((n:any)=>({...n,last_modified:199}))}});await c.resolver.check();await c.resolver.check();expect(c.alerts.create).toHaveBeenCalledTimes(1);expect((await c.q.getAll()).length).toBe(2);
 });
 it('choosing server applies only the chosen version and removes the conflict',async()=>{
  const c=await setup('server');await c.resolver.check();expect(c.local()[0].text).toBe('remote text');expect((await c.q.getAll()).length).toBe(0);
 });
 it('decrypts folder metadata when choosing the server version',async()=>{
  const c=await setup('server');c.remote.folder=blob('Work');c.remote.folder_id='folder-a';await c.resolver.check();expect(c.local()[0].folder).toBe('Work');expect(c.local()[0].folder_id).toBe('folder-a');
 });
 it('choosing local queues a fresh conditional write before removing old operation',async()=>{
  const c=await setup('local');await c.resolver.check();const items=await c.q.getAll();expect(items.length).toBe(1);expect(items[0].opId).not.toBe('conflict');expect(items[0].payload.notes[0].base_version).toBe(300);expect(items[0].conflict).not.toBeTrue();expect(c.local()[0].text).toBe('local text');
 });
 it('does not discard typing done while version dialog is open',async()=>{
  const c=await setup('server',x=>x.edit());await c.resolver.check();expect(c.local()[0].text).toBe('new typing');expect((await c.q.getAll()).length).toBe(1);
 });
 it('account switch while dialog is open prevents applying the choice',async()=>{
  const c=await setup('server',x=>x.logout());await c.resolver.check();expect(c.local()[0].text).toBe('local text');expect((await c.q.getAll()).length).toBe(1);
 });
 it('failed local persistence retains encrypted conflicting operation',async()=>{
  const c=await setup('server');c.state.flushPersistence=async()=>{throw new Error('disk full');};await c.resolver.check();expect((await c.q.getAll()).length).toBe(1);
 });
 it('restoring a remotely deleted note uses a new UUID and re-encryption',async()=>{
  const c=await setup('local');c.remote.deleted=true;await c.resolver.check();const items=await c.q.getAll();expect(items.length).toBe(1);expect(items[0].payload.notes[0].id).not.toBe('n');expect(items[0].payload.notes[0].base_version).toBe(0);expect(c.local().some((n:any)=>n.id==='n')).toBeFalse();
 });
 it('conflict operations do not block unrelated uploads in the queue',async()=>{
  const c=await setup('later');await c.q.enqueue({opId:'other',type:'upload',payload:{op_id:'other',since:0,notes:[]},nextAt:0});expect((await c.q.peekBatch()).map((o:any)=>o.opId)).toEqual(['other']);
 });
 it('choosing a version never removes a later edit or another note',async()=>{
  const c=await setup('later');await c.q.enqueue({opId:'later',type:'upload',payload:{op_id:'later',since:0,notes:[{id:'n',text:'new',last_modified:500},{id:'other',text:'safe',last_modified:1}]}});await c.q.discardChosenVersions({n:200});const items=await c.q.getAll();expect(items.length).toBe(1);expect(items[0].payload.notes.length).toBe(2);
 });
 it('escapes HTML previews and never previews protected content',()=>{
  expect(conflictPreview({text:'<img src=x onerror=alert(1)>'})).not.toContain('<img');expect(conflictPreview({protected:true,text:'secret'})).not.toContain('secret');
 });
});
