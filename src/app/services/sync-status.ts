import { OutboxOp } from '../models/Sync';

export const SYNC_NOTICE_ATTEMPTS = 6;

/** Only actual failed requests count; waiting offline never raises a notice. */
export function requiresSyncAttention(queue: OutboxOp[]): boolean {
  return queue.some(item => (item.attempt ?? 0) >= SYNC_NOTICE_ATTEMPTS);
}
