import { Injectable } from '@angular/core';
import { CryptoService } from './crypto.service';
import { localAssets, expandLocalAssets, LOCAL_NOTES_ENVELOPE } from '../utils/local-note-assets';

type Sealed = {iv: Uint8Array<ArrayBuffer>; cipher: ArrayBuffer};
type RecordValue = {id:string; collection:'notes'|'trash'; value:string; passwordProtected:boolean};
const DATABASE = 'stellar-notes-local-v2';
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const completed = (tx:IDBTransaction) => new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error ?? new Error('Local storage transaction failed'));});

/** Local-only storage. Sync continues to receive the original, expanded note format. */
@Injectable({providedIn:'root'})
export class LocalNoteStorage {
  private db!: IDBDatabase;
  private loadedRecords:RecordValue[]=[];
  private loadedFingerprintCache=false;
  private key!: CryptoKey;
  private fingerprints = new Map<string,string>();
  private assetIds = new Map<string,string>();
  private assetFingerprints = new Map<string,string>();
  private readonly crypt = new CryptoService();

  private async seal(value:unknown):Promise<Sealed> {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    return {iv,cipher:await crypto.subtle.encrypt({name:'AES-GCM',iv},this.key,new TextEncoder().encode(JSON.stringify(value)))};
  }
  private async unseal<T>(value:Sealed):Promise<T> {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv},this.key,value.cipher)));
  }
  async open():Promise<{notes:string;trash:string;exists:boolean;passwordProtected:boolean}> {
    const opening=indexedDB.open(DATABASE,1);
    opening.onupgradeneeded=()=>{for(const name of ['meta','records','assets']) opening.result.createObjectStore(name);};
    this.db=await request(opening);
    this.db.onversionchange=()=>this.db.close();
    let tx=this.db.transaction('meta','readonly');
    this.key=await request(tx.objectStore('meta').get('key'));
    if(!this.key) {
      this.key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      tx=this.db.transaction('meta','readwrite');const done=completed(tx);tx.objectStore('meta').put(this.key,'key');await done;
    }
    tx=this.db.transaction(['records','assets','meta'],'readonly');
    const [records,assets,exists]=await Promise.all([
      request(tx.objectStore('records').getAll()) as Promise<Sealed[]>,
      request(tx.objectStore('assets').getAll()) as Promise<Sealed[]>,request(tx.objectStore('meta').get('committed')),
    ]);
    const decodedAssets=await Promise.all(assets.map(value=>this.unseal<{id:string;value:string;passwordProtected:boolean}>(value)));
    localAssets.clear();for(const asset of decodedAssets)localAssets.set(asset.id,asset);
    const decoded=await Promise.all(records.map(value=>this.unseal<RecordValue>(value)));
    this.loadedRecords=decoded;this.loadedFingerprintCache=false;
    const snapshot=(collection:'notes'|'trash')=>{
      const all=decoded.filter(value=>value.collection===collection);
      const check=all.find(value=>value.id===`${collection}:@verifier`);
      const values=all.filter(value=>value!==check);
      if(values.length===1 && values[0].id===`${collection}:opaque`)return values[0].value;
      if(check || values.some(value=>value.passwordProtected))return JSON.stringify({[LOCAL_NOTES_ENVELOPE]:1,check:check?.value,records:values.map(value=>value.value)});
      return JSON.stringify(values.map(value=>expandLocalAssets(JSON.parse(value.value),'')));
    };
    const notes=snapshot('notes');
    return {notes,trash:snapshot('trash'),exists:!!exists,passwordProtected:!notes.startsWith('[')};
  }

  async write(notes:string,trash:string,password:string):Promise<void> {
    if(!this.loadedFingerprintCache) {
      for(const record of this.loadedRecords) {
        if(record.id.endsWith(':opaque'))continue;
        if(record.passwordProtected!==!!password)continue;
        const plain=record.passwordProtected?this.crypt.decrypt(record.value,password):record.value;
        const expected=record.id.endsWith(':@verifier')?'verifier':plain;
        this.fingerprints.set(record.id,password+'\0'+expected);
      }
      for(const [id,value] of localAssets) {
        if(value.passwordProtected!==!!password)continue;
        const plain=value.passwordProtected?this.crypt.decrypt(value.value,password):value.value;
        this.assetFingerprints.set(id,password+'\0'+plain);
      }
      this.loadedFingerprintCache=true;
    }
    const records=new Map<string,RecordValue>();
    const assets=new Map<string,{id:string;value:string;passwordProtected:boolean}>();
    const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const asset=async(value:string)=>{
      const id=this.assetIds.get(value) ?? await hash(value);this.assetIds.set(value,id);
      const old=localAssets.get(id);
      const fingerprint=password+'\0'+value;
      const encoded=this.assetFingerprints.get(id)===fingerprint && old ? old.value : password ? this.crypt.encrypt(value,password) : value;
      assets.set(id,{id,value:encoded,passwordProtected:!!password});
      return `stellar-local-asset:${id}`;
    };
    for(const [collection,raw] of [['notes',notes],['trash',trash]] as const) {
      let entries:any[];
      try { entries=JSON.parse(raw.startsWith('[')?raw:this.crypt.decrypt(raw,password));if(!Array.isArray(entries))throw Error('Invalid notes'); }
      catch(error) {
        if(password || !raw.startsWith('U2FsdGVkX1'))throw error;
        records.set(`${collection}:opaque`,{id:`${collection}:opaque`,collection,value:raw,passwordProtected:false});continue;
      }
      if(password) {
        const id=`${collection}:@verifier`,fingerprint=password+'\0verifier';
        records.set(id,{id,collection,value:this.fingerprints.get(id)===fingerprint?'':this.crypt.encrypt('stellar-local-unlock-v1',password),passwordProtected:true});
        (records.get(id) as any).fingerprint=fingerprint;
      }
      for(const entry of entries) {
        const note=collection==='trash'?entry.note:entry;
        if(!note || typeof note.id!=='string')throw Error('Invalid local note');
        const compact={...note};
        if(typeof compact.text==='string') {
          if(note.protected && compact.text.length>128*1024)compact.text=await asset(compact.text);
          else {
            const matches=[...new Set<string>(compact.text.match(/data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+/g) ?? [])];
            for(const image of matches)compact.text=compact.text.split(image).join(await asset(image));
          }
        }
        const id=`${collection}:${entry.id}`;
        const plain=JSON.stringify(collection==='trash'?{...entry,note:compact}:compact);
        const fingerprint=password+'\0'+plain;
        const value=this.fingerprints.get(id)===fingerprint ? null : password ? this.crypt.encrypt(plain,password) : plain;
        records.set(id,{id,collection,value:value ?? '',passwordProtected:!!password});
        (records.get(id) as any).fingerprint=fingerprint;
      }
    }
    const changes: Array<[string,Sealed]>=[];
    for(const [id,value] of records) {
      if((value as any).fingerprint && this.fingerprints.get(id)===(value as any).fingerprint)continue;
      const {fingerprint,...stored}=value as any;changes.push([id,await this.seal(stored)]);
    }
    const assetChanges:Array<[string,Sealed]>=[];
    for(const [id,value] of assets) {
      const plain=value.passwordProtected?this.crypt.decrypt(value.value,password):value.value;
      if(this.assetFingerprints.get(id)!==password+'\0'+plain)assetChanges.push([id,await this.seal(value)]);
    }
    const tx=this.db.transaction(['records','assets','meta'],'readwrite');const done=completed(tx);
    const recordStore=tx.objectStore('records'),assetStore=tx.objectStore('assets');
    const oldRecordKeys=recordStore.getAllKeys();oldRecordKeys.onsuccess=()=>{for(const id of oldRecordKeys.result)if(!records.has(String(id)))recordStore.delete(id);};
    const oldAssetKeys=assetStore.getAllKeys();oldAssetKeys.onsuccess=()=>{for(const id of oldAssetKeys.result)if(!assets.has(String(id)))assetStore.delete(id);};
    for(const [id,value] of changes)recordStore.put(value,id);
    for(const [id,value] of assetChanges)assetStore.put(value,id);
    tx.objectStore('meta').put(true,'committed');await done;
    this.loadedRecords=[];
    this.fingerprints.clear();for(const [id,value] of records)if((value as any).fingerprint)this.fingerprints.set(id,(value as any).fingerprint);
    this.assetFingerprints.clear();localAssets.clear();
    for(const [id,value] of assets) {localAssets.set(id,value);this.assetFingerprints.set(id,password+'\0'+(value.passwordProtected?this.crypt.decrypt(value.value,password):value.value));}
  }
  async clear():Promise<void> {
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const tx=this.db.transaction(['records','assets','meta'],'readwrite');const done=completed(tx);
    tx.objectStore('records').clear();tx.objectStore('assets').clear();tx.objectStore('meta').clear();tx.objectStore('meta').put(key,'key');await done;
    this.key=key;this.loadedRecords=[];this.loadedFingerprintCache=false;
    localAssets.clear();this.fingerprints.clear();this.assetFingerprints.clear();this.assetIds.clear();
  }
}
