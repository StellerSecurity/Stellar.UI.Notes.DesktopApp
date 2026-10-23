import { expandLocalAssets, LOCAL_NOTES_ENVELOPE } from '../utils/local-note-assets';
import {Injectable} from '@angular/core';

declare var require: any;
var CryptoJS = require('crypto-js');
@Injectable({
  providedIn: 'root'
})
export class CryptoService {

  constructor() { }
  public encrypt(value: any, password: string) {
    // returns the encrypted value in BASE64 encoded.
    return CryptoJS.AES.encrypt(value, password).toString();
  }

  public decrypt(value: any, password: string) {
    const decrypt = (cipher:string,key:string) => CryptoJS.AES.decrypt(cipher,key).toString(CryptoJS.enc.Utf8);
    if (typeof value === 'string' && value.startsWith('{')) {
      const envelope = JSON.parse(value);
      if (envelope[LOCAL_NOTES_ENVELOPE] === 1 && Array.isArray(envelope.records)) {
        if(envelope.check && decrypt(envelope.check,password)!=='stellar-local-unlock-v1')throw Error('Local notes are locked');
        const notes = envelope.records.map((cipher:string) => JSON.parse(decrypt(cipher,password)));
        return JSON.stringify(expandLocalAssets(notes,password,decrypt));
      }
    }
    return decrypt(value,password);
  }

}
