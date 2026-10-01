import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ResourceRefreshEvents } from '@archboard/sync-client';
import { BoardResourceRefresh } from './board-resource-refresh';

export function useBoardResourceRefresh(
  events: ResourceRefreshEvents,
  accountId: string | null,
  boardId: string,
): void {
  const client = useQueryClient();
  useEffect(() => {
    if (accountId === null) return;
    const refresh = new BoardResourceRefresh(client, {
      deploymentOrigin: window.location.origin,
      accountId,
      boardId,
    });
    const unsubscribe = events.subscribe((event) => refresh.receive(event));
    const online = () => refresh.setOnline(true);
    const offline = () => refresh.setOnline(false);
    refresh.setOnline(navigator.onLine);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      unsubscribe();
      refresh.dispose();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [events, client, accountId, boardId]);
}
