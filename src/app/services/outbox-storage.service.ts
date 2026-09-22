// src/app/services/outbox-storage.service.ts
import { Injectable } from '@angular/core';
import { Storage as IonicStorage } from '@ionic/storage-angular';
import { OutboxOp } from '../models/Sync';

const OUTBOX_KEY = 'notes.sync.outbox.v1';

@Injectable({ providedIn: 'root' })
export class OutboxStorage {
  private ready: Promise<void>;
  private serial: Promise<unknown> = Promise.resolve();
  private sessionGeneration = 0;
  get generation(): number { return this.sessionGeneration; }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.serial.then(() => this.ready).then(action);
    this.serial = result.catch(() => undefined);
    return result;
  }

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
  async enqueue(op: OutboxOp, coalesce = false, immediate = false, generation = this.generation) {
    return this.exclusive(async () => {
      let items = await this.read();
      if (generation !== this.generation) throw new Error('Note session changed');
      // Only compact complete single-note snapshots, never folder/batch/delete operations.
      const single = (item: OutboxOp) => item.type === 'upload' && item.payload.notes?.length === 1
        && !(item.payload as any).folders?.length && !item.payload.deleted_ids?.length;
      if (coalesce && single(op)) {
        const note = op.payload.notes[0];
        const barrier = items.reduce((last, item, i) => !single(item) ? i : last, -1);
        const previous = items.filter((item, i) => i > barrier && single(item) && item.payload.notes[0].id === note.id);
        // Encryption can complete out of order. Never replace a newer durable version.
        if (previous.some(item => Number(item.payload.notes[0].last_modified) >= Number(note.last_modified))) return;
        const now = Date.now();
        op = { ...op, createdAt: Math.min(now, ...previous.map(item => item.createdAt ?? now)) };
        op.nextAt = immediate ? now : Math.min(now + 500, op.createdAt! + 5000);
        const superseded = new Set(previous.map(item => item.opId));
        items = items.filter(item => !superseded.has(item.opId));
      }
      const index = items.findIndex(item => item.opId === op.opId);
      if (index < 0) items.push(op); else items[index] = op;
      await this.write(items);
    });
  }

  /**
   * Read up to `limit` ops that are due (nextAt <= now), without removing them.
   * Use `drop()` to remove after successful processing.
   */
  async peekBatch(limit = 50, now = Date.now()): Promise<OutboxOp[]> {
    const items = await this.read();
    return items.filter(x => !x.conflict && (x.nextAt ?? 0) <= now).slice(0, limit);
  }

  /** Remove a set of operations by id (after successful processing). */
  async drop(opIds: string[]) {
    return this.exclusive(async () => {
      const items = await this.read();
      await this.write(items.filter(i => !opIds.includes(i.opId)));
    });
  }

  /** Replace the entire queue (useful after updating attempts/nextAt). */
  async replace(updated: OutboxOp[]) {
    await this.exclusive(() => this.write(updated));
  }

  update(opId: string, change: (op: OutboxOp) => OutboxOp): Promise<void> {
    return this.exclusive(async () => this.write((await this.read()).map(item => item.opId === opId ? change(item) : item)));
  }

  /** Introspect the whole queue (debug/metrics). */
  async getAll(): Promise<OutboxOp[]> {
    return this.exclusive(() => this.read());
  }

  /** Remove only versions explicitly covered by the user's conflict choice. */
  async discardChosenVersions(versions: Record<string, number>): Promise<void> {
    return this.exclusive(async () => {
      const result: OutboxOp[] = [];
      for (const item of await this.read()) {
        if (item.type !== 'upload') { result.push(item); continue; }
        const notes = item.payload.notes.filter(n => !(n.id in versions) || Number(n.last_modified) > versions[n.id]);
        if (notes.length === item.payload.notes.length) { result.push(item); continue; }
        if (!notes.length && !(item.payload as any).folders?.length && !item.payload.deleted_ids?.length) continue;
        // A changed body needs a fresh idempotency identity.
        const opId = globalThis.crypto.randomUUID();
        result.push({ ...item, opId, payload: { ...item.payload, op_id: opId, notes } });
      }
      await this.write(result);
    });
  }

  /** Optional: clear everything (use with care). */
  async clear(): Promise<void> {
    this.sessionGeneration++;
    await this.exclusive(() => this.write([]));
  }
}
