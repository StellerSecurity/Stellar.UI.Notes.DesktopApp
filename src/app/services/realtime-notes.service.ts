import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthService } from './auth.service';
import { SecureStorageService } from './secure-storage.service';
import { baseUrl } from '../constants/api/product.api';
import { desktopRealtimeGrant } from './desktop-realtime-grant';

export function validRealtimeGrant(value: any, now = Date.now()): boolean {
  try {
    const url = new URL(value.url);
    return value.enabled === true && url.protocol === 'wss:' && !url.username && !url.password
      && !url.port && /^[a-z0-9-]+\.webpubsub\.azure\.com$/.test(url.hostname)
      && url.pathname === '/client/hubs/notes' && url.searchParams.has('access_token')
      && Number.isFinite(value.expires_at) && value.expires_at > now + 1000 && value.expires_at <= now + 65000;
  } catch { return false; }
}

/** Notifications are hints only. Existing polling and durable uploads are never stopped. */
@Injectable({ providedIn: 'root' })
export class RealtimeNotesService {
  private started = false;
  private generation = 0;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private lastHint = 0;
  constructor(private http: HttpClient, private auth: AuthService, private secure: SecureStorageService) {}
  init(): void {
    if (this.started) return;
    this.started = true;
    this.auth.loginState$.subscribe(() => this.restart());
    document.addEventListener('visibilitychange', () => this.restart());
    window.addEventListener('online', () => this.restart());
    window.addEventListener('offline', () => this.stop());
  }
  private stop(): void {
    this.generation++;
    clearTimeout(this.retry); clearTimeout(this.expiry);
    const socket = this.socket; this.socket = undefined;
    if (socket) { socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.onopen = null; socket.close(); }
  }
  private restart(): void {
    this.stop();
    if (this.auth.isLoggedIn && !document.hidden && navigator.onLine) void this.connect(this.generation);
  }
  private schedule(generation: number, delay: number): void {
    if (generation !== this.generation) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.restart(), delay);
  }
  private async hint(generation: number, token: string): Promise<void> {
    if (generation !== this.generation || !this.auth.isLoggedIn) return;
    if (await this.secure.getItem('ssToken') !== token || generation !== this.generation) { this.restart(); return; }
    if (Date.now() - this.lastHint < 1000) return;
    this.lastHint = Date.now();
    window.dispatchEvent(new Event('stellar:notes-changed'));
  }
  private async connect(generation: number): Promise<void> {
    try {
      const token = await this.secure.getItem('ssToken');
      if (!token || generation !== this.generation || !this.auth.isLoggedIn) return;
      const grant = window.location.protocol === 'file:' ? await desktopRealtimeGrant(token) : await firstValueFrom(this.http.post<any>(baseUrl + 'api/v1/notescontroller/realtime', {}, {
        headers: new HttpHeaders().set('Authorization', `Bearer ${token}`)
      }).pipe(timeout(8000)));
      if (generation !== this.generation || await this.secure.getItem('ssToken') !== token) return;
      if (!validRealtimeGrant(grant)) { this.schedule(generation, grant?.retry_after_ms === 5000 ? 5000 : 300000); return; }
      const socket = new WebSocket(grant.url);
      this.socket = socket;
      this.expiry = setTimeout(() => this.restart(), Math.max(1000, grant.expires_at - Date.now()));
      socket.onopen = () => { this.failures = 0; void this.hint(generation, token).catch(() => this.restart()); };
      socket.onmessage = event => {
        if (typeof event.data !== 'string' || event.data.length > 128) return;
        try { if (JSON.parse(event.data).type === 'notes.changed') void this.hint(generation, token).catch(() => this.restart()); } catch {}
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => this.schedule(generation, Math.min(60000, 1000 * 2 ** Math.min(++this.failures, 6)) + Math.random() * 1000);
    } catch {
      // Do not log negotiation responses, access URLs or credentials.
      this.schedule(generation, Math.min(300000, 2000 * 2 ** Math.min(++this.failures, 7)) + Math.random() * 1000);
    }
  }
}
