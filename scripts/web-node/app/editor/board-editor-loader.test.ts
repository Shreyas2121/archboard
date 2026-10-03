import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ROLES } from '@archboard/contracts';

import {
  BoardEditorLoader,
  type BoardEditorIdentity,
  type BoardEditorLoadState,
} from '@/app/editor/board-editor-loader';
import { ApiClientError } from '@/platform/api';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  read: vi.fn(),
  cached: vi.fn(),
  cache: vi.fn(),
  account: vi.fn(),
}));
vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({
    apiOrigin: 'https://api.example.test',
    webSocketOrigin: 'wss://api.example.test',
  }),
}));
vi.mock('@/features/boards/board-api', () => ({ readBoard: mocks.read }));
vi.mock('@archboard/sync-client', async (original) => ({
  ...(await original()),
  cacheBoardSummary: mocks.cache,
  readSelectedCachedBoard: mocks.cached,
  selectLocalAccount: mocks.account,
}));
vi.mock('@/features/editor/application', async (original) => ({
  ...(await original()),
  EditorSession: vi.fn(function () {
    return mocks.create();
  }),
}));

const identity: BoardEditorIdentity = {
  deploymentOrigin: 'https://app.example.test',
  boardId: crypto.randomUUID(),
  userId: 'account-a',
  forceReadOnly: false,
};
const detail = {
  id: identity.boardId,
  title: 'Board',
  effectiveRole: BOARD_ROLES.EDITOR,
  archivedAt: null,
};
const HTTP_UNAVAILABLE = 503;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const session = {
    open: vi.fn(async () => {}),
    getSnapshot: () => ({ initializationError: false }),
    close: vi.fn(async () => {}),
    startSync: vi.fn(async () => {}),
    setBoardAccess: vi.fn(async () => {}),
    useCachedBoardAccess: vi.fn(() => true),
    denyBoardAccess: vi.fn(),
  };
  mocks.create.mockReturnValue(session);
  const states: BoardEditorLoadState[] = [];
  const loader = new BoardEditorLoader(identity, (state) => states.push(state));
  return { session, states, loader };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.read.mockResolvedValue(detail);
  mocks.cached.mockResolvedValue({
    boardId: identity.boardId,
    locallyAvailable: true,
    role: BOARD_ROLES.EDITOR,
    archived: false,
    summary: { title: 'Cached' },
  });
  mocks.cache.mockResolvedValue(undefined);
  mocks.account.mockReturnValue({ userId: identity.userId });
});

describe('board editor loading boundary', () => {
  it('reports constructor failure through the outer boundary', async () => {
    const { loader, states } = harness();
    mocks.create.mockImplementation(() => {
      throw new Error('BroadcastChannel unavailable');
    });
    await loader.load('online');
    expect(states.at(-1)).toMatchObject({ session: null, status: 'cache-error' });
    await loader.close();
  });

  it('aborts a delayed board read and fences late results when navigating away', async () => {
    const { loader, session, states } = harness();
    const started = deferred<AbortSignal>();
    const result = deferred<typeof detail>();
    mocks.read.mockImplementation((_id: string, signal: AbortSignal) => {
      started.resolve(signal);
      return result.promise;
    });
    const load = loader.load('online');
    const signal = await started.promise;
    await loader.close();
    expect(signal.aborted).toBe(true);
    result.resolve(detail);
    await load;
    expect(session.setBoardAccess).not.toHaveBeenCalled();
    expect(session.startSync).not.toHaveBeenCalled();
    expect(states).toEqual([]);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('preserves session identity through offline and online metadata refresh', async () => {
    const { loader, session } = harness();
    await loader.load('online');
    await loader.load('offline');
    await loader.load('online');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(session.open).toHaveBeenCalledTimes(1);
    expect(session.close).not.toHaveBeenCalled();
    await loader.close();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to the cache for a proxy outage', async () => {
    const { loader, session, states } = harness();
    mocks.read.mockRejectedValue(
      new ApiClientError('http', HTTP_UNAVAILABLE, null, 'proxy outage'),
    );
    await loader.load('online');
    expect(session.denyBoardAccess).not.toHaveBeenCalled();
    expect(session.useCachedBoardAccess).toHaveBeenCalledWith(BOARD_ROLES.EDITOR, false);
    expect(states.at(-1)).toMatchObject({ status: 'ready', boardTitle: 'Cached' });
    await loader.close();
  });

  it('fences superseded metadata reads when auth becomes unavailable', async () => {
    const { loader, session, states } = harness();
    const started = deferred<AbortSignal>();
    const result = deferred<typeof detail>();
    mocks.read.mockImplementationOnce((_id: string, signal: AbortSignal) => {
      started.resolve(signal);
      return result.promise;
    });
    const online = loader.load('online');
    const signal = await started.promise;
    await loader.load('offline');
    expect(signal.aborted).toBe(true);
    result.resolve(detail);
    await online;
    expect(session.setBoardAccess).not.toHaveBeenCalled();
    expect(states.at(-1)?.boardTitle).toBe('Cached');
    await loader.close();
  });

  it('closes the session when a cache operation fails', async () => {
    const { loader, session, states } = harness();
    mocks.cached.mockRejectedValue(new Error('storage unavailable'));
    await loader.load('offline');
    expect(states.at(-1)).toMatchObject({ session: null, status: 'cache-error' });
    expect(session.close).toHaveBeenCalledTimes(1);
    await loader.close();
  });
});
