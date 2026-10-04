import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readLocalSignOutPending, readSelectedAccountMarker } from '@archboard/sync-client';
import { useCurrentUser } from '@/features/auth';
import { sessionBoundaryEpoch } from '@/features/auth/auth-transition-coordinator';
import { CURRENT_USER_QUERY_KEY } from '@/features/auth/session-query-definitions';
import { serverUnavailable, getCurrentUser, ApiClientError } from '@/platform/api';
import { aiTransport, withAiDeadline } from '@/platform/api/ai-api';
import type { EditorSession } from '@/features/editor/application';
import { AiReviewSession } from './ai-review-session';

export function useAiReviewSession(session: EditorSession) {
  const scope = session.resourceScope;
  const client = useQueryClient();
  const user = useCurrentUser();
  const [online, setOnline] = useState(navigator.onLine);
  const [workflow] = useState(() => {
    const boundary = sessionBoundaryEpoch();
    const allowed = () => {
      if (
        !scope ||
        boundary !== sessionBoundaryEpoch() ||
        session.getSnapshot().accessDenied ||
        session.getSnapshot().archived ||
        !session.canEdit()
      )
        return false;
      try {
        const current = client.getQueryState<{ readonly id: string } | null>(
          CURRENT_USER_QUERY_KEY,
        );
        return (
          readLocalSignOutPending(scope.deploymentOrigin) === null &&
          readSelectedAccountMarker(scope.deploymentOrigin) === scope.accountId &&
          ((current?.status === 'success' && current.data?.id === scope.accountId) ||
            (current?.status === 'error' && serverUnavailable(current.error)))
        );
      } catch {
        return false;
      }
    };
    const connected = () =>
      navigator.onLine &&
      client.getQueryState(CURRENT_USER_QUERY_KEY)?.status === 'success' &&
      client.getQueryState(CURRENT_USER_QUERY_KEY)?.fetchStatus === 'idle';
    return new AiReviewSession(
      scope?.boardId ?? '',
      aiTransport,
      allowed,
      connected,
      () => crypto.randomUUID(),
      Date.now,
      async (signal) => {
        const actor = await withAiDeadline(signal, (signal) => getCurrentUser(signal));
        if (!scope || actor?.id !== scope.accountId)
          throw new ApiClientError(
            'unauthenticated',
            null,
            'UNAUTHENTICATED',
            'Account changed. Private AI drafts were cleared.',
          );
      },
    );
  });
  const state = useSyncExternalStore(workflow.subscribe, workflow.snapshot);
  const identity =
    workflow.currentScope() &&
    !!scope &&
    !session.getSnapshot().accessDenied &&
    !session.getSnapshot().archived &&
    session.canEdit() &&
    ((user.isSuccess && !user.isError && user.data?.id === scope.accountId) ||
      (user.isError && serverUnavailable(user.error)));
  useEffect(() => {
    workflow.activate();
    const changed = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) workflow.pause();
      // Returning online never creates or queues a run. Availability/status are explicit reads.
    };
    const boundaryChanged = () => {
      if (!workflow.currentScope()) workflow.clear();
    };
    window.addEventListener('offline', changed);
    window.addEventListener('online', changed);
    window.addEventListener('storage', boundaryChanged);
    window.addEventListener('focus', boundaryChanged);
    return () => {
      window.removeEventListener('offline', changed);
      window.removeEventListener('online', changed);
      window.removeEventListener('storage', boundaryChanged);
      window.removeEventListener('focus', boundaryChanged);
      workflow.dispose();
    };
  }, [workflow]);
  useEffect(() => {
    if (!identity) workflow.clear();
  }, [identity, workflow]);
  const expiry = state.run?.content.status === 'available' ? state.run.content.expiresAt : null;
  useEffect(() => {
    if (!expiry) return;
    const maximumDelay = 900_000;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = Date.parse(expiry) - Date.now();
      if (remaining <= 0) workflow.expire();
      else timer = setTimeout(check, Math.min(maximumDelay, remaining));
    };
    check();
    return () => clearTimeout(timer);
  }, [expiry, workflow]);
  return { workflow, state, online, identity };
}
