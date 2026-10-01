import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ResourceRefreshEvents } from '@archboard/sync-client';
import { BoardResourceRefresh } from './board-resource-refresh';
import { currentUserQueryOptions } from '@/features/auth/current-user-query';
import { readLocalSignOutPending, readSelectedAccountMarker } from '@archboard/sync-client';
import { installBoardResourceRecovery } from './board-resource-recovery';

export function useBoardResourceRefresh(
  events: ResourceRefreshEvents,
  accountId: string | null,
  boardId: string,
  denied = false,
): void {
  const client = useQueryClient();
  useEffect(() => {
    if (accountId === null || denied) return;
    const refresh = new BoardResourceRefresh(client, {
      deploymentOrigin: window.location.origin,
      accountId,
      boardId,
    });
    const cleanup = installBoardResourceRecovery(refresh, {
      target: window,
      online: () => navigator.onLine,
      current: () => {
        try {
          return (
            readLocalSignOutPending(window.location.origin) === null &&
            readSelectedAccountMarker(window.location.origin) === accountId
          );
        } catch {
          return false;
        }
      },
      subscribeReady: (recover) =>
        events.subscribe((event) => {
          if (event.boardId !== boardId) return;
          if (event.kind === 'ready') recover();
          else refresh.receive(event);
        }),
      authenticate: async () => {
        const user = await client.fetchQuery({ ...currentUserQueryOptions, staleTime: 0 });
        return user?.id === accountId;
      },
    });
    return () => {
      refresh.dispose();
      cleanup();
    };
  }, [events, client, accountId, boardId, denied]);
}
