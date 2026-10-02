import {
  ERROR_CODES,
  MAX_CHECKPOINTS_PER_BOARD,
  GRAPH_SCHEMA_VERSION,
  checkpointPathSchema,
  createCheckpointSchema,
  restoreCheckpointSchema,
  decodePageCursor,
  encodePageCursor,
  type CheckpointSummary,
  type CheckpointDetail,
  type CheckpointListQuery,
  type CheckpointListResponse,
  type CreateCheckpoint,
  type RestoreCheckpoint,
  type BoardDetail,
  type GraphProjection,
} from '@archboard/contracts';
import { createFreshGraphUpdate } from '@archboard/document-model';
import type { BoardOperationQueue } from '../../collaboration/application/index.js';
import { BoardServiceError, type BoardService, type BoardWriteScope } from './board-service.js';
import type {
  BoardAuthorityState,
  BoardPermissionService,
  BoardPermissionTransaction,
} from './permissions/index.js';
import type { BoardResourceNotification } from './board-resource-notification.js';

export interface CheckpointActor {
  userId: string;
  requireCurrentSession(): Promise<void>;
}
export interface CheckpointScope {
  permissionTransaction: BoardPermissionTransaction;
  boards: BoardWriteScope;
  list(
    boardId: string,
    limit: number,
    cursor?: { timestamp: string; id: string },
  ): Promise<CheckpointSummary[]>;
  summary(boardId: string, checkpointId: string): Promise<CheckpointSummary | null>;
  project(boardId: string, checkpointId: string): Promise<GraphProjection>;
  count(boardId: string): Promise<number>;
  capture(boardId: string, sequence: string): Promise<Uint8Array>;
  insert(
    boardId: string,
    actorUserId: string,
    name: string,
    sequence: string,
    bytes: Uint8Array,
  ): Promise<CheckpointSummary>;
}
export interface CheckpointPersistence {
  run<T>(work: (scope: CheckpointScope) => Promise<T>): Promise<T>;
  idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    authorize: (scope: CheckpointScope) => Promise<BoardAuthorityState>,
    effect: (scope: CheckpointScope, board: BoardAuthorityState) => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }>;
}

export class CheckpointService {
  public constructor(
    private readonly persistence: CheckpointPersistence,
    private readonly permissions: BoardPermissionService,
    private readonly boards: BoardService,
    private readonly queue: BoardOperationQueue,
    private readonly notify: BoardResourceNotification = async () => undefined,
  ) {}

  public list(
    actor: CheckpointActor,
    boardId: string,
    input: CheckpointListQuery,
  ): Promise<CheckpointListResponse> {
    // Controller supplies the parsed query: limit has already transformed from string to number.
    const query = input;
    return this.persistence.run(async (scope) => {
      await this.authorize(scope, actor, boardId, false);
      const rows = await scope.list(
        boardId,
        query.limit + 1,
        query.cursor ? decodePageCursor(query.cursor) : undefined,
      );
      const data = rows.slice(0, query.limit);
      const last = data.at(-1);
      return {
        data,
        nextCursor:
          rows.length > query.limit && last ? encodePageCursor(last.createdAt, last.id) : null,
      };
    });
  }

  public detail(
    actor: CheckpointActor,
    boardId: string,
    checkpointId: string,
  ): Promise<CheckpointDetail> {
    checkpointPathSchema.parse({ id: boardId, checkpointId });
    return this.persistence.run(async (scope) => {
      await this.authorize(scope, actor, boardId, false);
      const metadata = await this.requireCheckpoint(scope, boardId, checkpointId);
      return { ...metadata, graph: await scope.project(boardId, checkpointId) };
    });
  }

  public async create(
    actor: CheckpointActor,
    boardId: string,
    key: string,
    input: CreateCheckpoint,
  ): Promise<{ checkpoint: CheckpointSummary; replayed: boolean }> {
    const request = createCheckpointSchema.parse(input);
    const result = await this.queue.run(boardId, () =>
      this.persistence.idempotent(
        actor.userId,
        'checkpoint.create',
        key,
        { boardId, ...request },
        async (scope) => {
          // Creator FK insertion and restore share the actor-before-board lock order.
          await scope.boards.lockOwnerAndCount(actor.userId);
          return this.authorize(scope, actor, boardId, true);
        },
        async (scope, board) => {
          if (board.latestSeq !== request.expectedSeq)
            throw new BoardServiceError(
              ERROR_CODES.VERSION_CONFLICT,
              'Committed board sequence changed. Refresh and submit a new capture request.',
            );
          if ((await scope.count(boardId)) >= MAX_CHECKPOINTS_PER_BOARD)
            throw new BoardServiceError(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Checkpoint limit reached.');
          const bytes = await scope.capture(boardId, board.latestSeq);
          await actor.requireCurrentSession();
          const metadata = await scope.insert(
            boardId,
            actor.userId,
            request.name,
            board.latestSeq,
            bytes,
          );
          if (metadata.schemaVersion !== GRAPH_SCHEMA_VERSION)
            throw new BoardServiceError(
              ERROR_CODES.DOCUMENT_INVALID,
              'Checkpoint schema is unavailable.',
            );
          return metadata;
        },
      ),
    );
    // Outside the queue: notification itself re-enters the active room queue.
    if (!result.replayed) {
      try {
        await this.notify(boardId, ['checkpoints']);
      } catch {
        /* Best-effort committed hint. */
      }
    }
    return { checkpoint: result.body, replayed: result.replayed };
  }

  public async restore(
    actor: CheckpointActor,
    boardId: string,
    checkpointId: string,
    key: string,
    input: RestoreCheckpoint,
  ): Promise<{ board: BoardDetail; replayed: boolean }> {
    checkpointPathSchema.parse({ id: boardId, checkpointId });
    const request = restoreCheckpointSchema.parse(input);
    const result = await this.queue.run(boardId, () =>
      this.persistence.idempotent(
        actor.userId,
        'checkpoint.restore',
        key,
        { boardId, checkpointId, ...request },
        async (scope) => {
          // Same owner-before-source-board lock order as import/duplicate/board lifecycle.
          await scope.boards.lockOwnerAndCount(actor.userId);
          const board = await this.authorize(scope, actor, boardId, false);
          await this.requireCheckpoint(scope, boardId, checkpointId);
          return board;
        },
        async (scope) => {
          const graph = await scope.project(boardId, checkpointId);
          const source = await scope.boards.load(boardId, actor.userId);
          await actor.requireCurrentSession();
          return this.boards.initializePrivateBoard(
            scope.boards,
            actor.userId,
            request.title,
            source?.description ?? '',
            createFreshGraphUpdate(graph),
          );
        },
      ),
    );
    return { board: result.body, replayed: result.replayed };
  }

  private async authorize(
    scope: CheckpointScope,
    actor: CheckpointActor,
    boardId: string,
    write: boolean,
  ): Promise<BoardAuthorityState> {
    const decision = write
      ? await this.permissions.editGraph(scope.permissionTransaction, boardId, actor.userId)
      : await this.permissions.readLocked(scope.permissionTransaction, boardId, actor.userId);
    await actor.requireCurrentSession();
    if (!decision.allowed)
      throw new BoardServiceError(decision.code, 'Checkpoints are unavailable for this board.');
    return decision.board;
  }
  private async requireCheckpoint(
    scope: CheckpointScope,
    boardId: string,
    checkpointId: string,
  ): Promise<CheckpointSummary> {
    const checkpoint = await scope.summary(boardId, checkpointId);
    if (!checkpoint) throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Checkpoint not found.');
    return checkpoint;
  }
}
