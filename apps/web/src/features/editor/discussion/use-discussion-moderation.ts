import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ERROR_CODES } from '@archboard/contracts';
import { ApiClientError } from '@/platform/api';
import {
  BoardResourceRefresh,
  type BoardQueryScope,
} from '@/features/boards/board-resource-refresh';
import type { useBoardSharing } from '@/features/boards/use-board-sharing';
import { canModerateComment, discussionWriteAllowed } from './discussion-model';
import { mutateDiscussion, readCurrentTarget } from './discussion-api';
import { DiscussionModeration, type ModerationAction } from './discussion-moderation-state';

export function useDiscussionModeration(
  scope: BoardQueryScope,
  access: ReturnType<typeof useBoardSharing>,
  readOnly: boolean,
) {
  const client = useQueryClient();
  const latest = useRef({ access, readOnly });
  const opener = useRef<HTMLElement | null>(null);
  latest.current = { access, readOnly };
  const [controller] = useState(
    () =>
      new DiscussionModeration({
        isCurrent: () =>
          latest.current.access.accountMatches && !latest.current.access.authority.denied,
        authorize: async (action, signal) => {
          await latest.current.access.refresh();
          const authority = latest.current.access.readAuthority();
          if (
            signal.aborted ||
            latest.current.readOnly ||
            !discussionWriteAllowed(authority) ||
            (action.kind !== 'resolve' && !canModerateComment(authority, action.resource))
          )
            throw new Error('Current editing authority is unavailable.');
        },
        send: (action, signal) => mutateDiscussion(scope.boardId, action, signal),
        read: async (action, signal) => {
          if (
            !latest.current.access.authenticated ||
            !navigator.onLine ||
            latest.current.access.authority.denied
          )
            throw new Error('Reconnect and authenticate before reviewing current content.');
          const target = await readCurrentTarget(scope.boardId, action, signal);
          if (
            !signal.aborted &&
            latest.current.access.accountMatches &&
            !latest.current.access.authority.denied
          ) {
            const refresh = new BoardResourceRefresh(client, scope);
            refresh.mutationCommitted(['comments']);
            await refresh.whenIdle();
          }
          return target;
        },
        committed: async () => {
          if (!latest.current.access.accountMatches || latest.current.access.authority.denied)
            return;
          const refresh = new BoardResourceRefresh(client, scope);
          refresh.mutationCommitted(['comments']);
          await refresh.whenIdle();
        },
        isConflict: (cause) =>
          cause instanceof ApiClientError && cause.code === ERROR_CODES.VERSION_CONFLICT,
        failed: (cause) => {
          if (cause instanceof ApiClientError && cause.kind === 'unauthenticated')
            latest.current.access.handleFailure(cause);
          else if (navigator.onLine)
            void latest.current.access.refresh().catch(latest.current.access.handleFailure);
        },
      }),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (
      !access.accountMatches ||
      !access.online ||
      access.authority.denied ||
      readOnly ||
      access.authority.archived ||
      access.authority.role === 'viewer'
    )
      controller.suspend();
  }, [
    controller,
    access.accountMatches,
    access.online,
    access.authority.denied,
    access.authority.archived,
    access.authority.role,
    readOnly,
  ]);
  function begin(action: ModerationAction) {
    const authority = latest.current.access.readAuthority();
    if (
      !readOnly &&
      discussionWriteAllowed(authority) &&
      (action.kind === 'resolve' || canModerateComment(authority, action.resource))
    ) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      controller.begin(action);
    }
  }
  return {
    controller,
    snapshot,
    begin,
    restoreFocus: () => {
      if (opener.current?.isConnected) opener.current.focus();
      else document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
    },
  };
}
