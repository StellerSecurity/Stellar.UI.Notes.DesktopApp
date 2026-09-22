import { of, throwError } from 'rxjs';
import { RemoteDownloadSyncService } from './services/remote-download-sync.service';
import { HomePage } from './home/home.page';
import { AddNotePage } from './add-note/add-note.page';
import { NotesApiV1Service } from './services/notes-api-v1.service';
import { NotesService } from './services/notes.service';
import { OutboxStorage } from './services/outbox-storage.service';
import { SyncWorkerService } from './services/sync-worker.service';
import { CryptoService } from './services/crypto.service';
import { CryptoKeyService } from './services/crypto-key.service';
import { decryptTextWithMK, unpackCipherBlob } from '@stellarsecurity/stellar-crypto';

const keyText='12345678901234567890123456789012';
const key=Uint8Array.from(keyText,c=>c.charCodeAt(0));
function fixture(options: {offline?:boolean; fail?:boolean; protected?:boolean} = {}) {
  const crypto=new CryptoService();
  const note={id:'flags',title:options.protected ? crypto.encrypt('private title','pass') : 'title',
    text:options.protected ? crypto.encrypt('<p>private</p>','pass') : '<p>latest typed text</p>',
    last_modified:10,favorite:false,pinned:false,protected:!!options.protected,auto_wipe:false};
  let stored=JSON.stringify([note,{id:'other',text:'keep',last_modified:1}]);let queue:any[]=[];
  const outbox=new OutboxStorage({create:async()=>{},get:async()=>structuredClone(queue),set:async(_:string,v:any)=>{queue=structuredClone(v);}} as any);
  const notes=new NotesService();
  spyOn(notes,'getNotes').and.callFake(()=>stored);spyOn(notes,'setNotes').and.callFake(value=>{stored=value;});
  spyOn(notes,'appHasPasswordChallenge').and.returnValue(false);spyOn(notes,'setNoteIsUpdatedSubject');
  const server=new Map<string,any>();
  const http={post:jasmine.createSpy('post').and.callFake((_url:string,payload:any)=>{
    if(options.fail) return throwError(()=>({status:500}));
    for(const n of payload.notes ?? []) { if(Number(n.last_modified) >= Number(server.get(n.id)?.last_modified ?? 0)) server.set(n.id,structuredClone(n)); }
    return of({note_ack_v1:true});
  })};
  const secure={getItem:async(k:string)=>k==='ssEakB64'?btoa(keyText):'synthetic-token'};
  const api=new NotesApiV1Service(http as any,secure as any,new CryptoKeyService(),outbox,notes);
  const worker=new SyncWorkerService(http as any,outbox,{} as any,secure as any,notes);
  spyOn<any>(worker,'isOnline').and.callFake(async()=>!options.offline);
  const page:any=Object.create(HomePage.prototype);
  Object.assign(page,{notes:[{...note,text:'STALE SIDEBAR'}],noteService:notes,cryptoService:crypto,authService:{isLoggedIn:true},
    notesApiServiceV1:api,syncWorker:worker,applyFilters:()=>{},toastController:{create:async()=>({present:()=>{}})}});
  return {page,notes,note,outbox,worker,http,server,options,read:()=>JSON.parse(stored)};
}
const event=()=>({stopPropagation:()=>{}} as Event);

describe('Desktop favorite and pin durable immediate sync',()=>{
 for(const flag of ['favorite','pinned'] as const) {
  it('uploads '+flag+' on and off immediately, with current text and unchanged encryption format',async()=>{
    const f=fixture();const toggle=flag==='favorite'?'toggleFavoriteFromHome':'togglePinnedFromHome';
    for(const expected of [true,false]) {
      await f.page[toggle](event(),'flags');const saved=f.server.get('flags');
      expect(saved[flag]).toBe(expected);expect((await f.outbox.getAll()).length).toBe(0);
      expect(await decryptTextWithMK(key,{...unpackCipherBlob(saved.text),v:1,aad_b64:btoa('flags')})).toBe('<p>latest typed text</p>');
      expect(f.read().find((n:any)=>n.id==='other').text).toBe('keep');
      expect(saved.auto_wipe).toBeFalse();
    }
    expect(f.http.post.calls.count()).toBe(2);
  });
 }
 it('retains rapid mixed toggles offline, then uploads the final snapshot on reconnect',async()=>{
   const f=fixture({offline:true});
   await Promise.all(Array.from({length:51},(_,i)=>i%2 ? f.page.togglePinnedFromHome(event(),'flags') : f.page.toggleFavoriteFromHome(event(),'flags')));
   expect(f.http.post).not.toHaveBeenCalled();const pending=await f.outbox.getAll();expect(pending.length).toBe(1);
   f.options.offline=false;await f.worker.trySync();
   expect(f.server.get('flags').favorite).toBeFalse();expect(f.server.get('flags').pinned).toBeTrue();
   expect((await f.outbox.getAll()).length).toBe(0);
 });
 it('retains failed uploads and retries without reverting the local flag',async()=>{
   const f=fixture({fail:true});await f.page.toggleFavoriteFromHome(event(),'flags');
   expect(f.read()[0].favorite).toBeTrue();const [pending]=await f.outbox.getAll();expect(pending.attempt).toBe(1);
   f.options.fail=false;await f.outbox.update(pending.opId,op=>({...op,nextAt:0}));await f.worker.trySync();
   expect(f.server.get('flags').favorite).toBeTrue();expect((await f.outbox.getAll()).length).toBe(0);
 });
 it('keeps password-protected note contents encrypted and propagates flags into the open editor',async()=>{
   const f=fixture({protected:true});f.notes.currentNote={...f.note};
   await f.page.togglePinnedFromHome(event(),'flags');
   const saved=f.server.get('flags');expect(saved.protected).toBeTrue();expect(f.notes.currentNote.pinned).toBeTrue();
   expect(await decryptTextWithMK(key,{...unpackCipherBlob(saved.text),v:1,aad_b64:btoa('flags')})).toBe(f.note.text);
   expect(f.read()[0].text).toBe(f.note.text);
 });
 it('does not resurrect a missing note or upload after logout',async()=>{
   const f=fixture();await f.page.togglePinnedFromHome(event(),'missing');expect(f.http.post).not.toHaveBeenCalled();
   f.page.authService.isLoggedIn=false;await f.page.toggleFavoriteFromHome(event(),'flags');
   expect(f.read()[0].favorite).toBeTrue();expect(f.http.post).not.toHaveBeenCalled();
 });
 it('surfaces encryption failures while retaining local changes',async()=>{
   const f=fixture();spyOn(f.page.notesApiServiceV1,'upload').and.rejectWith(new Error('fixture failure'));
   const toast=spyOn(f.page.toastController,'create').and.callThrough();
   await f.page.togglePinnedFromHome(event(),'flags');expect(f.read()[0].pinned).toBeTrue();
   expect(f.notes.syncNeedsAttention$.value).toBeTrue();expect(toast).toHaveBeenCalled();
 });
 it('requests immediate durable uploads from the note actions menu too',async()=>{
   const page:any=Object.create(AddNotePage.prototype);page.currentNote={id:'a',favorite:false,pinned:false};
   const save=spyOn(page,'save');await page.toggleFavorite();await page.togglePinned();
   expect(save.calls.allArgs()).toEqual([[null,true],[null,true]]);
 });
});


describe('Desktop realtime download concurrency', () => {
 it('coalesces hints during an older download and waits for the fresh snapshot', async () => {
  const service:any=new RemoteDownloadSyncService({} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any);
  let release!:(value:boolean)=>void;
  const perform=spyOn(service,'performSync').and.returnValues(new Promise(resolve=>release=resolve),Promise.resolve(true));
  const first=service.requestImmediateSync('resume');
  const hints=Array.from({length:20},()=>service.requestImmediateSync('realtime'));
  expect(perform).toHaveBeenCalledTimes(1);release(true);await Promise.all([first,...hints]);
  expect(perform).toHaveBeenCalledTimes(2);
 });
 it('keeps ordinary concurrent refreshes single-flight', async () => {
  const service:any=new RemoteDownloadSyncService({} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any);
  const perform=spyOn(service,'performSync').and.resolveTo(true);
  await Promise.all([service.requestImmediateSync(),service.requestImmediateSync()]);
  expect(perform).toHaveBeenCalledTimes(1);
 });
});
