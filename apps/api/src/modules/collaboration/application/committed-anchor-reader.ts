import type { ErrorCode, ThreadAnchor } from '@archboard/contracts';

export interface CommittedAnchorTransaction {
  readonly isTransactionActive: boolean;
}

export type ObjectThreadAnchor = Exclude<ThreadAnchor, { type: 'point' }>;

export class CommittedAnchorError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The caller holds the board authority lock; all reads use that same transaction. */
export abstract class CommittedAnchorReader {
  public abstract resolve(
    transaction: CommittedAnchorTransaction,
    boardId: string,
    latestSeq: string,
    anchor: ObjectThreadAnchor,
  ): Promise<ObjectThreadAnchor>;
}
