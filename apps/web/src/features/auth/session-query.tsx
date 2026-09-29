import { useEffect, useState } from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import type { CurrentUser } from '@archboard/contracts';
import {
  clearLocalSignOutPending,
  clearAccountBoardNamespaces,
  forgetSelectedLocalAccount,
  listAccountPendingBoards,
  markLocalSignOutPending,
  readLocalSignOutPending,
  readSelectedAccountMarker,
  selectLocalAccount,
  type PendingAccountBoard,
} from '@archboard/sync-client';

import { getCurrentUser, setUnauthorizedListener } from '@/platform/api';

import { authClient } from './auth-client';
import { PendingChangesDialog } from './pending-changes-dialog';

const SESSION_STALE_MS = 30_000;
const HTTP_UNAUTHORIZED = 401;
const AUTH_NOTICE_CHANNEL = 'archboard:auth-notices:v1';
const ACCOUNT_SWITCH_EVENT = 'archboard:account-switch-required';
export const CURRENT_USER_QUERY_KEY = ['session', 'me'] as const;

export interface PendingAccountSwitch {
  readonly previousUserId: string;
  readonly nextUserId: string;
  readonly boards: readonly PendingAccountBoard[];
}

let authEpoch = 0;
let pendingAccountSwitch: PendingAccountSwitch | null = null;
let approvedNextUserId: string | null = null;

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

function clearPrivateQueries(): void {
  void queryClient.cancelQueries({ predicate: isPrivateQuery });
  queryClient.removeQueries({ predicate: isPrivateQuery });
}

function announceAccountChange(kind: 'sign-out' | 'account-change' | 'account-transition'): void {
  if (!('BroadcastChannel' in window)) return;
  try {
    const channel = new BroadcastChannel(AUTH_NOTICE_CHANNEL);
    channel.postMessage({ kind });
    channel.close();
  } catch {
    // The storage event remains the cross-tab fallback.
  }
}

function openAuthNoticeChannel(): BroadcastChannel | null {
  try {
    return 'BroadcastChannel' in window ? new BroadcastChannel(AUTH_NOTICE_CHANNEL) : null;
  } catch {
    return null;
  }
}

function setPendingAccountSwitch(value: PendingAccountSwitch | null): void {
  pendingAccountSwitch = value;
  window.dispatchEvent(new Event(ACCOUNT_SWITCH_EVENT));
}

export function usePendingAccountSwitch(): PendingAccountSwitch | null {
  const [value, setValue] = useState(pendingAccountSwitch);
  useEffect(() => {
    const update = () => setValue(pendingAccountSwitch);
    window.addEventListener(ACCOUNT_SWITCH_EVENT, update);
    return () => window.removeEventListener(ACCOUNT_SWITCH_EVENT, update);
  }, []);
  return value;
}

export function approveAccountSwitch(nextUserId: string): void {
  if (pendingAccountSwitch?.nextUserId !== nextUserId) throw new Error('Account switch changed.');
  approvedNextUserId = nextUserId;
  setPendingAccountSwitch(null);
  void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
}

async function invalidatePendingServerSession(origin: string): Promise<boolean> {
  const pendingUserId = readLocalSignOutPending(origin);
  if (pendingUserId === null) return true;
  try {
    const current = await getCurrentUser();
    if (current !== null && current.id !== pendingUserId) return false;
    if (current === null) {
      clearLocalSignOutPending(origin, pendingUserId);
      return true;
    }
    const result = await authClient.signOut();
    if (result.error && result.error.status !== HTTP_UNAUTHORIZED) return false;
    clearLocalSignOutPending(origin, pendingUserId);
    return true;
  } catch {
    return false;
  }
}

export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const origin = window.location.origin;
      const startedAtEpoch = authEpoch;
      if (readLocalSignOutPending(origin) !== null) {
        if (await invalidatePendingServerSession(origin)) forgetSelectedLocalAccount(origin);
        return null;
      }
      const user = await getCurrentUser(signal);
      if (startedAtEpoch !== authEpoch || readLocalSignOutPending(origin) !== null) return null;
      if (user === null) {
        forgetSelectedLocalAccount(origin);
        return null;
      }
      const previousUserId = readSelectedAccountMarker(origin);
      if (previousUserId !== null && previousUserId !== user.id) {
        announceAccountChange('account-transition');
        authEpoch += 1;
        const switchEpoch = authEpoch;
        clearPrivateQueries();
        queryClient.setQueryData<CurrentUser | null>(CURRENT_USER_QUERY_KEY, null);
        if (approvedNextUserId !== user.id) {
          const boards = await listAccountPendingBoards({
            deploymentOrigin: origin,
            userId: previousUserId,
          });
          if (authEpoch !== switchEpoch || readLocalSignOutPending(origin) !== null) return null;
          if (boards.length > 0) {
            setPendingAccountSwitch({ previousUserId, nextUserId: user.id, boards });
            return null;
          }
        }
        announceAccountChange('account-change');
      }
      approvedNextUserId = null;
      selectLocalAccount(origin, { kind: 'authenticated', userId: user.id });
      return user;
    },
    staleTime: SESSION_STALE_MS,
    retry: false,
  });
}

export function clearAuthenticatedState(): void {
  authEpoch += 1;
  forgetSelectedLocalAccount(window.location.origin);
  void queryClient.cancelQueries({ queryKey: CURRENT_USER_QUERY_KEY });
  clearPrivateQueries();
  queryClient.setQueryData<CurrentUser | null>(CURRENT_USER_QUERY_KEY, null);
}

export function SessionBoundary() {
  const pendingSwitch = usePendingAccountSwitch();
  useEffect(() => {
    setUnauthorizedListener(clearAuthenticatedState);
    const channel = openAuthNoticeChannel();
    if (channel)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (
          typeof event.data === 'object' &&
          event.data !== null &&
          'kind' in event.data &&
          (event.data.kind === 'sign-out' ||
            event.data.kind === 'account-change' ||
            event.data.kind === 'account-transition')
        ) {
          if (event.data.kind === 'sign-out') clearAuthenticatedState();
          else {
            authEpoch += 1;
            clearPrivateQueries();
            queryClient.setQueryData<CurrentUser | null>(CURRENT_USER_QUERY_KEY, null);
          }
        }
      };
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith('archboard:active-sign-out:') && event.newValue !== null)
        clearAuthenticatedState();
      if (
        event.key === `archboard:account:${window.location.origin}` &&
        event.newValue !== event.oldValue
      ) {
        authEpoch += 1;
        clearPrivateQueries();
        queryClient.setQueryData<CurrentUser | null>(CURRENT_USER_QUERY_KEY, null);
      }
    };
    const onOnline = () => {
      if (readLocalSignOutPending(window.location.origin) !== null)
        void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    return () => {
      setUnauthorizedListener(null);
      channel?.close();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
    };
  }, []);
  return pendingSwitch === null ? null : (
    <PendingChangesDialog
      key={`${pendingSwitch.previousUserId}:${pendingSwitch.nextUserId}`}
      open
      action="switch accounts"
      boards={pendingSwitch.boards}
      onCancel={() => setPendingAccountSwitch(null)}
      onRetain={async () => approveAccountSwitch(pendingSwitch.nextUserId)}
      onClear={async () => {
        await clearAccountBoardNamespaces(
          { deploymentOrigin: window.location.origin, userId: pendingSwitch.previousUserId },
          pendingSwitch.boards,
        );
        approveAccountSwitch(pendingSwitch.nextUserId);
      }}
    />
  );
}

export async function signOut(userId: string): Promise<'server' | 'pending'> {
  const origin = window.location.origin;
  markLocalSignOutPending(origin, userId);
  clearAuthenticatedState();
  announceAccountChange('sign-out');
  return (await invalidatePendingServerSession(origin)) ? 'server' : 'pending';
}
