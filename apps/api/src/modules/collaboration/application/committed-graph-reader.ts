import type { GraphProjection, ErrorCode } from '@archboard/contracts';
import type { CommittedAnchorTransaction } from './committed-anchor-reader.js';

export class CommittedGraphReadError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Caller holds the board lock. Bytes are committed state, never an in-flight candidate. */
export abstract class CommittedGraphReader {
  public abstract capture(
    transaction: CommittedAnchorTransaction,
    boardId: string,
    latestSeq: string,
  ): Promise<Uint8Array>;
  public abstract project(bytes: Uint8Array, schemaVersion: number): Promise<GraphProjection>;
}

export abstract class BoardOperationQueue {
  public abstract run<T>(boardId: string, work: () => Promise<T>): Promise<T>;
}
