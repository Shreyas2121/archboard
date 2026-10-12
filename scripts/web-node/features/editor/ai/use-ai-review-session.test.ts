import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorSession } from '@/features/editor/application';
import { ApiClientError } from '@/platform/api/api-client';
import { useAiReviewSession } from '@/features/editor/ai/use-ai-review-session';

const fixture = vi.hoisted(() => ({
  accountId: 'account-one',
  query: {
    status: 'success',
    fetchStatus: 'fetching',
    data: { id: 'account-one' },
    error: null as unknown,
  },
  availability: vi.fn(),
}));

// Exercise the hook's request guards in Node without mounting a browser UI.
vi.mock('react', () => ({
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useEffect: vi.fn(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryState: () => fixture.query }),
}));
vi.mock('@archboard/sync-client', () => ({
  readLocalSignOutPending: () => null,
  readSelectedAccountMarker: () => fixture.accountId,
}));
vi.mock('@/features/auth', () => ({
  useCurrentUser: () => ({
    isSuccess: fixture.query.status === 'success',
    isError: fixture.query.status === 'error',
    data: fixture.query.data,
    error: fixture.query.error,
  }),
}));
vi.mock('@/features/auth/auth-transition-coordinator', () => ({ sessionBoundaryEpoch: () => 0 }));
vi.mock('@/features/auth/session-query-definitions', () => ({
  CURRENT_USER_QUERY_KEY: ['session', 'me'],
}));
vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({ apiOrigin: 'https://api.example.test' }),
}));
vi.mock('@/platform/api', async () => {
  const api = await import('@/platform/api/api-client');
  return { ...api, getCurrentUser: vi.fn() };
});
vi.mock('@/platform/api/ai-api', () => ({
  aiTransport: { availability: fixture.availability },
  withAiDeadline: vi.fn(),
}));

function workflow() {
  const session = {
    resourceScope: {
      boardId: randomUUID(),
      accountId: fixture.accountId,
      deploymentOrigin: 'https://web.example.test',
    },
    canEdit: () => true,
    getSnapshot: () => ({ accessDenied: false, archived: false }),
  } as unknown as EditorSession;
  return useAiReviewSession(session).workflow;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fixture.availability.mockReset();
});

describe('AI availability during session revalidation', () => {
  it.each(['fetching', 'paused', 'idle'])(
    'dispatches the first click with the same cached account while session fetching is %s',
    async (fetchStatus) => {
      vi.stubGlobal('navigator', { onLine: true });
      fixture.query = {
        status: 'success',
        fetchStatus,
        data: { id: fixture.accountId },
        error: null,
      };
      fixture.availability.mockResolvedValue({ available: false, reason: 'disabled' });
      const session = workflow();
      await session.availability();
      expect(fixture.availability).toHaveBeenCalledTimes(1);
      expect(session.snapshot().availability).toMatchObject({ reason: 'disabled' });
    },
  );

  it('allows an explicit recovery read after a transient session API failure', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    fixture.query = {
      status: 'error',
      fetchStatus: 'idle',
      data: { id: fixture.accountId },
      error: new ApiClientError('network', null, null, 'API unavailable'),
    };
    fixture.availability.mockResolvedValue({ available: false, reason: 'disabled' });
    await workflow().availability();
    expect(fixture.availability).toHaveBeenCalledTimes(1);
  });

  it('still refuses requests after a different account is observed', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    fixture.query = {
      status: 'success',
      fetchStatus: 'idle',
      data: { id: 'another-account' },
      error: null,
    };
    await workflow().availability();
    expect(fixture.availability).not.toHaveBeenCalled();
  });
});
