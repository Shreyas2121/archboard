import { queryOptions } from '@tanstack/react-query';
import { CURRENT_USER_QUERY_KEY, SESSION_STALE_MS } from './session-query-definitions';
import { loadCurrentUser } from './auth-transition-coordinator';
export const currentUserQueryOptions = queryOptions({
  queryKey: CURRENT_USER_QUERY_KEY,
  queryFn: loadCurrentUser,
  staleTime: SESSION_STALE_MS,
  retry: false,
  // Multiple routes/observers must not restart a failed session check on each mount.
  // Explicit retry, reconnect, and window focus can still check again.
  retryOnMount: false,
});
