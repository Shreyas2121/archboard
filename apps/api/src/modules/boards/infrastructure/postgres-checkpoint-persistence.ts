import type { DataSource, QueryRunner } from 'typeorm';
import {
  CommittedGraphReadError,
  type CommittedGraphReader,
} from '../../collaboration/application/index.js';
import type { CheckpointPersistence, CheckpointScope } from '../application/checkpoint-service.js';
import type { BoardAuthorityState } from '../application/permissions/index.js';
import { BoardServiceError } from '../application/board-service.js';
import { BoardTransaction } from './board-transaction.js';
import { IdempotencyService } from './idempotency.js';
import { CheckpointRepository } from './checkpoint-repository.js';
import type { PostgresBoardPersistence } from './postgres-board-persistence.js';

const HTTP_CREATED = 201;

export class PostgresCheckpointPersistence implements CheckpointPersistence {
  private readonly transactions: BoardTransaction;
  private readonly receipts: IdempotencyService;
  public constructor(
    dataSource: DataSource,
    private readonly reader: CommittedGraphReader,
    private readonly boards: PostgresBoardPersistence,
  ) {
    this.transactions = new BoardTransaction(dataSource);
    this.receipts = new IdempotencyService(dataSource);
  }
  public run<T>(work: (scope: CheckpointScope) => Promise<T>): Promise<T> {
    return this.transactions.run((runner) => work(this.scope(runner)));
  }
  public idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    authorize: (scope: CheckpointScope) => Promise<BoardAuthorityState>,
    effect: (scope: CheckpointScope, board: BoardAuthorityState) => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }> {
    let board: BoardAuthorityState | undefined;
    return this.receipts.execute(
      actorUserId,
      operation,
      key,
      request,
      async (runner) => {
        if (!board) throw new Error('Checkpoint effect requires locked authority.');
        return { status: HTTP_CREATED, body: await effect(this.scope(runner), board) };
      },
      async (runner) => {
        board = await authorize(this.scope(runner));
      },
    );
  }
  private scope(runner: QueryRunner): CheckpointScope {
    const repository = new CheckpointRepository(runner.manager);
    const safe = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof CommittedGraphReadError)
          throw new BoardServiceError(error.code, error.message);
        throw error;
      }
    };
    return {
      permissionTransaction: runner,
      boards: this.boards.scope(runner),
      list: (boardId, limit, cursor) => repository.list(boardId, limit, cursor),
      summary: (boardId, checkpointId) => repository.summary(boardId, checkpointId),
      count: (boardId) => repository.count(boardId),
      capture: (boardId, sequence) => safe(() => this.reader.capture(runner, boardId, sequence)),
      project: (boardId, checkpointId) =>
        safe(async () => {
          const stored = await repository.bytes(boardId, checkpointId);
          return this.reader.project(stored.bytes, stored.schemaVersion);
        }),
      insert: (boardId, actorUserId, name, sequence, bytes) =>
        repository.insert(boardId, actorUserId, name, sequence, bytes),
    };
  }
}
