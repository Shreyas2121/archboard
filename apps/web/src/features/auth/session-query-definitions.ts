import { QueryClient } from '@tanstack/react-query';
import type { PendingAccountBoard } from '@archboard/sync-client';
export const SESSION_STALE_MS = 30_000;
export const HTTP_UNAUTHORIZED = 401;
export const AUTH_NOTICE_CHANNEL = 'archboard:auth-notices:v1';
export const ACCOUNT_SWITCH_EVENT = 'archboard:account-switch-required';
export const CURRENT_USER_QUERY_KEY = ['session', 'me'] as const;

export interface PendingAccountSwitch {
  readonly previousUserId: string;
  readonly nextUserId: string;
  readonly boards: readonly PendingAccountBoard[];
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function isPrivateQuery(query: { readonly queryKey: readonly unknown[] }): boolean {
  return (
    query.queryKey.length !== CURRENT_USER_QUERY_KEY.length ||
    query.queryKey[0] !== CURRENT_USER_QUERY_KEY[0] ||
    query.queryKey[1] !== CURRENT_USER_QUERY_KEY[1]
  );
}

export function clearPrivateQueries(): void {
  void queryClient.cancelQueries({ predicate: isPrivateQuery });
  queryClient.removeQueries({ predicate: isPrivateQuery });
}
