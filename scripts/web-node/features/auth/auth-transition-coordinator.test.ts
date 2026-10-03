import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@archboard/contracts';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  unauthorized: vi.fn(),
  forget: vi.fn(),
  selected: vi.fn(),
  pending: vi.fn(),
  marker: vi.fn(),
  boards: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/platform/api', () => ({
  getCurrentUser: mocks.me,
  setUnauthorizedListener: mocks.unauthorized,
}));
vi.mock('@/features/auth/auth-client', () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock('@archboard/sync-client', async (original) => ({
  ...(await original()),
  forgetSelectedLocalAccount: mocks.forget,
  selectLocalAccount: mocks.selected,
  readLocalSignOutPending: mocks.pending,
  readSelectedAccountMarker: mocks.marker,
  listAccountPendingBoards: mocks.boards,
}));

import {
  clearAuthenticatedState,
  approveAccountSwitch,
  getPendingAccountSwitch,
  installSessionBoundary,
  loadCurrentUser,
  setPendingAccountSwitch,
  subscribePendingAccountSwitch,
} from '@/features/auth/auth-transition-coordinator';
import { CURRENT_USER_QUERY_KEY, queryClient } from '@/features/auth/session-query-definitions';

const user: CurrentUser = {
  id: 'next-user',
  email: 'next@example.test',
  name: 'Next user',
  image: null,
};
const request = () => ({ signal: new AbortController().signal });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { location: { origin: 'https://example.test' } }),
  );
  mocks.pending.mockReturnValue(null);
  mocks.marker.mockReturnValue(null);
  setPendingAccountSwitch(null);
  queryClient.clear();
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

it('discards a user response from before authenticated state was cleared', async () => {
  let resolve!: (value: CurrentUser) => void;
  mocks.me.mockReturnValue(
    new Promise<CurrentUser>((done) => {
      resolve = done;
    }),
  );
  const loading = loadCurrentUser(request());
  clearAuthenticatedState();
  resolve(user);
  expect(await loading).toBeNull();
  expect(mocks.selected).not.toHaveBeenCalled();
  expect(queryClient.getQueryData(CURRENT_USER_QUERY_KEY)).toBeNull();
});

it('discards a response after query cancellation even without a session notice', async () => {
  let resolve!: (value: CurrentUser) => void;
  mocks.me.mockReturnValue(
    new Promise<CurrentUser>((done) => {
      resolve = done;
    }),
  );
  const controller = new AbortController();
  const loading = loadCurrentUser({ signal: controller.signal });
  controller.abort();
  resolve(user);
  expect(await loading).toBeNull();
  expect(mocks.selected).not.toHaveBeenCalled();
});

it('requires fresh pending-work consent after an approved switch loses its session', async () => {
  const pending = { previousUserId: 'previous-user', nextUserId: user.id, boards: [] };
  setPendingAccountSwitch(pending);
  approveAccountSwitch(user.id);
  clearAuthenticatedState();
  expect(getPendingAccountSwitch()).toBeNull();
  mocks.marker.mockReturnValue('previous-user');
  mocks.me.mockResolvedValue(user);
  mocks.boards.mockResolvedValue([
    { namespace: { userId: 'previous-user' }, updateIds: ['pending-original'] },
  ]);
  expect(await loadCurrentUser(request())).toBeNull();
  expect(mocks.boards).toHaveBeenCalledOnce();
  expect(getPendingAccountSwitch()?.previousUserId).toBe('previous-user');
  expect(mocks.selected).not.toHaveBeenCalled();
});

it('an expired session clears protected relational queries while retaining the session query', async () => {
  queryClient.setQueryData(
    ['board-resources', 'origin', 'previous-user', 'board', 'comments'],
    'cached',
  );
  queryClient.setQueryData(CURRENT_USER_QUERY_KEY, user);
  mocks.me.mockResolvedValue(null);
  expect(await loadCurrentUser(request())).toBeNull();
  expect(
    queryClient.getQueryData(['board-resources', 'origin', 'previous-user', 'board', 'comments']),
  ).toBeUndefined();
  expect(queryClient.getQueryData(CURRENT_USER_QUERY_KEY)).toEqual(user);
  expect(mocks.forget).toHaveBeenCalled();
});

it('a pending local sign-out never restores a valid cookie or protected queries', async () => {
  mocks.pending.mockReturnValue('next-user');
  mocks.me.mockResolvedValue(user);
  mocks.signOut.mockResolvedValue({ error: { status: 503 } });
  queryClient.setQueryData(
    ['board-resources', 'origin', 'next-user', 'board', 'members'],
    'cached',
  );
  expect(await loadCurrentUser(request())).toBeNull();
  expect(
    queryClient.getQueryData(['board-resources', 'origin', 'next-user', 'board', 'members']),
  ).toBeUndefined();
  expect(mocks.selected).not.toHaveBeenCalled();
});

it('retains pending account-switch ownership and removes its listener on cleanup', () => {
  const changed = vi.fn();
  const unsubscribe = subscribePendingAccountSwitch(changed);
  const pending = { previousUserId: 'previous-user', nextUserId: user.id, boards: [] };
  setPendingAccountSwitch(pending);
  expect(getPendingAccountSwitch()).toBe(pending);
  expect(changed).toHaveBeenCalledOnce();
  unsubscribe();
  setPendingAccountSwitch(null);
  expect(changed).toHaveBeenCalledOnce();
});

it('installs and removes the same boundary listeners and clears private caches on storage notices', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const cleanup = installSessionBoundary();
  expect(mocks.unauthorized).toHaveBeenCalledWith(clearAuthenticatedState);
  queryClient.setQueryData(['boards'], ['private-board']);
  const notice = Object.assign(new Event('storage'), {
    key: 'archboard:active-sign-out:test',
    newValue: 'pending',
  });
  window.dispatchEvent(notice);
  expect(queryClient.getQueryData(['boards'])).toBeUndefined();
  cleanup();
  expect(mocks.unauthorized).toHaveBeenLastCalledWith(null);
  expect(remove.mock.calls).toEqual(add.mock.calls);
});
