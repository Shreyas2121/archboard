import { z } from 'zod';
import {
  boardInviteListResponseSchema,
  boardInviteResponseSchema,
  createInviteSchema,
  inviteListQuerySchema,
  type CreateInvite,
} from '@archboard/contracts';
import { apiRequest } from '@/platform/api';

export async function readInvites(boardId: string, cursor: string | null, signal: AbortSignal) {
  const query = inviteListQuerySchema.parse(cursor === null ? {} : { cursor });
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) params.set('cursor', query.cursor);
  return apiRequest(`/boards/${boardId}/invites?${params}`, boardInviteListResponseSchema, {
    signal,
  });
}

export async function createInvite(
  boardId: string,
  input: CreateInvite,
  key: string,
  signal: AbortSignal,
) {
  const response = await apiRequest(`/boards/${boardId}/invites`, boardInviteResponseSchema, {
    method: 'POST',
    body: createInviteSchema.parse(input),
    headers: { 'Idempotency-Key': key },
    signal,
  });
  return response.data;
}

export async function revokeInvite(boardId: string, inviteId: string, signal: AbortSignal) {
  await apiRequest(`/boards/${boardId}/invites/${encodeURIComponent(inviteId)}`, z.undefined(), {
    method: 'DELETE',
    signal,
  });
}
