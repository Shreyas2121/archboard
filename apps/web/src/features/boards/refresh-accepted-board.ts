import type { QueryClient } from '@tanstack/react-query';
import type { BoardListResponse } from '@archboard/contracts';
import {
  BoardResourceRefresh,
  boardResourceQueryKey,
  boardListQueryKey,
  type BoardQueryScope,
} from './board-resource-refresh';
import { listBoards, readBoard } from './board-api';
import { readInBoardScope } from './board-request-lifecycle';

export async function refreshAcceptedBoard(
  client: QueryClient,
  scope: BoardQueryScope,
  signal: AbortSignal,
  current: () => boolean,
) {
  const assertCurrent = () => {
    if (signal.aborted || !current()) throw new Error('The account session changed.');
  };
  assertCurrent();
  const refresh = new BoardResourceRefresh(client, scope);
  refresh.inviteAccepted();
  await refresh.whenIdle();
  assertCurrent();
  const board = await client.fetchQuery({
    queryKey: boardResourceQueryKey(scope, 'metadata'),
    staleTime: 0,
    queryFn: ({ signal: querySignal }) => {
      const combined = AbortSignal.any([signal, querySignal]);
      return readInBoardScope(combined, current, () => readBoard(scope.boardId, combined));
    },
  });
  assertCurrent();
  if (board.id !== scope.boardId) throw new Error('The board response was invalid.');
  await client.fetchInfiniteQuery({
    queryKey: [
      ...boardListQueryKey(scope.deploymentOrigin, scope.accountId),
      { search: '', archived: false },
    ],
    initialPageParam: null as string | null,
    staleTime: 0,
    queryFn: ({ pageParam, signal: querySignal }) => {
      const combined = AbortSignal.any([signal, querySignal]);
      return readInBoardScope(combined, current, () => listBoards('', false, pageParam, combined));
    },
    getNextPageParam: (page: BoardListResponse) => page.nextCursor,
  });
  assertCurrent();
  return board;
}
