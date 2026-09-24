import { packCipherBlob } from '@stellarsecurity/stellar-crypto';
import { NoteConflictService, conflictPreview, sameConflictContent } from './note-conflict.service';
import { OutboxStorage } from './outbox-storage.service';
import { of } from 'rxjs';
function queue() {
  let saved: any = [];
  const storage = {
    create: async () => {},
    get: async () => JSON.parse(JSON.stringify(saved)),
    set: jasmine.createSpy('set').and.callFake(async (_key: string, value: any) => {
      await Promise.resolve();
      saved = JSON.parse(JSON.stringify(value));
    }),
  };
  const native = { consumeCompleted: async (): Promise<string[]> => [], replaceQueue: async () => {} };
  return { outbox: new OutboxStorage(storage as any), storage, native };
}

describe('Explicit multi-device conflict choices', () => {
 const blob = (text: string) => packCipherBlob({iv_b64:'AAAAAAAAAAAAAAAA',ct_b64:btoa('0123456789abcdef'+text)});
 async function setup(choice: string, during?: (ctx: any) => void) {
  const q = queue().outbox;
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
 it('silently reconciles equal plaintext with different encryption and versions',async()=>{
  const c=await setup('later');c.remote.text=packCipherBlob({iv_b64:'AQEBAQEBAQEBAQEB',ct_b64:btoa('different-prefix'+'local text')});
  c.remote.title=blob('local');await c.resolver.check();
  expect(c.alerts.create).not.toHaveBeenCalled();expect((await c.q.getAll()).length).toBe(0);expect(c.local()[0].base_version).toBe(300);
 });
 it('identical ciphertext does not hide a metadata conflict',async()=>{
  const c=await setup('later');c.remote.text=blob('local text');c.remote.title=blob('local');c.remote.last_modified=200;c.remote.favorite=true;
  await c.resolver.check();expect(c.alerts.create).toHaveBeenCalled();expect((await c.q.getAll()).length).toBe(1);
 });
 it('automatic reconciliation preserves a newer local draft not yet queued',async()=>{
  const c=await setup('later');c.remote.text=blob('local text');c.remote.title=blob('local');c.edit();
  await c.resolver.check();expect(c.local()[0].text).toBe('new typing');expect((await c.q.getAll()).length).toBe(1);
  expect(c.alerts.create).not.toHaveBeenCalled();
 });
 it('equality compares all text and formatting, not the preview',()=>{
  const a={id:'n',text:'a'.repeat(500),title:''};expect(sameConflictContent(a,{...a,text:a.text+'b'})).toBeFalse();
  expect(sameConflictContent({...a,text:'<b>x</b>'},{...a,text:'x'})).toBeFalse();
  expect(sameConflictContent(a,{...a,deleted:true})).toBeFalse();
  expect(sameConflictContent(a,{...a,folder_id:'other'})).toBeFalse();
 });
 it('preview renders readable text without active HTML',()=>{
  expect(conflictPreview({title:'Title',text:'<font size="3">Hello</font><div>World &amp; friends</div>'})).toBe('Title\nHelloWorld &amp; friends');
  expect(conflictPreview({text:'<script>alert(1)</script><img src=x onerror=alert(2)>Safe'})).toBe('Safe');
 });
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
