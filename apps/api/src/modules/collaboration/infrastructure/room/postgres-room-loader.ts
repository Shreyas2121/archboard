import { ERROR_CODES, type ErrorCode, type ServerSequence } from '@archboard/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import * as Y from 'yjs';

import type { LoadedRoom, RoomLoader } from '../../application/room-registry.js';
import {
  CommittedGraphError,
  readCommittedGraph,
  requireCommittedRecords,
} from './committed-graph.js';
import { ValidationWorkerError, ValidationWorkerPool } from '../validation-worker/index.js';

export class RoomLoadError extends Error {
  public constructor(public readonly code: ErrorCode) {
    super('Committed board content is unavailable.');
    this.name = 'RoomLoadError';
  }
}

@Injectable()
export class PostgresRoomLoader implements RoomLoader {
  public constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ValidationWorkerPool) private readonly workers = new ValidationWorkerPool(),
  ) {}

  public async load(boardId: string): Promise<LoadedRoom> {
    const runner = this.dataSource.createQueryRunner();
    let document: Y.Doc | undefined;
    let transferred = false;
    try {
      await runner.connect();
      // Every batched read sees the same committed version even while updates/compaction commit.
      await runner.startTransaction('REPEATABLE READ');
      const board = await runner.manager
        .createQueryBuilder()
        .select('board.latest_seq::text', 'latestSeq')
        .from('boards', 'board')
        .where('board.id = :boardId', { boardId })
        .getRawOne<{ latestSeq: string }>();
      if (!board) throw new RoomLoadError(ERROR_CODES.NOT_FOUND);
      const graph = await readCommittedGraph(runner.manager, boardId);
      requireCommittedRecords(graph, board.latestSeq);
      const result = await this.workers.validate({
        acceptedState: graph.snapshot.updateBytes,
        update: new Uint8Array(),
        reconstruction: {
          updates: graph.updates.map((update) => update.updateBytes),
          remap: false,
        },
      });
      document = new Y.Doc();
      Y.applyUpdate(document, result.candidateState);
      await runner.commitTransaction();
      transferred = true;
      return {
        document,
        latestSeq: board.latestSeq as ServerSequence,
        compactedSeq: graph.snapshot.throughSeq as ServerSequence,
      };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      if (error instanceof RoomLoadError) throw error;
      if (error instanceof CommittedGraphError) throw new RoomLoadError(error.code);
      if (error instanceof ValidationWorkerError)
        throw new RoomLoadError(
          error.code === ERROR_CODES.CAUSAL_GAP ? ERROR_CODES.DOCUMENT_INVALID : error.code,
        );
      throw new RoomLoadError(ERROR_CODES.SERVER_BUSY);
    } finally {
      if (!transferred) document?.destroy();
      await runner.release().catch(() => undefined);
    }
  }
}
