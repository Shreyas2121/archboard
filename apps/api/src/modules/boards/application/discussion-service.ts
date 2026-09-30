import {
  ERROR_CODES,
  MAX_COMMENTS_PER_THREAD,
  MAX_THREADS_PER_BOARD,
  decodePageCursor,
  encodePageCursor,
  type Comment,
  type CommentListQuery,
  type CommentListResponse,
  type CreateComment,
  type CreateThread,
  type ThreadAnchor,
  type ThreadCreateResult,
  type ThreadListQuery,
  type ThreadListResponse,
  type ThreadSummary,
} from '@archboard/contracts';

import type {
  BoardAuthorityState,
  BoardPermissionService,
  BoardPermissionTransaction,
} from './permissions/index.js';
import { BoardServiceError } from './board-service.js';

export interface DiscussionCursor {
  readonly timestamp: string;
  readonly id: string;
}

export interface DiscussionActor {
  readonly userId: string;
  readonly requireCurrentSession: () => Promise<void>;
}

export interface DiscussionScope {
  readonly permissionTransaction: BoardPermissionTransaction;
  threadExists(boardId: string, threadId: string): Promise<boolean>;
  countThreads(boardId: string): Promise<number>;
  countComments(threadId: string): Promise<number>;
  resolveAnchor(boardId: string, latestSeq: string, anchor: ThreadAnchor): Promise<ThreadAnchor>;
  insertThread(boardId: string, actorUserId: string, anchor: ThreadAnchor): Promise<string>;
  insertComment(threadId: string, actorUserId: string, body: string): Promise<Comment>;
  summary(boardId: string, threadId: string): Promise<ThreadSummary>;
  listThreads(
    boardId: string,
    limit: number,
    resolved?: boolean,
    cursor?: DiscussionCursor,
  ): Promise<ThreadSummary[]>;
  listComments(
    boardId: string,
    threadId: string,
    limit: number,
    cursor?: DiscussionCursor,
  ): Promise<Comment[]>;
}

export interface DiscussionPersistence {
  run<T>(work: (scope: DiscussionScope) => Promise<T>): Promise<T>;
  idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    authorize: (scope: DiscussionScope) => Promise<BoardAuthorityState>,
    effect: (scope: DiscussionScope, board: BoardAuthorityState) => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }>;
}

export class DiscussionService {
  public constructor(
    private readonly persistence: DiscussionPersistence,
    private readonly permissions: BoardPermissionService,
  ) {}

  public listThreads(
    actor: DiscussionActor,
    boardId: string,
    query: ThreadListQuery,
  ): Promise<ThreadListResponse> {
    return this.persistence.run(async (scope) => {
      await this.authorize(scope, actor, boardId, false);
      const rows = await scope.listThreads(
        boardId,
        query.limit + 1,
        query.resolved,
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

  public listComments(
    actor: DiscussionActor,
    boardId: string,
    threadId: string,
    query: CommentListQuery,
  ): Promise<CommentListResponse> {
    return this.persistence.run(async (scope) => {
      await this.authorize(scope, actor, boardId, false);
      await this.requireThread(scope, boardId, threadId);
      const rows = await scope.listComments(
        boardId,
        threadId,
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

  public async createThread(
    actor: DiscussionActor,
    boardId: string,
    key: string,
    request: CreateThread,
  ): Promise<{ body: ThreadCreateResult; replayed: boolean }> {
    return this.persistence.idempotent(
      actor.userId,
      `discussion.thread.create:${boardId}`,
      key,
      request,
      (scope) => this.authorize(scope, actor, boardId, true),
      async (scope, board) => {
        if ((await scope.countThreads(boardId)) >= MAX_THREADS_PER_BOARD)
          this.limitReached('Thread limit reached for this board.');
        const anchor = await scope.resolveAnchor(boardId, board.latestSeq, request.anchor);
        await actor.requireCurrentSession();
        const threadId = await scope.insertThread(boardId, actor.userId, anchor);
        const comment = await scope.insertComment(threadId, actor.userId, request.body);
        const thread = await scope.summary(boardId, threadId);
        return { thread, comment };
      },
    );
  }

  public async createComment(
    actor: DiscussionActor,
    boardId: string,
    threadId: string,
    key: string,
    request: CreateComment,
  ): Promise<{ body: Comment; replayed: boolean }> {
    return this.persistence.idempotent(
      actor.userId,
      `discussion.comment.create:${boardId}:${threadId}`,
      key,
      request,
      async (scope) => {
        const board = await this.authorize(scope, actor, boardId, true);
        await this.requireThread(scope, boardId, threadId);
        return board;
      },
      async (scope) => {
        if ((await scope.countComments(threadId)) >= MAX_COMMENTS_PER_THREAD)
          this.limitReached('Message limit reached for this thread.');
        await actor.requireCurrentSession();
        return scope.insertComment(threadId, actor.userId, request.body);
      },
    );
  }

  private async authorize(
    scope: DiscussionScope,
    actor: DiscussionActor,
    boardId: string,
    write: boolean,
  ): Promise<BoardAuthorityState> {
    const decision = write
      ? await this.permissions.editDiscussion(scope.permissionTransaction, boardId, actor.userId)
      : await this.permissions.readLocked(scope.permissionTransaction, boardId, actor.userId);
    await actor.requireCurrentSession();
    if (!decision.allowed)
      throw new BoardServiceError(decision.code, 'Discussion is unavailable for this board.');
    return decision.board;
  }

  private async requireThread(
    scope: DiscussionScope,
    boardId: string,
    threadId: string,
  ): Promise<void> {
    if (!(await scope.threadExists(boardId, threadId)))
      throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Discussion thread unavailable.');
  }

  private limitReached(message: string): never {
    throw new BoardServiceError(ERROR_CODES.PAYLOAD_TOO_LARGE, message);
  }
}
