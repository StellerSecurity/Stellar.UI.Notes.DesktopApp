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
    return CryptoJS.AES.decrypt(value, password).toString(CryptoJS.enc.Utf8);
  }

}
