import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readLocalSignOutPending, readSelectedAccountMarker } from '@archboard/sync-client';
import { useCurrentUser } from '@/features/auth';
import { currentUserQueryOptions } from '@/features/auth/current-user-query';
import { boardResourceQueryKey } from '@/features/boards/board-resource-refresh';
import { PortabilityGeneration } from './portability-policy';

// Mount with an account/board key. Files, frozen intents and late replies never change scope.
export function usePortabilityScope(accountId: string, boardId: string) {
  const client = useQueryClient();
  const user = useCurrentUser();
  const origin = window.location.origin;
  const [online, setOnline] = useState(navigator.onLine);
  const [verified, setVerified] = useState(false);
  const active = useRef(false);
  const generation = useRef(new PortabilityGeneration());
  const identity = user.isSuccess && !user.isError && user.data?.id === accountId;
  const selected = useCallback(() => {
    try {
      return (
        active.current &&
        readLocalSignOutPending(origin) === null &&
        readSelectedAccountMarker(origin) === accountId
      );
    } catch {
      return false;
    }
  }, [accountId, origin]);
  const current = useCallback(
    () =>
      selected() &&
      client.getQueryState(currentUserQueryOptions.queryKey)?.status === 'success' &&
      client.getQueryData(currentUserQueryOptions.queryKey)?.id === accountId,
    [accountId, client, selected],
  );
  const authenticate = useCallback(async () => {
    if (!navigator.onLine || !selected())
      throw new Error('Reconnect and sign in with this account.');
    const token = generation.current.capture();
    const actor = await client.fetchQuery({ ...currentUserQueryOptions, staleTime: 0 });
    if (!current() || !generation.current.current(token) || actor?.id !== accountId)
      throw new Error('Account changed. The previous local copy was retained.');
    return token;
  }, [accountId, client, current, selected]);
  const refreshAccess = useCallback(async () => {
    const token = await authenticate();
    if (!current() || !generation.current.current(token)) return;
    setVerified(true);
    await client.invalidateQueries({
      queryKey: boardResourceQueryKey({ deploymentOrigin: origin, accountId, boardId }),
    });
  }, [authenticate, current, client, origin, accountId, boardId]);
  useEffect(() => {
    const fence = generation.current;
    active.current = true;
    const recover = () => {
      fence.invalidate();
      setOnline(navigator.onLine);
      setVerified(false);
      void client.cancelQueries({
        queryKey: boardResourceQueryKey({ deploymentOrigin: origin, accountId, boardId }),
      });
      if (!navigator.onLine) return;
      void authenticate().then(
        (token) => {
          if (!current() || !fence.current(token)) return;
          setVerified(true);
          void client.invalidateQueries({
            queryKey: boardResourceQueryKey({ deploymentOrigin: origin, accountId, boardId }),
          });
        },
        () => undefined,
      );
    };
    window.addEventListener('focus', recover);
    window.addEventListener('online', recover);
    window.addEventListener('offline', recover);
    recover();
    return () => {
      active.current = false;
      fence.invalidate();
      window.removeEventListener('focus', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', recover);
      void client.cancelQueries({
        queryKey: boardResourceQueryKey({ deploymentOrigin: origin, accountId, boardId }),
      });
    };
  }, [authenticate, current, client, origin, accountId, boardId]);
  return {
    accountId,
    boardId,
    origin,
    online,
    readable: online && verified && identity,
    current,
    alive: () => active.current,
    authenticate,
    refreshAccess,
    capture: () => generation.current.capture(),
    accepts: (token: number) => current() && navigator.onLine && generation.current.current(token),
    client,
    queryKey: boardResourceQueryKey({ deploymentOrigin: origin, accountId, boardId }),
  };
}

export type PortabilityScope = ReturnType<typeof usePortabilityScope>;
