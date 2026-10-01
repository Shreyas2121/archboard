import { z } from 'zod';
import {
  boardMembersResponseSchema,
  boardMemberResponseSchema,
  changeMemberRoleSchema,
  type BoardMember,
  type ChangeMemberRole,
} from '@archboard/contracts';
import { apiRequest } from '@/platform/api';

export async function readMembers(boardId: string, signal: AbortSignal): Promise<BoardMember[]> {
  const response = await apiRequest(`/boards/${boardId}/members`, boardMembersResponseSchema, {
    signal,
  });
  return response.data;
}

export async function changeMemberRole(
  boardId: string,
  userId: string,
  role: ChangeMemberRole['role'],
  signal: AbortSignal,
): Promise<void> {
  await apiRequest(
    `/boards/${boardId}/members/${encodeURIComponent(userId)}`,
    boardMemberResponseSchema,
    {
      method: 'PATCH',
      body: changeMemberRoleSchema.parse({ role }),
      signal,
    },
  );
}

export async function removeMember(
  boardId: string,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  await apiRequest(`/boards/${boardId}/members/${encodeURIComponent(userId)}`, z.undefined(), {
    method: 'DELETE',
    signal,
  });
}
