import type { BoardPermissionTransaction } from './board-permissions.js';

/** Reuses the board transaction boundary without exposing database infrastructure to consumers. */
export abstract class BoardAuthorityTransaction {
  public abstract run<T>(work: (transaction: BoardPermissionTransaction) => Promise<T>): Promise<T>;
}
