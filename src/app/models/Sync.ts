// src/app/models/Sync.ts
import { NoteV1 } from './NoteV1';

export type OutboxOpType = 'upload' | 'delete';

export interface UploadPayload {
  op_id: string;
  since: number;
  notes: NoteV1[];
  deleted_ids?: string[];
}

export interface DeletePayload {
  op_id: string;
  since: number;
  notes: [];            // delete-only
  deleted_ids: string[];
}

export type AnyPayload = UploadPayload | DeletePayload;

export interface OutboxOp {
  opId: string;         // mirrors payload.op_id
  type: OutboxOpType;   // 'upload' | 'delete'
  payload: AnyPayload;  // raw payload sent to API
  attempt?: number;     // retry count
  nextAt?: number;      // epoch ms — eligible after this time
  createdAt?: number;   // epoch ms — when enqueued
}

// Optional helper to create a well-formed op
export function makeOutboxOp(type: OutboxOpType, payload: AnyPayload): OutboxOp {
  const now = Date.now();
  return {
    opId: payload.op_id,
    type,
    payload,
    attempt: 0,
    nextAt: now,
    createdAt: now,
  };
}
