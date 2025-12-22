// src/app/services/outbox-storage.service.ts
import { Injectable } from '@angular/core';
import { Storage as IonicStorage } from '@ionic/storage-angular';
import { OutboxOp } from '../models/Sync';

const OUTBOX_KEY = 'notes.sync.outbox.v1';

@Injectable({ providedIn: 'root' })
export class OutboxStorage {
  private ready: Promise<void>;

  constructor(private storage: IonicStorage) {
    this.ready = this.init();
  }

  private async init() {
    await this.storage.create();
    const existing = await this.storage.get(OUTBOX_KEY);
    if (!Array.isArray(existing)) {
      await this.storage.set(OUTBOX_KEY, []);
    }
  }

  private async read(): Promise<OutboxOp[]> {
    await this.ready;
    return (await this.storage.get(OUTBOX_KEY)) ?? [];
  }

  private async write(items: OutboxOp[]) {
    await this.ready;
    await this.storage.set(OUTBOX_KEY, items);
  }

  /** Add a new operation to the queue (FIFO). */
  async enqueue(op: OutboxOp) {
    const items = await this.read();
    items.push(op);
    await this.write(items);
  }

  /**
   * Read up to `limit` ops that are due (nextAt <= now), without removing them.
   * Use `drop()` to remove after successful processing.
   */
  async peekBatch(limit = 50, now = Date.now()): Promise<OutboxOp[]> {
    const items = await this.read();
    return items.filter(x => (x.nextAt ?? 0) <= now).slice(0, limit);
  }

  /** Remove a set of operations by id (after successful processing). */
  async drop(opIds: string[]) {
    const items = await this.read();
    const next = items.filter(i => !opIds.includes(i.opId));
    await this.write(next);
  }

  /** Replace the entire queue (useful after updating attempts/nextAt). */
  async replace(updated: OutboxOp[]) {
    await this.write(updated);
  }

  /** Introspect the whole queue (debug/metrics). */
  async getAll(): Promise<OutboxOp[]> {
    return this.read();
  }

  /** Optional: clear everything (use with care). */
  async clear(): Promise<void> {
    await this.write([]);
  }
}
