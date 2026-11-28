import { Injectable } from '@angular/core';
import {BehaviorSubject, firstValueFrom, Observable, timeout} from 'rxjs';
import { loginDto } from '../constants/models/authDto';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import { auth, baseUrl } from '../constants/api/product.api';
import { SecureStorageService } from './secure-storage.service';
import { IdentityAuthService } from './identity-auth.service';
import { IdentitySession } from '../utils/stellar-id-client';
import { sessionToken } from '../utils/session-token';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private loggedInSubject = new BehaviorSubject<boolean>(false);
  private authStateRevision = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private publishedToken: string | null = null;
  private rememberedSession = false;

  public readonly loginState$ = this.loggedInSubject.asObservable();

  constructor(private http: HttpClient, private secureStorageService: SecureStorageService, private identity: IdentityAuthService) {
    this.initializeAuthState();
  }

  get isLoggedIn(): boolean {
    return this.loggedInSubject.value || this.rememberedSession;
  }

  get hasActiveSession(): boolean { return this.loggedInSubject.value; }

  setLoggedInState(isLoggedIn: boolean): void {
    if (!isLoggedIn) this.rememberedSession = false;
    this.authStateRevision++;
    clearTimeout(this.expiryTimer);
    this.loggedInSubject.next(!!isLoggedIn);
    if (isLoggedIn) void this.initializeAuthState();
  }

  async initializeAuthState() {
    const revision = ++this.authStateRevision;
    clearTimeout(this.expiryTimer);
    let token: string | null = null;
    try { token = await this.identity.ensureSession(); } catch { /* Retry without touching local data. */ }
    if (revision !== this.authStateRevision) return;
    let remembered = false;
    try {
      const meta = JSON.parse(await this.secureStorageService.getItem('ssIdentitySession') || '{}');
      const owner = JSON.parse(await this.secureStorageService.getItem('ssUser') || 'null');
      const storedAccess = await this.secureStorageService.getItem('ssToken');
      remembered = await this.secureStorageService.getItem('ssAuthVersion') === '2' && !meta.refreshRejected
        && typeof storedAccess === 'string' && meta.tokenId === storedAccess.split('|')[0]
        && String(owner?.id) === meta.accountId && typeof meta.email === 'string'
        && String(owner?.email).trim().toLowerCase() === meta.email.trim().toLowerCase()
        && typeof meta.refreshToken === 'string' && /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(meta.refreshToken)
        && Date.parse(meta.refreshExpiresAt) > Date.now();
    } catch { /* Malformed metadata does not establish an account. */ }
    if (revision !== this.authStateRevision) return;
    const changed = this.rememberedSession !== remembered; this.rememberedSession = remembered;
    if (changed || this.publishedToken !== token || this.loggedInSubject.value !== !!token) {
      this.publishedToken = token; this.loggedInSubject.next(!!token);
    }
    try { if (await this.secureStorageService.getItem('ssAuthVersion') === '2') {
      const raw = await this.secureStorageService.getItem('ssIdentitySession');
      if (revision !== this.authStateRevision) return;
      if (raw) this.expiryTimer = setTimeout(() => { void this.initializeAuthState(); }, 30000);
    } } catch { if (revision === this.authStateRevision) this.expiryTimer = setTimeout(() => { void this.initializeAuthState(); }, 30000); }
  }

  async signIn(email: string, password: string): Promise<{ response: any; identity?: IdentitySession }> {
    await this.identity.assertAccount(email);
    if (await this.identity.method(email) === 'legacy') {
      return { response: await firstValueFrom(this.loginHandling({ username: email, password })) };
    }
    const identity = await this.identity.login(email, password);
    return { response: this.identity.sessionResponse(identity), identity };
  }

  async rememberSession(session?: IdentitySession): Promise<void> {
    if (session) await this.identity.rememberSession(session);
    else {
      await this.identity.clearSession();
      await this.secureStorageService.setItem('ssAuthVersion', '1');
    }
  }

  async revokeIdentity(token: string): Promise<void> { await this.identity.revoke(token); }
  async logoutIdentity(): Promise<void> { await this.identity.logout(); }

  createAccount(data: loginDto): Observable<any> {
    return this.http.post<any>(baseUrl + auth.createAcc, data);
  }

  loginHandling(data: loginDto): Observable<any> {
    return this.http.post<any>(baseUrl + auth.loginAcc, data).pipe(timeout(15000));
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
