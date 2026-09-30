import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  COMMENT_DELETION_MARKER,
  commentListQuerySchema,
  commentListResponseSchema,
  commentPathSchema,
  commentSchema,
  countCommentBodyCharacters,
  createCommentSchema,
  createThreadSchema,
  deleteCommentSchema,
  discussionVersionSchema,
  editCommentSchema,
  latestCommentSummarySchema,
  resolveThreadSchema,
  threadAnchorSchema,
  threadCreateResponseSchema,
  threadListQuerySchema,
  threadListResponseSchema,
  threadPathSchema,
  threadSchema,
  threadSummarySchema,
} from './index.js';
import {
  DEFAULT_BOARD_PAGE_SIZE,
  MAX_COMMENT_BODY_CHARACTERS,
  MAX_COMMENTS_PER_THREAD,
  MAX_EDGE_LABEL_CHARACTERS,
  MAX_GRAPH_COORDINATE,
  MAX_NODE_TITLE_CHARACTERS,
  MAX_THREADS_PER_BOARD,
} from '../limits/index.js';
import { decodePageCursor, encodePageCursor } from '../pagination/index.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const expectedBodyLimit = 4_000;
const expectedThreadLimit = 2_000;
const expectedMessageLimit = 500;
const fractionalVersion = 1.5;
const oversizedCursorLength = 257;
const otherId = '123e4567-e89b-42d3-a456-426614174001';
const createdAt = '2026-09-30T10:00:00.000Z';
const user = { id: 'opaque-better-auth-id', name: 'Synthetic', image: null };
const position = { x: -MAX_GRAPH_COORDINATE, y: MAX_GRAPH_COORDINATE };
const anchor = { type: 'node', id, label: '', position };
const comment = {
  id: otherId,
  threadId: id,
  author: user,
  body: '  Synthetic\nmessage  ',
  version: 1,
  createdAt,
  editedAt: null,
  deletedAt: null,
};
const latestMessage = {
  id: comment.id,
  author: user,
  body: comment.body,
  createdAt,
  deletedAt: null,
};
const thread = {
  id,
  boardId: otherId,
  anchor,
  resolvedAt: null,
  resolvedBy: null,
  version: 1,
  createdBy: user,
  createdAt,
};
const summary = { ...thread, messageCount: 1, latestMessage };

describe('Phase 6 discussion wire contracts', () => {
  it('preserves nonblank formatting and uses one Unicode code point rule for counters and limits', () => {
    expect(createCommentSchema.parse({ body: comment.body }).body).toBe(comment.body);
    expect(MAX_COMMENT_BODY_CHARACTERS).toBe(expectedBodyLimit);
    expect(MAX_THREADS_PER_BOARD).toBe(expectedThreadLimit);
    expect(MAX_COMMENTS_PER_THREAD).toBe(expectedMessageLimit);
    const limitBody = '😀'.repeat(MAX_COMMENT_BODY_CHARACTERS);
    expect(countCommentBodyCharacters(limitBody)).toBe(MAX_COMMENT_BODY_CHARACTERS);
    expect(createCommentSchema.safeParse({ body: limitBody }).success).toBe(true);
    for (const body of ['', ' \t\r\n', '\u00a0\u2003', limitBody + 'a', 1, null]) {
      expect(createCommentSchema.safeParse({ body }).success).toBe(false);
    }
  });

  it.each(['node', 'edge', 'point'])('accepts the strict %s anchor variant', (type) => {
    const value = type === 'point' ? { type, position } : { ...anchor, type };
    expect(threadAnchorSchema.parse(value)).toEqual(value);
    expect(createThreadSchema.safeParse({ anchor: value, body: comment.body }).success).toBe(true);
  });

  it.each([
    { ...anchor, type: 'boundary' },
    { ...anchor, id: 'not-a-uuid' },
    { ...anchor, label: 'x'.repeat(MAX_NODE_TITLE_CHARACTERS + 1) },
    { ...anchor, type: 'edge', label: 'x'.repeat(MAX_EDGE_LABEL_CHARACTERS + 1) },
    { type: 'node', id, position },
    { type: 'node', label: '', position },
    { ...anchor, position: undefined },
    { ...anchor, position: { x: Infinity, y: 0 } },
    { ...anchor, position: { x: NaN, y: 0 } },
    { ...anchor, position: { x: MAX_GRAPH_COORDINATE + 1, y: 0 } },
    { ...anchor, position: { x: 0, y: -MAX_GRAPH_COORDINATE - 1 } },
    { ...anchor, position: { x: '1', y: 0 } },
    { ...anchor, position: { x: 0, y: 0, z: 0 } },
    { ...anchor, boardId: otherId },
    { type: 'point', position, id },
    { type: 'point', position, label: '' },
  ])('rejects malformed or extended anchor %#', (value) => {
    expect(threadAnchorSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    'author',
    'authorUserId',
    'createdBy',
    'createdAt',
    'editedAt',
    'deletedAt',
    'version',
    'boardId',
  ])('rejects forged %s in creation and mutation bodies', (field) => {
    expect(createThreadSchema.safeParse({ anchor, body: 'a', [field]: user.id }).success).toBe(
      false,
    );
    expect(createCommentSchema.safeParse({ body: 'a', [field]: user.id }).success).toBe(false);
    expect(
      editCommentSchema.safeParse({ body: 'a', expectedVersion: 1, [field]: user.id }).success,
    ).toBe(false);
    expect(deleteCommentSchema.safeParse({ expectedVersion: 1, [field]: user.id }).success).toBe(
      false,
    );
    expect(
      resolveThreadSchema.safeParse({ resolved: true, expectedVersion: 1, [field]: user.id })
        .success,
    ).toBe(false);
  });

  it('requires positive integer versions and literal boolean resolution on mutations', () => {
    for (const expectedVersion of [
      undefined,
      null,
      0,
      -1,
      fractionalVersion,
      '1',
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(discussionVersionSchema.safeParse(expectedVersion).success).toBe(false);
      expect(editCommentSchema.safeParse({ body: 'a', expectedVersion }).success).toBe(false);
      expect(deleteCommentSchema.safeParse({ expectedVersion }).success).toBe(false);
      expect(resolveThreadSchema.safeParse({ resolved: true, expectedVersion }).success).toBe(
        false,
      );
    }
    expect(editCommentSchema.parse({ body: comment.body, expectedVersion: 2 }).body).toBe(
      comment.body,
    );
    expect(deleteCommentSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(resolveThreadSchema.parse({ resolved: false, expectedVersion: 2 }).resolved).toBe(false);
    for (const resolved of [undefined, null, 'false', 0]) {
      expect(resolveThreadSchema.safeParse({ resolved, expectedVersion: 1 }).success).toBe(false);
    }
    expect(editCommentSchema.safeParse({ body: ' ', expectedVersion: 1 }).success).toBe(false);
  });

  it('reuses stable timestamp/UUID cursors and strict bounded pagination/filter forms', () => {
    const cursor = encodePageCursor(createdAt, id);
    expect(decodePageCursor(cursor)).toEqual({ timestamp: createdAt, id });
    expect(threadListQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(threadListQuerySchema.parse({ cursor, limit: '100', resolved: 'false' })).toEqual({
      cursor,
      limit: 100,
      resolved: false,
    });
    expect(threadListQuerySchema.parse({ resolved: 'true' }).resolved).toBe(true);
    for (const limit of ['0', '101', '-1', '1.5', '01', '', ' 30', DEFAULT_BOARD_PAGE_SIZE, null]) {
      expect(commentListQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    for (const resolved of [true, false, 'all', '', '0', null]) {
      expect(threadListQuerySchema.safeParse({ resolved }).success).toBe(false);
    }
    for (const cursor of ['', 'garbage', 'a'.repeat(oversizedCursorLength), 'YQ==', null, 1]) {
      expect(threadListQuerySchema.safeParse({ cursor }).success).toBe(false);
    }
    expect(commentListQuerySchema.safeParse({ resolved: 'true' }).success).toBe(false);
    expect(threadListQuerySchema.safeParse({ authorUserId: user.id }).success).toBe(false);
    expect(threadPathSchema.parse({ id, threadId: otherId })).toEqual({ id, threadId: otherId });
    expect(commentPathSchema.safeParse({ id, commentId: 'invalid' }).success).toBe(false);
    expect(threadPathSchema.safeParse({ id: 'invalid', threadId: id }).success).toBe(false);
    expect(threadPathSchema.safeParse({ id, threadId: id, userId: user.id }).success).toBe(false);
  });

  it('validates plain-text records, mapped auth IDs, resolution pairs, and UTC timestamps', () => {
    expect(commentSchema.parse(comment)).toEqual(comment);
    expect(threadSchema.parse(thread)).toEqual(thread);
    expect(
      threadSchema.safeParse({ ...thread, resolvedAt: createdAt, resolvedBy: user }).success,
    ).toBe(true);
    expect(threadSchema.safeParse({ ...thread, resolvedAt: createdAt }).success).toBe(false);
    expect(threadSchema.safeParse({ ...thread, resolvedBy: user }).success).toBe(false);
    expect(
      commentSchema.safeParse({ ...comment, createdAt: '2026-09-30T10:00:00+05:30' }).success,
    ).toBe(false);
    expect(commentSchema.safeParse({ ...comment, author: { ...user, id: '' } }).success).toBe(
      false,
    );
    expect(commentSchema.safeParse({ ...comment, actor: user }).success).toBe(false);
    expect(
      commentSchema.parse({ ...comment, body: '<script>inert plain text</script>' }).body,
    ).toContain('<script>');
  });

  it('permits deletion markers while rejecting old content in full and latest-message views', () => {
    const marker = {
      ...comment,
      body: COMMENT_DELETION_MARKER,
      deletedAt: createdAt,
      editedAt: createdAt,
      version: 2,
    };
    expect(commentSchema.parse(marker)).toEqual(marker);
    expect(commentSchema.safeParse({ ...comment, deletedAt: createdAt }).success).toBe(false);
    expect(
      latestCommentSummarySchema.safeParse({ ...latestMessage, deletedAt: createdAt }).success,
    ).toBe(false);
    expect(
      latestCommentSummarySchema.safeParse({
        ...latestMessage,
        body: COMMENT_DELETION_MARKER,
        deletedAt: createdAt,
      }).success,
    ).toBe(true);
    // A live author may type the marker text: deletedAt is the authoritative deletion state.
    expect(commentSchema.safeParse({ ...comment, body: COMMENT_DELETION_MARKER }).success).toBe(
      true,
    );
  });

  it('enforces nonempty bounded summaries, atomic-create association, and safe envelopes', () => {
    expect(threadSummarySchema.parse(summary)).toEqual(summary);
    for (const messageCount of [0, MAX_COMMENTS_PER_THREAD + 1, fractionalVersion]) {
      expect(threadSummarySchema.safeParse({ ...summary, messageCount }).success).toBe(false);
    }
    expect(
      threadCreateResponseSchema.safeParse({ data: { thread: summary, comment } }).success,
    ).toBe(true);
    expect(
      threadCreateResponseSchema.safeParse({
        data: { thread: summary, comment: { ...comment, threadId: otherId } },
      }).success,
    ).toBe(false);
    expect(threadListResponseSchema.parse({ data: [summary], nextCursor: null }).data).toHaveLength(
      1,
    );
    expect(commentListResponseSchema.parse({ data: [], nextCursor: null }).data).toHaveLength(0);
    expect(
      commentListResponseSchema.safeParse({ data: [comment], nextCursor: null, token: 'forged' })
        .success,
    ).toBe(false);
    expect(threadSummarySchema.safeParse({ ...summary, latestMessage: null }).success).toBe(false);
  });

  it('converts planned Swagger bodies and responses without advertising routes', () => {
    for (const schema of [
      createThreadSchema,
      createCommentSchema,
      editCommentSchema,
      deleteCommentSchema,
      resolveThreadSchema,
    ]) {
      expect(z.toJSONSchema(schema, { io: 'input' }).additionalProperties).toBe(false);
    }
    expect(z.toJSONSchema(threadListResponseSchema, { io: 'output' }).type).toBe('object');
    expect(z.toJSONSchema(threadCreateResponseSchema, { io: 'output' }).type).toBe('object');
  });
});
