import { Injectable } from '@angular/core';
import {BehaviorSubject, firstValueFrom, Observable} from 'rxjs';
import { loginDto } from '../constants/models/authDto';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import { auth, baseUrl } from '../constants/api/product.api';
import { SecureStorageService } from './secure-storage.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private loggedInSubject = new BehaviorSubject<boolean>(false);
  private authStateRevision = 0;

  public readonly loginState$ = this.loggedInSubject.asObservable();

  constructor(private http: HttpClient, private secureStorageService: SecureStorageService) {
    this.initializeAuthState();
  }

  get isLoggedIn(): boolean {
    return this.loggedInSubject.value;
  }

  setLoggedInState(isLoggedIn: boolean): void {
    this.authStateRevision++;
    this.loggedInSubject.next(!!isLoggedIn);
  }

  async initializeAuthState() {
    const revision = ++this.authStateRevision;
    const token = await this.secureStorageService.getItem('ssToken');
    // A pending storage read must not overwrite a later login/logout.
    if (revision === this.authStateRevision) this.loggedInSubject.next(!!token);
  }

  createAccount(data: loginDto): Observable<any> {
    return this.http.post<any>(baseUrl + auth.createAcc, data);
  }

  loginHandling(data: loginDto): Observable<any> {
    return this.http.post<any>(baseUrl + auth.loginAcc, data);
  }

  async updateEak(payload: {
    crypto_version: string;
    kdf_params: {
      algo: string;
      hash: string;
      iters: number;
    };
    kdf_salt: string;
    eak: string;
  }): Promise<any> {
    const TOKEN = await this.secureStorageService.getItem('ssToken');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${TOKEN ?? ''}`);

    return firstValueFrom(
      this.http.patch<any>(baseUrl + auth.updateEak, payload, { headers })
    );
  }

  forgotPassword(email: any): Observable<any> {
    return this.http.post<any>(baseUrl + auth.forgotPassword, { email });
  }

  resetPassword(data: any): Observable<any> {
    return this.http.post<any>(baseUrl + auth.resetPasswordUrl, data);
  }
}
