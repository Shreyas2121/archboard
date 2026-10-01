import {
  COMMENT_DELETION_MARKER,
  applicationIdSchema,
  commentSchema,
  threadSummarySchema,
  type Comment,
  type ThreadAnchor,
  type ThreadSummary,
  type ResolveThread,
} from '@archboard/contracts';
import type { EntityManager } from 'typeorm';

import type { DiscussionCursor } from '../application/discussion-service.js';
import { CommentEntity } from './entities/comment.entity.js';
import { CommentThreadEntity } from './entities/comment-thread.entity.js';

function timestamp(column: string): string {
  // Only trusted column expressions reach this helper; keep PostgreSQL microseconds in cursors.
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

interface CommentRow {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  body: string;
  version: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

interface ThreadRow {
  id: string;
  boardId: string;
  anchor: unknown;
  version: number;
  createdAt: string;
  creatorId: string;
  creatorName: string;
  creatorImage: string | null;
  resolvedAt: string | null;
  resolverId: string | null;
  resolverName: string | null;
  resolverImage: string | null;
  messageCount: number;
  latestId: string;
  latestAuthorId: string;
  latestAuthorName: string;
  latestAuthorImage: string | null;
  latestBody: string;
  latestCreatedAt: string;
  latestDeletedAt: string | null;
}

export class DiscussionRepository {
  public constructor(private readonly manager: EntityManager) {}

  public threadExists(boardId: string, threadId: string): Promise<boolean> {
    return this.manager.getRepository(CommentThreadEntity).existsBy({ boardId, id: threadId });
  }

  public countThreads(boardId: string): Promise<number> {
    return this.manager.getRepository(CommentThreadEntity).countBy({ boardId });
  }

  public countComments(threadId: string): Promise<number> {
    return this.manager.getRepository(CommentEntity).countBy({ threadId });
  }

  public async insertThread(
    boardId: string,
    actorUserId: string,
    anchor: ThreadAnchor,
  ): Promise<string> {
    const result = await this.manager
      .getRepository(CommentThreadEntity)
      .createQueryBuilder()
      .insert()
      .values({ boardId, createdBy: actorUserId, anchor, createdAt: () => 'CURRENT_TIMESTAMP' })
      .returning(['id'])
      .execute();
    return applicationIdSchema.parse(result.identifiers[0]?.id);
  }

  public async insertComment(
    threadId: string,
    actorUserId: string,
    body: string,
  ): Promise<Comment> {
    const result = await this.manager
      .getRepository(CommentEntity)
      .createQueryBuilder()
      .insert()
      .values({ threadId, authorUserId: actorUserId, body, createdAt: () => 'CURRENT_TIMESTAMP' })
      .returning(['id'])
      .execute();
    const id = applicationIdSchema.parse(result.identifiers[0]?.id);
    const row = await this.commentQuery().where('comment.id = :id', { id }).getRawOne<CommentRow>();
    if (!row) throw new Error('The inserted message is unavailable.');
    return this.toComment(row);
  }

  public async comment(boardId: string, commentId: string): Promise<Comment | null> {
    const row = await this.commentQuery()
      .innerJoin(CommentThreadEntity, 'thread', 'thread.id = comment.thread_id')
      .where('thread.board_id = :boardId AND comment.id = :commentId', { boardId, commentId })
      .getRawOne<CommentRow>();
    return row ? this.toComment(row) : null;
  }

  // The caller holds the board authority lock and has resolved the message through that board.
  public async editComment(
    commentId: string,
    expectedVersion: number,
    body: string,
  ): Promise<boolean> {
    const result = await this.manager
      .getRepository(CommentEntity)
      .createQueryBuilder()
      .update()
      .set({ body, version: () => 'version + 1', editedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :commentId AND version = :expectedVersion AND deleted_at IS NULL', {
        commentId,
        expectedVersion,
      })
      .execute();
    return result.affected === 1;
  }

  public async deleteComment(commentId: string, expectedVersion: number): Promise<boolean> {
    const result = await this.manager
      .getRepository(CommentEntity)
      .createQueryBuilder()
      .update()
      .set({
        body: COMMENT_DELETION_MARKER,
        version: () => 'version + 1',
        deletedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :commentId AND version = :expectedVersion AND deleted_at IS NULL', {
        commentId,
        expectedVersion,
      })
      .execute();
    return result.affected === 1;
  }

  public async resolveThread(
    boardId: string,
    threadId: string,
    actorUserId: string,
    request: ResolveThread,
  ): Promise<boolean> {
    const result = await this.manager
      .getRepository(CommentThreadEntity)
      .createQueryBuilder()
      .update()
      .set({
        version: () => 'version + 1',
        resolvedAt: request.resolved ? () => 'CURRENT_TIMESTAMP' : null,
        resolvedBy: request.resolved ? actorUserId : null,
      })
      .where('id = :threadId AND board_id = :boardId AND version = :expectedVersion', {
        threadId,
        boardId,
        expectedVersion: request.expectedVersion,
      })
      .execute();
    return result.affected === 1;
  }

  public async summary(boardId: string, threadId: string): Promise<ThreadSummary> {
    const row = await this.threadQuery(boardId)
      .andWhere('thread.id = :threadId', { threadId })
      .getRawOne<ThreadRow>();
    if (!row) throw new Error('The created thread is unavailable.');
    return this.toThreadSummary(row);
  }

  public async listThreads(
    boardId: string,
    limit: number,
    resolved?: boolean,
    cursor?: DiscussionCursor,
  ): Promise<ThreadSummary[]> {
    const query = this.threadQuery(boardId)
      .orderBy('thread.created_at', 'DESC')
      .addOrderBy('thread.id', 'DESC')
      .limit(limit);
    if (resolved !== undefined)
      query.andWhere(resolved ? 'thread.resolved_at IS NOT NULL' : 'thread.resolved_at IS NULL');
    if (cursor)
      query.andWhere(
        '(thread.created_at, thread.id) < (CAST(:timestamp AS timestamptz), CAST(:cursorId AS uuid))',
        { timestamp: cursor.timestamp, cursorId: cursor.id },
      );
    return (await query.getRawMany<ThreadRow>()).map((row) => this.toThreadSummary(row));
  }

  public async listComments(
    boardId: string,
    threadId: string,
    limit: number,
    cursor?: DiscussionCursor,
  ): Promise<Comment[]> {
    const query = this.commentQuery()
      .innerJoin(CommentThreadEntity, 'thread', 'thread.id = comment.thread_id')
      .where('thread.board_id = :boardId AND thread.id = :threadId', { boardId, threadId })
      .orderBy('comment.created_at', 'ASC')
      .addOrderBy('comment.id', 'ASC')
      .limit(limit);
    if (cursor)
      query.andWhere(
        '(comment.created_at, comment.id) > (CAST(:timestamp AS timestamptz), CAST(:cursorId AS uuid))',
        { timestamp: cursor.timestamp, cursorId: cursor.id },
      );
    return (await query.getRawMany<CommentRow>()).map((row) => this.toComment(row));
  }

  private commentQuery() {
    return (
      this.manager
        .getRepository(CommentEntity)
        .createQueryBuilder('comment')
        .innerJoin('user', 'author', 'author.id = comment.author_user_id')
        .select('comment.id', 'id')
        .addSelect('comment.thread_id', 'threadId')
        .addSelect('author.id', 'authorId')
        .addSelect('author.name', 'authorName')
        .addSelect('author.image', 'authorImage')
        // Sanitize markers at the read boundary even if an older stored row retained its old body.
        .addSelect(
          'CASE WHEN comment.deleted_at IS NULL THEN comment.body ELSE :marker END',
          'body',
        )
        .addSelect('comment.version', 'version')
        .addSelect(timestamp('comment.created_at'), 'createdAt')
        .addSelect(timestamp('comment.edited_at'), 'editedAt')
        .addSelect(timestamp('comment.deleted_at'), 'deletedAt')
        .setParameter('marker', COMMENT_DELETION_MARKER)
    );
  }

  private threadQuery(boardId: string) {
    const latestId = this.manager
      .createQueryBuilder()
      .subQuery()
      .select('message.id')
      .from(CommentEntity, 'message')
      .where('message.thread_id = thread.id')
      .orderBy('message.created_at', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .limit(1)
      .getQuery();
    return this.manager
      .getRepository(CommentThreadEntity)
      .createQueryBuilder('thread')
      .innerJoin('user', 'creator', 'creator.id = thread.created_by')
      .leftJoin('user', 'resolver', 'resolver.id = thread.resolved_by')
      .innerJoin(CommentEntity, 'latest', `latest.id = ${latestId}`)
      .innerJoin('user', 'author', 'author.id = latest.author_user_id')
      .select('thread.id', 'id')
      .addSelect('thread.board_id', 'boardId')
      .addSelect('thread.anchor', 'anchor')
      .addSelect('thread.version', 'version')
      .addSelect(timestamp('thread.created_at'), 'createdAt')
      .addSelect('creator.id', 'creatorId')
      .addSelect('creator.name', 'creatorName')
      .addSelect('creator.image', 'creatorImage')
      .addSelect(timestamp('thread.resolved_at'), 'resolvedAt')
      .addSelect('resolver.id', 'resolverId')
      .addSelect('resolver.name', 'resolverName')
      .addSelect('resolver.image', 'resolverImage')
      .addSelect(
        (query) =>
          query
            .select('COUNT(*)::integer')
            .from(CommentEntity, 'counted')
            .where('counted.thread_id = thread.id'),
        'messageCount',
      )
      .addSelect('latest.id', 'latestId')
      .addSelect('author.id', 'latestAuthorId')
      .addSelect('author.name', 'latestAuthorName')
      .addSelect('author.image', 'latestAuthorImage')
      .addSelect(
        'CASE WHEN latest.deleted_at IS NULL THEN latest.body ELSE :marker END',
        'latestBody',
      )
      .addSelect(timestamp('latest.created_at'), 'latestCreatedAt')
      .addSelect(timestamp('latest.deleted_at'), 'latestDeletedAt')
      .where('thread.board_id = :boardId', { boardId })
      .setParameter('marker', COMMENT_DELETION_MARKER);
  }

  private toComment(row: CommentRow): Comment {
    return commentSchema.parse({
      id: row.id,
      threadId: row.threadId,
      author: { id: row.authorId, name: row.authorName, image: row.authorImage },
      body: row.body,
      version: row.version,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
    });
  }

  private toThreadSummary(row: ThreadRow): ThreadSummary {
    return threadSummarySchema.parse({
      id: row.id,
      boardId: row.boardId,
      anchor: row.anchor,
      version: row.version,
      createdAt: row.createdAt,
      createdBy: { id: row.creatorId, name: row.creatorName, image: row.creatorImage },
      resolvedAt: row.resolvedAt,
      resolvedBy:
        row.resolverId === null
          ? null
          : { id: row.resolverId, name: row.resolverName, image: row.resolverImage },
      messageCount: row.messageCount,
      latestMessage: {
        id: row.latestId,
        author: {
          id: row.latestAuthorId,
          name: row.latestAuthorName,
          image: row.latestAuthorImage,
        },
        body: row.latestBody,
        createdAt: row.latestCreatedAt,
        deletedAt: row.latestDeletedAt,
      },
    });
  }
}
