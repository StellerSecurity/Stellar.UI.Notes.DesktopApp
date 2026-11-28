import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { IdentitySession, StellarIdClient } from '../utils/stellar-id-client';
import { SecureStorageService } from './secure-storage.service';
import { IdentityRenewal } from '../utils/identity-renewal';

@Injectable({ providedIn: 'root' })
export class IdentityAuthService {
  private clientPromise: Promise<StellarIdClient> | null = null;

  private renewal: IdentityRenewal;
  constructor(private http: HttpClient, private secure: SecureStorageService) {
    this.renewal = new IdentityRenewal(secure, (refreshToken, requestId) => firstValueFrom(
      this.http.post<any>(environment.baseUrl + 'api/v2/auth/refresh', {refreshToken, requestId}).pipe(timeout(15000))));
  }

  ensureSession(): Promise<string | null> { return this.renewal.ensure(); }

  private async client(): Promise<StellarIdClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.loadClient().catch(error => { this.clientPromise = null; throw error; });
    }
    return this.clientPromise;
  }

  private async loadClient(): Promise<StellarIdClient> {
    const url = 'https://stellaruserapiprod.azurewebsites.net/api/v2/auth/keys';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok || response.url !== url) throw new Error('identityUnavailable');
      const body = await response.text();
      if (body.length > 2048) throw new Error('identityVerificationFailed');
      const keys = JSON.parse(body);
      if (!keys || Object.keys(keys).sort().join(',') !== 'issuer,methodKey,opaqueKey,version'
        || keys.version !== 1 || keys.issuer !== 'https://id.stellarsecurity.com' || typeof keys.methodKey !== 'string'
        || keys.methodKey.length > 256 || typeof keys.opaqueKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(keys.opaqueKey)) throw new Error('identityVerificationFailed');
      return new StellarIdClient(keys, (operation, payload) => firstValueFrom(
        this.http.post<Record<string, any>>(environment.baseUrl + 'api/v2/auth/' + operation, payload).pipe(timeout(15000)),
      ));
    } finally { clearTimeout(timer); }
  }

  private async marker(email: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase())));
    return 'ssIdentityMode:' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async assertAccount(email: string): Promise<void> {
    const raw = await this.secure.getItem('ssUser');
    if (!raw) return;
    const user = JSON.parse(raw);
    if (typeof user?.email !== 'string' || user.email.trim().toLowerCase() !== email.trim().toLowerCase()) throw new Error('identityAccountSwitchRequiresLogout');
  }

  async method(email: string): Promise<'legacy' | 'opaque'> {
    const known = await this.secure.getItem(await this.marker(email));
    return (await this.client()).method(email, known === 'opaque');
  }

  async login(email: string, password: string): Promise<IdentitySession> {
    const session = await (await this.client()).login(email, password);
    try { await this.secure.setItem(await this.marker(email), 'opaque'); }
    catch (error) {
      session.rootKey.fill(0);
      await (await this.client()).logout(session.token).catch(() => {});
      throw error;
    }
    return session;
  }

  sessionResponse(session: IdentitySession): Record<string, any> {
    return { response_code: 200, token: session.token, user: { id: session.accountId, email: session.email,
      auth_version: 2, crypto_version: 'opaque-v1', eak_b64: session.keyEnvelope } };
  }

  async rememberSession(session: IdentitySession): Promise<void> {
    await this.renewal.invalidate();
    await this.secure.setItem('ssIdentitySession', JSON.stringify({ accountId: session.accountId, email: session.email, tokenId: session.token.split('|')[0],
      expiresAt: session.expiresAt, keyEnvelope: session.keyEnvelope,
      ...(session.refreshToken ? {refreshToken:session.refreshToken,refreshExpiresAt:session.refreshExpiresAt} : {}) }));
    await this.secure.setItem('ssAuthVersion', '2');
  }

  async clearSession(): Promise<void> {
    await this.renewal.invalidate();
    await this.secure.removeItem('ssIdentitySession');
    await this.secure.removeItem('ssAuthVersion');
  }

  async revoke(token: string): Promise<void> {
    await (await this.client()).logout(token);
  }

  async logout(): Promise<void> {
    await this.renewal.invalidate();
    const raw = await this.secure.getItem('ssIdentitySession');
    const refreshToken = raw ? JSON.parse(raw).refreshToken : null;
    const token = await this.secure.getItem('ssToken');
    if (refreshToken) await firstValueFrom(this.http.post(environment.baseUrl + 'api/v2/auth/logout-refresh', {refreshToken}).pipe(timeout(15000)));
    else if (token && await this.secure.getItem('ssAuthVersion') === '2') await this.revoke(token);
  }
}
