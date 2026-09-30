import type { ServerSequence } from '@archboard/contracts';
import type { BoardPermissionTransaction } from '../../boards/application/index.js';
import type { DurableUpdateReceipt } from './durable-update.js';

export const DURABLE_UPDATE_PERSISTENCE = Symbol('DURABLE_UPDATE_PERSISTENCE');

export interface DurableUpdateWrite {
  readonly updateId: string;
  readonly actorUserId: string;
  readonly updateBytes: Uint8Array;
  readonly payloadHash: Uint8Array;
}

export interface DurableUpdateWriteScope {
  readonly permissionTransaction: BoardPermissionTransaction;
  findReceipt(updateId: string): Promise<DurableUpdateReceipt | null>;
  append(latestSeq: ServerSequence, update: DurableUpdateWrite): Promise<ServerSequence>;
}

export interface DurableUpdatePersistence {
  findReceipt(boardId: string, updateId: string): Promise<DurableUpdateReceipt | null>;
  run<T>(boardId: string, work: (scope: DurableUpdateWriteScope) => Promise<T>): Promise<T>;
}
