import {
  boardListResponseSchema,
  boardDetailResponseSchema,
  createBoardSchema,
  duplicateBoardSchema,
  patchBoardSchema,
  boardVersionRequestSchema,
  type BoardSummary,
  type BoardListResponse,
} from '@archboard/contracts';

import { apiRequest } from '@/platform/api';

export const BOARD_QUERY_KEY = ['boards'] as const;
export const BOARD_SEARCH_DELAY_MS = 300;
export const DEFAULT_NEW_BOARD_TITLE = 'Untitled architecture';

export type BoardAction = 'create' | 'edit' | 'archive' | 'restore' | 'duplicate';

export function listBoards(
  search: string,
  archived: boolean,
  cursor: string | null,
  signal: AbortSignal,
): Promise<BoardListResponse> {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (archived) query.set('archived', 'true');
  if (cursor) query.set('cursor', cursor);
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiRequest(`/boards${suffix}`, boardListResponseSchema, { signal });
}

export async function readBoard(id: string): Promise<BoardSummary> {
  const response = await apiRequest(`/boards/${id}`, boardDetailResponseSchema);
  return response.data;
}

export async function submitBoardAction(
  action: BoardAction,
  board: BoardSummary | null,
  title: string,
  description: string,
  idempotencyKey: string,
): Promise<BoardSummary> {
  if (action === 'create') {
    const body = createBoardSchema.parse({
      title: title.trim() || DEFAULT_NEW_BOARD_TITLE,
      description,
    });
    const response = await apiRequest('/boards', boardDetailResponseSchema, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return response.data;
  }
  if (!board) throw new Error('The selected board is unavailable.');
  const path = `/boards/${board.id}` as const;
  if (action === 'duplicate') {
    const body = duplicateBoardSchema.parse({ title });
    const response = await apiRequest(`${path}/duplicate`, boardDetailResponseSchema, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return response.data;
  }
  if (action === 'edit') {
    const body = patchBoardSchema.parse({
      title,
      description,
      expectedVersion: board.metadataVersion,
    });
    const response = await apiRequest(path, boardDetailResponseSchema, { method: 'PATCH', body });
    return response.data;
  }
  const body = boardVersionRequestSchema.parse({ expectedVersion: board.metadataVersion });
  const response = await apiRequest(`${path}/${action}`, boardDetailResponseSchema, {
    method: 'POST',
    body,
  });
  return response.data;
}
