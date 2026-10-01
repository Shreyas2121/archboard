import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateInvite, InviteCreateResult } from '@archboard/contracts';
import { ApiClientError } from '@/platform/api';
import { createInvite, readInvites, revokeInvite } from './board-invites-api';
import { boardResourceQueryKey, type BoardQueryScope } from './board-resource-refresh';
import { canManageInvites } from './board-sharing-policy';
import { canReconcileInvite, type InviteRequest } from './invite-request';
import type { useBoardSharing } from './use-board-sharing';

const HTTP_SERVER_ERROR = 500;

export function useBoardInvites(
  scope: BoardQueryScope,
  sharing: ReturnType<typeof useBoardSharing>,
  open: boolean,
) {
  const client = useQueryClient();
  const [fresh, setFresh] = useState<InviteCreateResult | null>(null);
  const [uncertain, setUncertain] = useState<InviteRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const latest = useRef({ sharing, open });
  latest.current = { sharing, open };
  const owner =
    sharing.accountMatches &&
    sharing.authority.role === 'owner' &&
    sharing.authority.ownerId === scope.accountId &&
    !sharing.authority.denied;
  const queryKey = boardResourceQueryKey(scope, 'invites');
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => readInvites(scope.boardId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled:
      open && owner && sharing.authenticated && sharing.online && !sharing.authority.archived,
    retry: false,
    networkMode: 'always',
  });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
      void client.cancelQueries({ queryKey: boardResourceQueryKey(scope, 'invites') });
    };
  }, [client, scope]);
  useEffect(() => {
    if (!open || !owner || !sharing.authenticated) setFresh(null);
    if (!owner || !sharing.authenticated || !sharing.online) request.current?.abort();
    if (!owner) {
      const queryKey = boardResourceQueryKey(scope, 'invites');
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    }
  }, [open, owner, sharing.authenticated, sharing.online, client, scope]);

  function current() {
    return (
      active.current &&
      latest.current.sharing.accountMatches &&
      latest.current.sharing.authority.role === 'owner' &&
      latest.current.sharing.authority.ownerId === scope.accountId &&
      !latest.current.sharing.authority.denied
    );
  }
  async function refresh() {
    await sharing.refresh();
    latest.current.sharing.assertInviteAllowed();
    await client.invalidateQueries({ queryKey, refetchType: 'none' });
    await list.refetch({ throwOnError: true });
  }

  async function mutate(role: CreateInvite['role'] | null, inviteId?: string, retry = false) {
    if (request.current || sharing.busyMember !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    let submitted = false;
    let operation: InviteRequest | null = null;
    try {
      await sharing.refresh();
      latest.current.sharing.assertInviteAllowed();
      if (!current() || !latest.current.open || controller.signal.aborted) return;
      if (role !== null) {
        if (uncertain && !retry)
          throw new Error('Review the uncertain invitation before creating another.');
        operation = retry
          ? uncertain
          : { key: crypto.randomUUID(), input: { role }, startedAt: Date.now() };
        if (!operation || !canReconcileInvite(operation, Date.now()))
          throw new Error(
            'The retry window ended. Review the invitation list before starting a new request.',
          );
        // Keep the request before sending. Never put the creation result in Query/mutation caches.
        setUncertain(operation);
        submitted = true;
        const result = await createInvite(
          scope.boardId,
          operation.input,
          operation.key,
          controller.signal,
        );
        if (!current() || !latest.current.sharing.authenticated) return;
        setUncertain(null);
        setFresh(latest.current.open ? result : null);
        setNotice(
          result.inviteUrlAvailable
            ? 'Invitation created. Copy this link now; it is shown only once.'
            : 'The original invitation was recovered, but its link cannot be shown again. Review its metadata, revoke it and create a new invitation if needed.',
        );
      } else if (inviteId) {
        submitted = true;
        await revokeInvite(scope.boardId, inviteId, controller.signal);
        if (!current()) return;
        setFresh((value) => (value?.id === inviteId ? null : value));
        setNotice('Invitation revoked.');
      }
      if (current() && latest.current.sharing.authenticated && navigator.onLine) {
        try {
          await refresh();
        } catch {
          setError(
            'The action committed, but invitations could not refresh. Refresh before another action.',
          );
        }
      }
    } catch (cause) {
      if (!current()) return;
      const unknownOutcome =
        submitted &&
        (controller.signal.aborted ||
          !(cause instanceof ApiClientError) ||
          cause.kind !== 'http' ||
          (cause.status ?? 0) >= HTTP_SERVER_ERROR);
      if (operation && !unknownOutcome) setUncertain(null);
      setError(
        unknownOutcome
          ? 'The action could not be confirmed. Refresh the list; reconcile creation with the same request before issuing another invitation.'
          : submitted
            ? 'Invitation action was rejected. Refresh current access and invitation metadata before retrying.'
            : cause instanceof Error
              ? cause.message
              : 'Invitation action unavailable.',
      );
      if (latest.current.sharing.authenticated && navigator.onLine) {
        try {
          await refresh();
        } catch {
          /* Leave the error and exact request visible. */
        }
      }
    } finally {
      request.current = null;
      if (active.current) setBusy(false);
    }
  }

  async function copy() {
    const link = fresh?.inviteUrl;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      if (current())
        setNotice('Invitation link copied. Share it only with the intended recipient.');
    } catch {
      if (current()) setError('Clipboard unavailable. Select the link and copy it manually.');
    }
  }

  return {
    owner,
    list,
    fresh: open && owner && sharing.authenticated ? fresh : null,
    uncertain,
    busy,
    notice,
    error,
    copy,
    refresh: async () => {
      try {
        await refresh();
        if (current()) setError('');
      } catch {
        if (current())
          setError('Could not refresh invitations. Reconnect and verify current owner access.');
      }
    },
    allowed: canManageInvites(sharing.authority) && sharing.busyMember === null && !busy,
    create: (role: CreateInvite['role']) => mutate(role),
    reconcile: () =>
      uncertain ? mutate(uncertain.input.role, undefined, true) : Promise.resolve(),
    revoke: (id: string) => mutate(null, id),
    dismissFresh: () => setFresh(null),
    reviewExpired: async () => {
      if (!uncertain || canReconcileInvite(uncertain, Date.now())) return;
      try {
        await refresh();
        if (current()) {
          setUncertain(null);
          setNotice(
            'List refreshed. Revoke any active unwanted invitation before creating another.',
          );
        }
      } catch {
        if (current()) setError('Could not review invitations. The uncertain request is retained.');
      }
    },
  };
}
