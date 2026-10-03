import { type DataSource, type QueryRunner } from 'typeorm';
import { HttpStatus } from '@nestjs/common';

import {
  CommittedAnchorError,
  type CommittedAnchorReader,
} from '../../collaboration/application/index.js';
import type { DiscussionPersistence, DiscussionScope } from '../application/discussion-service.js';
import type { BoardAuthorityState } from '../application/permissions/index.js';
import { BoardServiceError } from '../application/board-service.js';
import { BoardTransaction } from './board-transaction.js';
import { IdempotencyService } from './idempotency.js';
import { DiscussionRepository } from './discussion-repository.js';

export class PostgresDiscussionPersistence implements DiscussionPersistence {
  private readonly transactions: BoardTransaction;
  private readonly idempotency: IdempotencyService;

  public constructor(
    dataSource: DataSource,
    private readonly anchors: CommittedAnchorReader,
    admission?: RuntimeAdmission,
  ) {
    this.transactions = new BoardTransaction(dataSource, admission);
    this.idempotency = new IdempotencyService(dataSource, admission);
  }

  public run<T>(work: (scope: DiscussionScope) => Promise<T>): Promise<T> {
    return this.transactions.run((runner) => work(this.scope(runner)));
  }

  public idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    authorize: (scope: DiscussionScope) => Promise<BoardAuthorityState>,
    effect: (scope: DiscussionScope, board: BoardAuthorityState) => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }> {
    let board: BoardAuthorityState | undefined;
    return this.idempotency.execute<T>(
      actorUserId,
      operation,
      key,
      request,
      async (runner) => {
        if (!board) throw new Error('Discussion creation requires locked authority.');
        return { status: HttpStatus.CREATED, body: await effect(this.scope(runner), board) };
      },
      async (runner) => {
        board = await authorize(this.scope(runner));
      },
    );
  }

  private scope(runner: QueryRunner): DiscussionScope {
    const repository = new DiscussionRepository(runner.manager);
    return {
      permissionTransaction: runner,
      threadExists: (boardId, threadId) => repository.threadExists(boardId, threadId),
      countThreads: (boardId) => repository.countThreads(boardId),
      countComments: (threadId) => repository.countComments(threadId),
      resolveAnchor: async (boardId, latestSeq, anchor) => {
        if (anchor.type === 'point') return anchor;
        try {
          return await this.anchors.resolve(runner, boardId, latestSeq, anchor);
        } catch (error) {
          if (error instanceof CommittedAnchorError)
            throw new BoardServiceError(error.code, error.message);
          throw error;
        }
      },
      insertThread: (boardId, actorUserId, anchor) =>
        repository.insertThread(boardId, actorUserId, anchor),
      insertComment: (threadId, actorUserId, body) =>
        repository.insertComment(threadId, actorUserId, body),
      summary: (boardId, threadId) => repository.summary(boardId, threadId),
      comment: (boardId, commentId) => repository.comment(boardId, commentId),
      editComment: (commentId, expectedVersion, body) =>
        repository.editComment(commentId, expectedVersion, body),
      deleteComment: (commentId, expectedVersion) =>
        repository.deleteComment(commentId, expectedVersion),
      resolveThread: (boardId, threadId, actorUserId, request) =>
        repository.resolveThread(boardId, threadId, actorUserId, request),
      listThreads: (boardId, limit, resolved, cursor) =>
        repository.listThreads(boardId, limit, resolved, cursor),
      listComments: (boardId, threadId, limit, cursor) =>
        repository.listComments(boardId, threadId, limit, cursor),
    };
  }
}
import type { RuntimeAdmission } from '../../../platform/lifecycle/runtime-admission.js';
