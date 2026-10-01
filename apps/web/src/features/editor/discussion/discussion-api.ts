import {
  threadListQuerySchema,
  commentListQuerySchema,
  threadListResponseSchema,
  commentListResponseSchema,
  createThreadSchema,
  createCommentSchema,
  threadCreateResponseSchema,
  commentResponseSchema,
} from '@archboard/contracts';
import { apiRequest } from '@/platform/api';
import type { DiscussionRequest } from './discussion-model';

export async function readThreads(
  boardId: string,
  resolved: boolean,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = threadListQuerySchema.parse({
    resolved: String(resolved),
    ...(cursor ? { cursor } : {}),
  });
  const params = new URLSearchParams({
    limit: String(query.limit),
    resolved: String(query.resolved),
  });
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
