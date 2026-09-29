import { userIdSchema } from '@archboard/contracts';

import { LOCAL_DEMO_USER_KEY } from '../config/index.js';

const ACCOUNT_MARKER_PREFIX = 'archboard:account:';
const PENDING_SIGN_OUT_PREFIX = 'archboard:pending-sign-out:';
const ACTIVE_SIGN_OUT_PREFIX = 'archboard:active-sign-out:';

export type AccountSessionState =
  | { readonly kind: 'authenticated'; readonly userId: string }
  | { readonly kind: 'network-unavailable' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'pending' };

export interface SelectedLocalAccount {
  readonly deploymentOrigin: string;
  readonly userId: string;
  readonly source: 'session' | 'previous-session';
}

function validatedOrigin(deploymentOrigin: string): string {
  const parsed = new URL(deploymentOrigin);
  if (parsed.origin !== deploymentOrigin)
    throw new TypeError('deploymentOrigin must be an origin.');
  return deploymentOrigin;
}

function markerKey(origin: string): string {
  return `${ACCOUNT_MARKER_PREFIX}${validatedOrigin(origin)}`;
}

function pendingKey(origin: string, userId: string): string {
  return `${PENDING_SIGN_OUT_PREFIX}${validatedOrigin(origin)}:${userIdSchema.parse(userId)}`;
}

function activePendingKey(origin: string): string {
  return `${ACTIVE_SIGN_OUT_PREFIX}${validatedOrigin(origin)}`;
}

function validUserId(userId: string): string {
  const validated = userIdSchema.parse(userId);
  if (validated === LOCAL_DEMO_USER_KEY) throw new TypeError('The demo is not an account.');
  return validated;
}

function readMarker(origin: string): string | null {
  try {
    const raw = localStorage.getItem(markerKey(origin));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('userId' in parsed)) return null;
    return typeof parsed.userId === 'string' ? validUserId(parsed.userId) : null;
  } catch {
    return null;
  }
}

export function readSelectedAccountMarker(deploymentOrigin: string): string | null {
  return readMarker(validatedOrigin(deploymentOrigin));
}

export function readLocalSignOutPending(deploymentOrigin: string): string | null {
  try {
    return localStorage.getItem(activePendingKey(deploymentOrigin));
  } catch {
    // An unreadable intent cannot be treated as proof that sign-out finished.
    return 'unreadable';
  }
}

function hasPendingSignOut(origin: string, userId: string): boolean | null {
  try {
    return localStorage.getItem(pendingKey(origin, userId)) !== null;
  } catch {
    return null;
  }
}

export function selectLocalAccount(
  deploymentOrigin: string,
  session: AccountSessionState,
): SelectedLocalAccount | null {
  const origin = validatedOrigin(deploymentOrigin);
  if (session.kind === 'signed-out' || session.kind === 'pending') return null;
  if (readLocalSignOutPending(origin) !== null) return null;
  if (session.kind === 'authenticated') {
    const userId = validUserId(session.userId);
    if (hasPendingSignOut(origin, userId) === true) return null;
    try {
      localStorage.setItem(markerKey(origin), JSON.stringify({ userId }));
    } catch {
      // A current server session still identifies the account when local storage is unavailable.
    }
    return { deploymentOrigin: origin, userId, source: 'session' };
  }
  const userId = readMarker(origin);
  if (userId === null || hasPendingSignOut(origin, userId) !== false) return null;
  return { deploymentOrigin: origin, userId, source: 'previous-session' };
}

export function forgetSelectedLocalAccount(deploymentOrigin: string): void {
  try {
    localStorage.removeItem(markerKey(deploymentOrigin));
  } catch {
    // Clearing in-memory session state remains possible if local storage is unavailable.
  }
}

export function markLocalSignOutPending(deploymentOrigin: string, userId: string): void {
  const validated = validUserId(userId);
  localStorage.setItem(pendingKey(deploymentOrigin, validated), new Date().toISOString());
  localStorage.setItem(activePendingKey(deploymentOrigin), validated);
}

export function clearLocalSignOutPending(deploymentOrigin: string, userId: string): void {
  const validated = validUserId(userId);
  localStorage.removeItem(pendingKey(deploymentOrigin, validated));
  if (readLocalSignOutPending(deploymentOrigin) === validated)
    localStorage.removeItem(activePendingKey(deploymentOrigin));
}
