// services/sync-worker.service.ts
import { Injectable, NgZone } from '@angular/core';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { OutboxStorage } from './outbox-storage.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {SecureStorageService} from "./secure-storage.service";

const MAX_ATTEMPT = 8;

@Injectable({ providedIn: 'root' })
export class SyncWorkerService {
  private syncing = false;

  private base = 'https://stellarprivatenotesuiappapiprod-dmefgreabahpcsbm.swedencentral-01.azurewebsites.net/api/v1/notescontroller/';

  constructor(
    private http: HttpClient,
    private outbox: OutboxStorage,
    private zone: NgZone,
    private secure: SecureStorageService
  ) {}

  init() {
    console.log('SyncWorkerService initialized');
    // Run every 10s (tweak as needed)
    setInterval(() => this.trySync(), 10_000);

    Network.addListener('networkStatusChange', () => this.trySync());
    App.addListener('appStateChange', (s) => { if (s.isActive) this.trySync(); });

    // Kick off once on startup
    this.trySync();
  }

  private async isOnline(): Promise<boolean> {
    const st = await Network.getStatus();
    return st.connected ?? navigator.onLine;
  }

  private backoffMs(attempt: number): number {
    // 1s, 2s, 4s, 8s, ... cap at ~60s
    return Math.min(60_000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  }

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.secure.getItem('ssToken');
    let h = new HttpHeaders();
    if (token) h = h.set('Authorization', `Bearer ${token}`);
    return h;
  }

  async trySync() {

    if (this.syncing) {
      console.log('Already syncing...');
      return;
    }
    if (!(await this.isOnline())) {
      console.log('Skip sync: offline');
      return;
    }

    this.syncing = true;
    try {
      const now = Date.now();
      const batch = await this.outbox.peekBatch(50, now);

      if (batch.length === 0) {
        return;
      }

      const body = {
        ops: batch.map((o:any) => ({
          opId: o.opId,
          type: o.type,
          payload: o.payload,
        })),
      };

      const headers = await this.authHeaders();

      const res = await this.http.post(`${this.base}/sync-plan`, body, { headers }).toPromise();

      // Assume success returns list of applied opIds (or simply 200 OK = all applied)
      const appliedOpIds: string[] = Array.isArray((res as any)?.applied)
        ? (res as any).applied
        : batch.map((b: any) => b.opId);

      // Drop applied
      await this.outbox.drop(appliedOpIds);

      // For any not-applied (partial failures), update attempts + nextAt
      const remaining = await this.outbox.getAll();
      const remainingById = new Map(remaining.map((i:any) => [i.opId, i]));
      for (const op of batch) {
        try {
          if (op.type === 'upload') {
            // Payload already has: { op_id, since, notes, deleted_ids? }
            await this.http.post(`${this.base}upload`, op.payload, { headers }).toPromise();
            await this.outbox.drop([op.opId]);
          } else if (op.type === 'delete') {
            // Server wants: { deleted_ids, notes: [] }
            const body = { deleted_ids: op.payload.deleted_ids ?? [], notes: [] };
            await this.http.post(`${this.base}sync-plan`, body, { headers }).toPromise();
            await this.outbox.drop([op.opId]);
          } else {
            console.warn('Unknown op type, dropping', op.type, op.opId);
            await this.outbox.drop([op.opId]);
          }
        } catch (e) {
          console.error('Sync send failed for', op.opId, e);
          // backoff this op, leave others to try
          const all = await this.outbox.getAll();
          const item = all.find(a => a.opId === op.opId);
          if (item) {
            item.attempt = (item.attempt ?? 0) + 1;
            if (item.attempt > MAX_ATTEMPT) {
              // dead-letter: drop it (or move to separate key if you want)
              await this.outbox.drop([item.opId]);
            } else {
              item.nextAt = Date.now() + this.backoffMs(item.attempt);
              await this.outbox.replace(all);
            }
          }
        }
      }
      await this.outbox.replace(Array.from(remainingById.values()));
    } catch (e) {
      console.log('Error..?');
      console.error(e);
      console.log(e);
      // Network/API error: push back whole batch
      const all = await this.outbox.getAll();
      const ids = new Set(all.map((a:any) => a.opId));
      const now = Date.now();
      for (const op of all) {
        if (ids.has(op.opId)) {
          op.attempt = (op.attempt ?? 0) + 1;
          op.nextAt = now + this.backoffMs(op.attempt);
        }
      }
      await this.outbox.replace(all);
    } finally {
      this.syncing = false;
    }
  }
}
