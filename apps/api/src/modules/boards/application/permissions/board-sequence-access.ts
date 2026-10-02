import type { ServerSequence } from '@archboard/contracts';
import type { BoardPermissionTransaction } from './board-permissions.js';

/** Board-owned storage port. All operations use the caller's active transaction. */
export abstract class BoardSequenceAccess {
  public abstract lock(
    transaction: BoardPermissionTransaction,
    boardId: string,
  ): Promise<string | null>;
  /** Caller already holds the board authority write lock on this transaction. */
  public abstract advance(
    transaction: BoardPermissionTransaction,
    boardId: string,
    sequence: ServerSequence,
  ): Promise<void>;
}
