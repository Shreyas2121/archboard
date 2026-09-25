import { useEffect } from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import type { CurrentUser } from '@archboard/contracts';

import { getCurrentUser, setUnauthorizedListener } from '@/platform/api';

import { authClient } from './auth-client';

const SESSION_STALE_MS = 30_000;
const HTTP_UNAUTHORIZED = 401;
export const CURRENT_USER_QUERY_KEY = ['session', 'me'] as const;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: ({ signal }) => getCurrentUser(signal),
    staleTime: SESSION_STALE_MS,
    retry: false,
  });
}

export function clearAuthenticatedState(): void {
  void queryClient.cancelQueries();
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey.length !== CURRENT_USER_QUERY_KEY.length ||
      query.queryKey[0] !== CURRENT_USER_QUERY_KEY[0] ||
      query.queryKey[1] !== CURRENT_USER_QUERY_KEY[1],
  });
  queryClient.setQueryData<CurrentUser | null>(CURRENT_USER_QUERY_KEY, null);
}

export function SessionBoundary() {
  useEffect(() => {
    setUnauthorizedListener(clearAuthenticatedState);
    return () => setUnauthorizedListener(null);
  }, []);
  return null;
}

export async function signOut(): Promise<void> {
  const result = await authClient.signOut();
  if (result.error && result.error.status !== HTTP_UNAUTHORIZED) {
    throw new Error('Sign-out could not finish.');
  }
  clearAuthenticatedState();
}
