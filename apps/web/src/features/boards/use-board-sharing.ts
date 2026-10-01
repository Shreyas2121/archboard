import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  type BoardMember,
  type BoardSummary,
  type ChangeMemberRole,
} from '@archboard/contracts';
import { readLocalSignOutPending, readSelectedAccountMarker } from '@archboard/sync-client';
import type { EditorSession } from '@/features/editor/application';
import { useCurrentUser } from '@/features/auth';
import { CURRENT_USER_QUERY_KEY } from '@/features/auth/session-query-definitions';
import { ApiClientError, serverUnavailable } from '@/platform/api';
import { readBoard } from './board-api';
import { readInBoardScope } from './board-request-lifecycle';
import { changeMemberRole, readMembers, removeMember } from './board-members-api';
import {
  BoardResourceRefresh,
  boardResourceQueryKey,
  type BoardQueryScope,
} from './board-resource-refresh';
import {
  canLeaveBoard,
  canManageMember,
  canManageInvites,
  sharingWriteBlocker,
  type SharingAuthority,
} from './board-sharing-policy';

export function useBoardSharing(session: EditorSession, scope: BoardQueryScope, open: boolean) {
  const client = useQueryClient();
  const currentUser = useCurrentUser();
  const [online, setOnline] = useState(navigator.onLine);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const snapshot = session.getSnapshot();
  let selectedAccount: string | null = null;
  try {
    selectedAccount = readSelectedAccountMarker(scope.deploymentOrigin);
  } catch {
    /* No cached authority. */
  }
  const authenticated =
    currentUser.isSuccess && !currentUser.isError && currentUser.data?.id === scope.accountId;
  const accountMatches =
    authenticated ||
    (currentUser.isError &&
      serverUnavailable(currentUser.error) &&
      selectedAccount === scope.accountId);
  const identity = useRef({ authenticated, accountMatches, online });
  identity.current = { authenticated, accountMatches, online };
  const isCurrent = useCallback(() => {
    try {
      return (
        active.current &&
        identity.current.accountMatches &&
        !session.getSnapshot().accessDenied &&
        readLocalSignOutPending(scope.deploymentOrigin) === null &&
        readSelectedAccountMarker(scope.deploymentOrigin) === scope.accountId
      );
    } catch {
      return false;
    }
  }, [scope, session]);
  const canRead = useCallback(() => {
    const identityState = client.getQueryState<{ readonly id: string } | null>(
      CURRENT_USER_QUERY_KEY,
    );
    return (
      isCurrent() &&
      identity.current.authenticated &&
      navigator.onLine &&
      identityState?.status === 'success' &&
      identityState.fetchStatus === 'idle' &&
      identityState.data?.id === scope.accountId
    );
  }, [isCurrent, client, scope.accountId]);
  const enabled = open && authenticated && online && !snapshot.accessDenied;
  const metadataKey = boardResourceQueryKey(scope, 'metadata');
  const membersKey = boardResourceQueryKey(scope, 'members');
  const metadata = useQuery({
    queryKey: metadataKey,
    queryFn: async ({ signal }) => {
      const board = await readInBoardScope(signal, canRead, () => readBoard(scope.boardId, signal));
      if (board.id !== scope.boardId) throw new Error('The API returned a different board.');
      return board;
    },
    enabled,
    retry: false,
    staleTime: Infinity,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const members = useQuery({
    queryKey: membersKey,
    queryFn: ({ signal }) =>
      readInBoardScope(signal, canRead, () => readMembers(scope.boardId, signal)),
    enabled,
    retry: false,
    staleTime: Infinity,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const authority = useCallback((): SharingAuthority => {
    const board = client.getQueryData<BoardSummary>(boardResourceQueryKey(scope, 'metadata'));
    const rows = client.getQueryData<BoardMember[]>(boardResourceQueryKey(scope, 'members'));
    const boardState = client.getQueryState(boardResourceQueryKey(scope, 'metadata'));
    const memberState = client.getQueryState(boardResourceQueryKey(scope, 'members'));
    const access = session.getSnapshot();
    return {
      ...identity.current,
      online: identity.current.online && navigator.onLine,
      denied: access.accessDenied,
      fresh:
        isCurrent() &&
        canRead() &&
        board?.id === scope.boardId &&
        boardState?.status === 'success' &&
        memberState?.status === 'success' &&
        !boardState.isInvalidated &&
        !memberState.isInvalidated &&
        boardState.fetchStatus === 'idle' &&
        memberState.fetchStatus === 'idle' &&
        (access.boardRole === null || access.boardRole === board?.effectiveRole) &&
        rows?.some(({ user }) => user.id === scope.accountId) === true,
      archived: access.archived || board?.archivedAt != null,
      role: board?.effectiveRole ?? null,
      accountId: scope.accountId,
      ownerId: board?.owner.id ?? null,
    };
  }, [client, scope, session, isCurrent, canRead]);

  const stopProtectedReads = useCallback(() => {
    session.denyBoardAccess();
    new BoardResourceRefresh(client, scope).dispose(true);
  }, [client, scope, session]);

  const handleFailure = useCallback(
    (cause: unknown) => {
      if (!isCurrent()) return;
      if (
        cause instanceof ApiClientError &&
        (cause.code === ERROR_CODES.NOT_FOUND || cause.kind === 'unauthenticated')
      ) {
        stopProtectedReads();
        setError(
          cause.kind === 'unauthenticated'
            ? 'Sign in again. Your local copy is retained.'
            : 'This board is no longer available to you. Your local copy is retained.',
        );
      } else {
        setError(cause instanceof Error ? cause.message : 'Board access could not be updated.');
      }
    },
    [stopProtectedReads, isCurrent],
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => {
      setOnline(false);
      request.current?.abort();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      void client.cancelQueries({ queryKey: boardResourceQueryKey(scope) });
    };
  }, [client, scope]);
  useEffect(() => {
    if (!authenticated || !online || snapshot.accessDenied) {
      request.current?.abort();
      void client.cancelQueries({ queryKey: boardResourceQueryKey(scope) });
    }
    if (!accountMatches || snapshot.accessDenied)
      new BoardResourceRefresh(client, scope).dispose(true);
  }, [authenticated, accountMatches, online, snapshot.accessDenied, client, scope]);
  useEffect(() => {
    if (metadata.error) handleFailure(metadata.error);
    else if (members.error) handleFailure(members.error);
  }, [metadata.error, members.error, handleFailure]);

  async function refresh(): Promise<void> {
    if (!canRead()) throw new Error('Reconnect and authenticate before refreshing board access.');
    await Promise.all([
      metadata.refetch({ throwOnError: true }),
      members.refetch({ throwOnError: true }),
    ]);
    if (!canRead()) throw new Error('Board access changed while refreshing.');
  }

  function assertAllowed(userId: string, selfLeave: boolean) {
    const current = authority();
    if (
      !active.current ||
      !(selfLeave
        ? userId === scope.accountId && canLeaveBoard(current)
        : canManageMember(current, userId))
    )
      throw new Error(
        sharingWriteBlocker(current) ??
          'Only the owner can manage other members. The owner cannot leave.',
      );
  }

  async function mutate(
    userId: string,
    role: ChangeMemberRole['role'] | null,
    selfLeave = false,
  ): Promise<void> {
    if (request.current !== null) throw new Error('Wait for the current member action to finish.');
    assertAllowed(userId, selfLeave);
    const controller = new AbortController();
    request.current = controller;
    setBusyMember(userId);
    setError('');
    setNotice('');
    let writeStarted = false;
    try {
      await refresh();
      assertAllowed(userId, selfLeave);
      if (controller.signal.aborted)
        throw new Error('The member action was cancelled. Refresh to check its outcome.');
      writeStarted = true;
      if (role === null) await removeMember(scope.boardId, userId, controller.signal);
      else await changeMemberRole(scope.boardId, userId, role, controller.signal);
      if (!isCurrent()) return;
      if (selfLeave) {
        stopProtectedReads();
        setNotice('You left this board. Your local recovery copy and queued changes are retained.');
      } else {
        setNotice(
          role === null
            ? 'Member removed. Refreshing current access…'
            : 'Role updated. Refreshing current access…',
        );
        const resources = new BoardResourceRefresh(client, scope);
        resources.mutationCommitted(['members', 'metadata']);
        await resources.whenIdle();
        const state = authority();
        if (!state.fresh)
          throw new Error(
            'The change committed, but current access could not refresh. Retry refresh before another change.',
          );
        setNotice(role === null ? 'Member removed.' : 'Role updated.');
      }
    } catch (cause) {
      // A member PATCH can return 404 for an already removed target while the
      // actor still has board access. Only authoritative reads deny that access.
      if (
        writeStarted &&
        !selfLeave &&
        cause instanceof ApiClientError &&
        cause.code === ERROR_CODES.NOT_FOUND
      ) {
        if (isCurrent())
          setError('This member is no longer available. Refreshing current board access.');
      } else handleFailure(cause);
      if (
        writeStarted &&
        isCurrent() &&
        (controller.signal.aborted ||
          (cause instanceof ApiClientError &&
            (cause.kind === 'network' || cause.kind === 'invalid-response')))
      )
        setError(
          'The member action could not be confirmed. Refresh current access before retrying. Your local copy is retained.',
        );
      // Refresh uncertain, forbidden, archived and failed outcomes; never retry the write.
      if (canRead()) {
        const resources = new BoardResourceRefresh(client, scope);
        resources.mutationCommitted(['members', 'metadata']);
        await resources.whenIdle();
      }
      throw cause;
    } finally {
      request.current = null;
      if (active.current) setBusyMember(null);
    }
  }

  return {
    metadata,
    members,
    accountMatches,
    authenticated,
    online,
    busyMember,
    notice,
    error,
    authority: authority(),
    isCurrent,
    canRead,
    readAuthority: authority,
    assertAllowed,
    assertInviteAllowed: () => {
      const current = authority();
      if (!canManageInvites(current))
        throw new Error(sharingWriteBlocker(current) ?? 'Only the owner manages invitations.');
    },
    refresh,
    mutate,
    handleFailure,
    stopProtectedReads,
  };
}
