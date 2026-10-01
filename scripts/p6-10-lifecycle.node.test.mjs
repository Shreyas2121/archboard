import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readInBoardScope } from '../apps/web/src/features/boards/board-request-lifecycle.ts';
import { installBoardResourceRecovery } from '../apps/web/src/features/boards/board-resource-recovery.ts';
import {
  BoardResourceRefresh,
  boardResourceQueryKey,
} from '../apps/web/src/features/boards/board-resource-refresh.ts';

const { QueryClient, QueryObserver } = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
)('@tanstack/react-query');
const scope = {
  deploymentOrigin: 'https://example.test',
  accountId: 'actor-a',
  boardId: 'board-a',
};
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise((done) => setImmediate(done));

test('a late read cannot enter Query cache after account loss even when the adapter ignores abort', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const response = deferred();
  let current = true;
  const key = boardResourceQueryKey(scope, 'comments');
  const other = boardResourceQueryKey({ ...scope, accountId: 'actor-b' }, 'comments');
  client.setQueryData(other, 'next account');
  const request = client.fetchQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      readInBoardScope(
        signal,
        () => current,
        () => response.promise,
      ),
  });
  current = false;
  response.resolve('late protected view');
  await assert.rejects(request, /access/);
  assert.equal(client.getQueryData(key), undefined);
  assert.equal(client.getQueryData(other), 'next account');
  client.clear();
});

test('cancelled reads and revoked preflight do not return protected data', async () => {
  let reads = 0;
  const controller = new AbortController();
  await assert.rejects(
    readInBoardScope(
      controller.signal,
      () => false,
      async () => ++reads,
    ),
  );
  assert.equal(reads, 0);
  const response = deferred();
  const request = readInBoardScope(
    controller.signal,
    () => true,
    () => response.promise,
  );
  controller.abort();
  response.resolve('late');
  await assert.rejects(request, /access/);
});

test('focus/online recovery checks identity first, refreshes missed hints, and never submits drafts', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const key = boardResourceQueryKey(scope, 'comments');
  client.setQueryData(key, 'downloaded');
  let reads = 0;
  let offline = false;
  let current = true;
  const sessions = [];
  let ready;
  let unsubscribed = false;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      reads += 1;
      return `current-${reads}`;
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const refresh = new BoardResourceRefresh(client, scope);
  const target = new EventTarget();
  const cleanup = installBoardResourceRecovery(refresh, {
    target,
    online: () => !offline,
    current: () => current,
    authenticate: () => {
      const check = deferred();
      sessions.push(check);
      return check.promise;
    },
    subscribeReady: (recover) => {
      ready = recover;
      return () => {
        unsubscribed = true;
      };
    },
  });
  await refresh.whenIdle();
  assert.equal(reads, 0);
  assert.equal(client.getQueryState(key).isInvalidated, true);
  sessions[0].resolve(true);
  await turn();
  await refresh.whenIdle();
  assert.equal(reads, 1);
  offline = true;
  target.dispatchEvent(new Event('offline'));
  target.dispatchEvent(new Event('focus'));
  await refresh.whenIdle();
  assert.equal(sessions.length, 1);
  offline = false;
  target.dispatchEvent(new Event('online'));
  sessions[1].resolve(true);
  await turn();
  await refresh.whenIdle();
  assert.equal(reads, 2);
  ready();
  assert.equal(sessions.length, 3);
  assert.equal(reads, 2);
  sessions[2].resolve(true);
  await turn();
  await refresh.whenIdle();
  assert.equal(reads, 3);
  target.dispatchEvent(new Event('focus'));
  current = false;
  sessions[3].resolve(true);
  await turn();
  await refresh.whenIdle();
  assert.equal(reads, 3);
  assert.equal(client.getQueryState(key).isInvalidated, true);
  cleanup();
  refresh.dispose();
  unsubscribe();
  client.clear();
  assert.equal(unsubscribed, true);
});

for (const outcome of ['failed', 'signed-out', 'offline', 'disposed', 'superseded']) {
  test(`recovery stays stale after ${outcome} session check`, async () => {
    const calls = [];
    const checks = [];
    const target = new EventTarget();
    let online = true;
    const cleanup = installBoardResourceRecovery(
      {
        setOnline: (value) => calls.push(value),
        mutationCommitted: () => undefined,
      },
      {
        target,
        online: () => online,
        current: () => true,
        authenticate: () => {
          const check = deferred();
          checks.push(check);
          return check.promise;
        },
      },
    );
    if (outcome === 'offline') {
      online = false;
      target.dispatchEvent(new Event('offline'));
    }
    if (outcome === 'disposed') cleanup();
    if (outcome === 'superseded') target.dispatchEvent(new Event('focus'));
    if (outcome === 'failed') checks[0].reject(new Error('Synthetic session unavailable'));
    else checks[0].resolve(outcome !== 'signed-out');
    await turn();
    assert.equal(calls.includes(true), false);
    if (outcome === 'superseded') {
      checks[1].resolve(true);
      await turn();
      assert.equal(calls.filter(Boolean).length, 1);
    }
    cleanup();
    const count = checks.length;
    target.dispatchEvent(new Event('focus'));
    assert.equal(checks.length, count);
  });
}

test('offline recovery cancels in-flight relational reads and retains downloaded data as stale', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const key = boardResourceQueryKey(scope, 'comments');
  client.setQueryData(key, 'downloaded');
  const response = deferred();
  const reached = deferred();
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async ({ signal }) => {
      reached.resolve(signal);
      return response.promise;
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const refresh = new BoardResourceRefresh(client, scope);
  refresh.mutationCommitted(['comments']);
  const signal = await reached.promise;
  refresh.setOnline(false);
  response.resolve('late');
  await refresh.whenIdle();
  assert.equal(signal.aborted, true);
  assert.equal(client.getQueryData(key), 'downloaded');
  assert.equal(client.getQueryState(key).isInvalidated, true);
  unsubscribe();
  refresh.dispose();
  client.clear();
});
