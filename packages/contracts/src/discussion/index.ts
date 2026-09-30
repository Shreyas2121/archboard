import { z } from 'zod';

import { userSummarySchema } from '../auth/index.js';
import { boardIdPathSchema } from '../boards/index.js';
import { applicationIdSchema, pointSchema } from '../graph/index.js';
import {
  collectionEnvelopeSchema,
  objectEnvelopeSchema,
  utcTimestampSchema,
} from '../http/index.js';
import {
  MAX_COMMENT_BODY_CHARACTERS,
  MAX_COMMENTS_PER_THREAD,
  MAX_EDGE_LABEL_CHARACTERS,
  MAX_NODE_TITLE_CHARACTERS,
} from '../limits/index.js';
import { pageCursorSchema, pageLimitQuerySchema } from '../pagination/index.js';

// Matches Zod 4.6 string.max: Unicode code points, including whitespace (no normalization).
// Forms must use this same counter; validation never trims nonblank submitted text.
export function countCommentBodyCharacters(body: string): number {
  return Array.from(body).length;
}

export const commentBodySchema = z
  .string()
  .max(MAX_COMMENT_BODY_CHARACTERS)
  .refine((body) => body.trim().length > 0, { message: 'Enter a message.' });

export const COMMENT_DELETION_MARKER = 'Message deleted';
export const discussionVersionSchema = z.number().int().min(1);

// Node/edge fallback fields are wire context only. The server replaces them from committed graph.
export const threadAnchorSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('node'),
    id: applicationIdSchema,
    label: z.string().max(MAX_NODE_TITLE_CHARACTERS),
    position: pointSchema,
  }),
  z.strictObject({
    type: z.literal('edge'),
    id: applicationIdSchema,
    label: z.string().max(MAX_EDGE_LABEL_CHARACTERS),
    position: pointSchema,
  }),
  z.strictObject({ type: z.literal('point'), position: pointSchema }),
]);

export const threadPathSchema = boardIdPathSchema.safeExtend({ threadId: applicationIdSchema });
export const commentPathSchema = boardIdPathSchema.safeExtend({ commentId: applicationIdSchema });
export const commentListQuerySchema = z.strictObject({
  cursor: pageCursorSchema.optional(),
  limit: pageLimitQuerySchema,
});
export const threadListQuerySchema = commentListQuerySchema.safeExtend({
  resolved: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const createThreadSchema = z.strictObject({
  anchor: threadAnchorSchema,
  body: commentBodySchema,
});
export const createCommentSchema = z.strictObject({ body: commentBodySchema });
export const editCommentSchema = createCommentSchema.safeExtend({
  expectedVersion: discussionVersionSchema,
});
export const deleteCommentSchema = z.strictObject({ expectedVersion: discussionVersionSchema });
export const resolveThreadSchema = deleteCommentSchema.safeExtend({ resolved: z.boolean() });

const commentRecordSchema = z.strictObject({
  id: applicationIdSchema,
  threadId: applicationIdSchema,
  author: userSummarySchema,
  body: commentBodySchema,
  version: discussionVersionSchema,
  createdAt: utcTimestampSchema,
  editedAt: utcTimestampSchema.nullable(),
  deletedAt: utcTimestampSchema.nullable(),
});

export const commentSchema = commentRecordSchema.refine(
  (comment) => comment.deletedAt === null || comment.body === COMMENT_DELETION_MARKER,
  {
    message: 'Deleted messages expose only the deletion marker.',
    path: ['body'],
  },
);

export const latestCommentSummarySchema = commentRecordSchema
  .pick({
    id: true,
    author: true,
    body: true,
    createdAt: true,
    deletedAt: true,
  })
  .refine((comment) => comment.deletedAt === null || comment.body === COMMENT_DELETION_MARKER, {
    message: 'Deleted summaries expose only the deletion marker.',
    path: ['body'],
  });

export const threadSchema = z
  .strictObject({
    id: applicationIdSchema,
    boardId: applicationIdSchema,
    anchor: threadAnchorSchema,
    resolvedAt: utcTimestampSchema.nullable(),
    resolvedBy: userSummarySchema.nullable(),
    version: discussionVersionSchema,
    createdBy: userSummarySchema,
    createdAt: utcTimestampSchema,
  })
  .refine((thread) => (thread.resolvedAt === null) === (thread.resolvedBy === null), {
    message: 'Resolution time and actor must agree.',
  });

export const threadSummarySchema = threadSchema.safeExtend({
  messageCount: z.number().int().min(1).max(MAX_COMMENTS_PER_THREAD),
  latestMessage: latestCommentSummarySchema,
});
export const threadCreateResultSchema = z
  .strictObject({
    thread: threadSummarySchema,
    comment: commentSchema,
  })
  .refine((result) => result.comment.threadId === result.thread.id, {
    message: 'The first message must belong to the created thread.',
  });

export const threadListResponseSchema = collectionEnvelopeSchema(
  threadSummarySchema,
  pageCursorSchema,
);
export const commentListResponseSchema = collectionEnvelopeSchema(commentSchema, pageCursorSchema);
export const threadResponseSchema = objectEnvelopeSchema(threadSchema);
export const commentResponseSchema = objectEnvelopeSchema(commentSchema);
export const threadCreateResponseSchema = objectEnvelopeSchema(threadCreateResultSchema);

export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;
export type ThreadPath = z.infer<typeof threadPathSchema>;
export type CommentPath = z.infer<typeof commentPathSchema>;
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;
export type CreateThread = z.infer<typeof createThreadSchema>;
export type CreateComment = z.infer<typeof createCommentSchema>;
export type EditComment = z.infer<typeof editCommentSchema>;
export type DeleteComment = z.infer<typeof deleteCommentSchema>;
export type ResolveThread = z.infer<typeof resolveThreadSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type LatestCommentSummary = z.infer<typeof latestCommentSummarySchema>;
export type Thread = z.infer<typeof threadSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadCreateResult = z.infer<typeof threadCreateResultSchema>;
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;
export type CommentListResponse = z.infer<typeof commentListResponseSchema>;
export type ThreadResponse = z.infer<typeof threadResponseSchema>;
export type CommentResponse = z.infer<typeof commentResponseSchema>;
export type ThreadCreateResponse = z.infer<typeof threadCreateResponseSchema>;
