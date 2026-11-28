import { IdentityRenewal } from './identity-renewal';
import { AuthService } from '../services/auth.service';

describe('Durable identity session renewal', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  const old = '1|' + 'a'.repeat(40), next = '2|' + 'b'.repeat(40);
  const refresh = 'a'.repeat(32) + '.' + 'b'.repeat(43);
  const nextRefresh = 'c'.repeat(32) + '.' + 'd'.repeat(43);
  const response = () => ({accountId:'123',token:next,expiresAt:new Date(now+900000).toISOString(),refreshToken:nextRefresh,refreshExpiresAt:new Date(now+2592000000).toISOString()});
  function fixture() {
    const values = new Map<string,string>([['ssToken',old],['ssAuthVersion','2'],['ssUser',JSON.stringify({id:'123',email:'owner@example.invalid'})],
      ['ssIdentitySession',JSON.stringify({accountId:'123',email:'owner@example.invalid',tokenId:'1',keyEnvelope:'unchanged-envelope',expiresAt:new Date(now+30000).toISOString(),refreshToken:refresh,refreshExpiresAt:new Date(now+2592000000).toISOString()})],['notes','retained notes'],['outbox','retained outbox']]);
    const store = { getItem: async (key:string) => values.get(key) ?? null, setItem: async (key:string,value:string) => {values.set(key,value);} };
    return {values,store};
  }
  it('rotates once for simultaneous calls without touching notes, outbox or the key envelope', async () => {
    const {values,store}=fixture();const send=jasmine.createSpy('renew').and.resolveTo(response());
    const client=new IdentityRenewal(store,send,()=>now);
    expect(await Promise.all(Array.from({length:10},()=>client.ensure()))).toEqual(Array(10).fill(next));
    expect(send).toHaveBeenCalledTimes(1);expect(values.get('ssToken')).toBe(next);
    expect(JSON.parse(values.get('ssIdentitySession')!).keyEnvelope).toBe('unchanged-envelope');
    expect(values.get('notes')).toBe('retained notes');expect(values.get('outbox')).toBe('retained outbox');
  });
  it('reuses the persisted request identity after a lost response and restart', async () => {
    const {values,store}=fixture();const lost=jasmine.createSpy('lost').and.rejectWith({status:503});
    await new IdentityRenewal(store,lost,()=>now).ensure();
    const request=JSON.parse(values.get('ssIdentitySession')!).refreshRequestId;
    const retry=jasmine.createSpy('retry').and.resolveTo(response());
    expect(await new IdentityRenewal(store,retry,()=>now).ensure()).toBe(next);
    expect(retry).toHaveBeenCalledWith(refresh,request);
  });
  it('repairs a crash between persisting the new session and publishing its access token', async () => {
    const {values,store}=fixture();let fail=true;
    const interrupted={...store,setItem:async(key:string,value:string)=>{if(key==='ssToken'&&fail){fail=false;throw Error('simulated durable-write failure');}await store.setItem(key,value);}};
    await new IdentityRenewal(interrupted,async()=>response(),()=>now).ensure();
    expect(values.get('ssToken')).toBe(old);
    const send=jasmine.createSpy('unneeded');
    expect(await new IdentityRenewal(store,send,()=>now).ensure()).toBe(next);
    expect(send).not.toHaveBeenCalled();
  });
  it('does not resurrect a removed or switched account after a late network response', async () => {
    const {values,store}=fixture();let answer!:(value:any)=>void;
    const client=new IdentityRenewal(store,()=>new Promise(resolve=>{answer=resolve;}),()=>now);
    const pending=client.ensure();while(!answer)await new Promise(resolve=>setTimeout(resolve,0));
    values.delete('ssIdentitySession');values.delete('ssToken');
    const stopped=client.invalidate();answer(response());await stopped;
    expect(await pending).toBeNull();expect(values.has('ssToken')).toBeFalse();expect(values.has('ssIdentitySession')).toBeFalse();
    expect(values.get('notes')).toBe('retained notes');
  });
  it('retries an expired session when the connection returns without deleting local data', async () => {
    const {values,store}=fixture();const meta=JSON.parse(values.get('ssIdentitySession')!);meta.expiresAt=new Date(now-1000).toISOString();values.set('ssIdentitySession',JSON.stringify(meta));
    expect(await new IdentityRenewal(store,async()=>{throw {status:0};},()=>now).ensure()).toBeNull();
    expect(await new IdentityRenewal(store,async()=>response(),()=>now).ensure()).toBe(next);
    expect(values.get('notes')).toBe('retained notes');expect(values.get('outbox')).toBe('retained outbox');
  });
  it('never uses a credential belonging to another local account', async () => {
    const {values,store}=fixture();values.set('ssUser',JSON.stringify({id:'456',email:'different@example.invalid'}));
    const send=jasmine.createSpy('renew');expect(await new IdentityRenewal(store,send,()=>now).ensure()).toBeNull();expect(send).not.toHaveBeenCalled();
  });
  it('rejects account substitution and refuses malformed renewal responses', async () => {
    const {values,store}=fixture();const meta=JSON.parse(values.get('ssIdentitySession')!);meta.expiresAt=new Date(now-1000).toISOString();values.set('ssIdentitySession',JSON.stringify(meta));
    for(const bad of [{...response(),accountId:'456'},{...response(),token:'broken'},{...response(),refreshToken:'broken'},{...response(),expiresAt:'invalid'}]) {
      expect(await new IdentityRenewal(store,async()=>bad,()=>now).ensure()).toBeNull();expect(values.get('ssToken')).toBe(old);
    }
  });
  it('does not repeatedly send a credential rejected as revoked', async () => {
    const {values,store}=fixture();const send=jasmine.createSpy('revoked').and.rejectWith({status:401});
    const client=new IdentityRenewal(store,send,()=>now);expect(await client.ensure()).toBeNull();
    await client.ensure();expect(send).toHaveBeenCalledTimes(1);expect(values.get('notes')).toBe('retained notes');
  });
  it('preserves existing legacy sessions without requesting renewal', async () => {
    const {values,store}=fixture();values.set('ssAuthVersion','1');const send=jasmine.createSpy('renew');
    expect(await new IdentityRenewal(store,send,()=>now).ensure()).toBe(old);expect(send).not.toHaveBeenCalled();
  });
  it('keeps account UI signed in while offline renewal waits, without claiming valid access', async () => {
    jasmine.clock().install();jasmine.clock().mockDate(new Date(now));
    const {store}=fixture();const auth=new AuthService({} as any,store as any,{ensureSession:async()=>null} as any);
    try {
      await auth.initializeAuthState();expect(auth.isLoggedIn).toBeTrue();expect(auth.hasActiveSession).toBeFalse();
    } finally {
      const stop=auth as any;if(stop.clearAuthenticationState)stop.clearAuthenticationState();else stop.setLoggedInState(false);
      jasmine.clock().uninstall();
    }
  });
  it('serializes independent client instances sharing the same browser profile', async () => {
    if (!navigator.locks) return;
    const {store}=fixture();const send=jasmine.createSpy('renew').and.resolveTo(response());
    const first=new IdentityRenewal(store,send,()=>now),second=new IdentityRenewal(store,send,()=>now);
    expect(await Promise.all([first.ensure(),second.ensure()])).toEqual([next,next]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
