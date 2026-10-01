import {
  threadListQuerySchema,
  commentListQuerySchema,
  threadListResponseSchema,
  commentListResponseSchema,
  createThreadSchema,
  createCommentSchema,
  threadCreateResponseSchema,
  commentResponseSchema,
  editCommentSchema,
  deleteCommentSchema,
  resolveThreadSchema,
  threadResponseSchema,
  type Comment,
} from '@archboard/contracts';
import { apiRequest } from '@/platform/api';
import { anchorDraftKey, type DiscussionRequest } from './discussion-model';
import type { DiscussionTarget, ModerationAction } from './discussion-moderation-state';

export async function readThreads(
  boardId: string,
  resolved: boolean | undefined,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = threadListQuerySchema.parse({
    ...(resolved === undefined ? {} : { resolved: String(resolved) }),
    ...(cursor ? { cursor } : {}),
  });
  const params = new URLSearchParams({
    limit: String(query.limit),
  });
  if (query.resolved !== undefined) params.set('resolved', String(query.resolved));
  if (query.cursor) params.set('cursor', query.cursor);
  const result = await apiRequest(
    `/boards/${boardId}/threads?${params}`,
    threadListResponseSchema,
    { signal },
  );
  if (result.data.some((thread) => thread.boardId !== boardId))
    throw new Error('The API returned discussion for a different board.');
  return result;
}

export async function mutateDiscussion(
  boardId: string,
  action: ModerationAction,
  signal: AbortSignal,
): Promise<DiscussionTarget> {
  if (action.kind === 'resolve') {
    const result = await apiRequest(
      `/boards/${boardId}/threads/${action.resource.id}`,
      threadResponseSchema,
      {
        method: 'PATCH',
        signal,
        body: resolveThreadSchema.parse({
          resolved: action.resolved,
          expectedVersion: action.resource.version,
        }),
      },
    );
    if (result.data.id !== action.resource.id || result.data.boardId !== boardId)
      throw new Error('The API returned a different discussion.');
    return { kind: 'thread', value: result.data };
  }
  const result = await apiRequest(
    `/boards/${boardId}/comments/${action.resource.id}`,
    commentResponseSchema,
    {
      method: action.kind === 'edit' ? 'PATCH' : 'DELETE',
      signal,
      body:
        action.kind === 'edit'
          ? editCommentSchema.parse({ body: action.body, expectedVersion: action.resource.version })
          : deleteCommentSchema.parse({ expectedVersion: action.resource.version }),
    },
  );
  if (
    result.data.id !== action.resource.id ||
    result.data.threadId !== action.resource.threadId ||
    result.data.author.id !== action.resource.author.id
  )
    throw new Error('The API returned a different message or author.');
  return { kind: 'comment', value: result.data };
}

export async function readCurrentTarget(
  boardId: string,
  action: ModerationAction,
  signal: AbortSignal,
): Promise<DiscussionTarget> {
  let cursor: string | null = null;
  do {
    if (signal.aborted) throw new Error('Read cancelled.');
    if (action.kind === 'resolve') {
      const page = await readThreads(boardId, undefined, cursor, signal);
      const row = page.data.find(({ id }) => id === action.resource.id);
      if (row) return { kind: 'thread', value: row };
      cursor = page.nextCursor;
    } else {
      const page = await readComments(boardId, action.resource.threadId, cursor, signal);
      const row = page.data.find(({ id }) => id === action.resource.id);
      if (row) return { kind: 'comment', value: row };
      cursor = page.nextCursor;
    }
  } while (cursor !== null);
  throw new Error('The current resource is unavailable.');
}

export async function inspectCreation(
  boardId: string,
  request: DiscussionRequest,
  accountId: string,
  signal: AbortSignal,
) {
  const matches: Comment[] = [];
  async function inspectThread(threadId: string, firstOnly: boolean) {
    let cursor: string | null = null;
    do {
      if (signal.aborted) throw new Error('Read cancelled.');
      const page = await readComments(boardId, threadId, cursor, signal);
      for (const comment of firstOnly ? page.data.slice(0, 1) : page.data) {
        if (
          comment.author.id === accountId &&
          comment.body === request.operation.input.body &&
          comment.deletedAt === null
        )
          matches.push(comment);
      }
      cursor = firstOnly ? null : page.nextCursor;
    } while (cursor !== null);
  }
  if (request.operation.kind === 'reply') await inspectThread(request.operation.threadId, false);
  else {
    let cursor: string | null = null;
    do {
      if (signal.aborted) throw new Error('Read cancelled.');
      const page = await readThreads(boardId, undefined, cursor, signal);
      for (const thread of page.data) {
        if (anchorDraftKey(thread.anchor) === anchorDraftKey(request.operation.input.anchor))
          await inspectThread(thread.id, true);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return matches;
}

export async function readComments(
  boardId: string,
  threadId: string,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = commentListQuerySchema.parse(cursor ? { cursor } : {});
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) params.set('cursor', query.cursor);
  const result = await apiRequest(
    `/boards/${boardId}/threads/${threadId}/comments?${params}`,
    commentListResponseSchema,
    { signal },
  );
  if (result.data.some((comment) => comment.threadId !== threadId))
    throw new Error('The API returned messages for a different thread.');
  return result;
}

export async function sendDiscussion(
  boardId: string,
  request: DiscussionRequest,
  signal: AbortSignal,
) {
  const options = { method: 'POST' as const, headers: { 'Idempotency-Key': request.key }, signal };
  if (request.operation.kind === 'thread') {
    const result = await apiRequest(`/boards/${boardId}/threads`, threadCreateResponseSchema, {
      ...options,
      body: createThreadSchema.parse(request.operation.input),
    });
    if (result.data.thread.boardId !== boardId)
      throw new Error('The API returned a different board. The send could not be confirmed.');
    return { threadId: result.data.thread.id, comment: result.data.comment };
  }
  const result = await apiRequest(
    `/boards/${boardId}/threads/${request.operation.threadId}/comments`,
    commentResponseSchema,
    { ...options, body: createCommentSchema.parse(request.operation.input) },
  );
  if (result.data.threadId !== request.operation.threadId)
    throw new Error('The API returned a different thread. The send could not be confirmed.');
  return { threadId: request.operation.threadId, comment: result.data };
}
