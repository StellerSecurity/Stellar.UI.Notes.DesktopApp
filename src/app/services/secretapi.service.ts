import { Injectable } from '@angular/core';
import {environment} from "../../environments/environment";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {Secret} from "../models/Secret";

@Injectable({
  providedIn: 'root'
})
export class SecretapiService {
  

  constructor(private http: HttpClient) { }

  public create(secret: Secret) {

    const httpOptions = {
      headers: new  HttpHeaders({
        'Content-Type':  'application/json'
      })
    };

    return this.http.post<any>(environment.secret_api_url + "v2/secretcontroller/add", secret, httpOptions).pipe();

  }

  public delete(id: string) {
    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type':  'application/json'
      })
    };

    return this.http.delete<any>(environment.secret_api_url + "v1/secretcontroller/delete?id=" + id,httpOptions).pipe();
  }

}
