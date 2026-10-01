import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  BoardResourceRefresh,
  boardResourceQueryKey,
  boardListQueryKey,
} from '../apps/web/src/features/boards/board-resource-refresh.ts';
import { OrderedSyncClient, LOCAL_PERSISTENCE_PHASES } from '../packages/sync-client/dist/index.js';
import { createGraphDocument } from '../packages/document-model/dist/index.js';
import * as Y from '../packages/document-model/node_modules/yjs/dist/yjs.mjs';
import * as LIMITS from '../packages/contracts/dist/index.js';
const { GRAPH_SCHEMA_VERSION, PROTOCOL_VERSION } = LIMITS;

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { QueryClient, QueryObserver } = requireWeb('@tanstack/react-query');
const scope = {
  deploymentOrigin: 'https://example.test',
  accountId: 'account-a',
  boardId: 'board-a',
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function cache() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

test('resource prefixes cover filters/pages and isolate deployments, accounts and boards', async () => {
  const client = cache();
  const matching = [
    [...boardResourceQueryKey(scope, 'comments'), 'threads', { resolved: false }],
    [...boardResourceQueryKey(scope, 'comments'), 'threads', { resolved: true }],
    [...boardResourceQueryKey(scope, 'comments'), 'messages', 'thread-a', 'page-two'],
  ];
  const unrelated = [
    boardResourceQueryKey(scope, 'members'),
    boardResourceQueryKey({ ...scope, boardId: 'other' }, 'comments'),
    boardResourceQueryKey({ ...scope, accountId: 'other' }, 'comments'),
    boardResourceQueryKey({ ...scope, deploymentOrigin: 'https://other.test' }, 'comments'),
  ];
  [...matching, ...unrelated].forEach((key) => client.setQueryData(key, 'cached'));
  const refresh = new BoardResourceRefresh(client, scope);
  refresh.receive({ kind: 'invalidate', boardId: 'other', resource: 'comments' });
  refresh.receive({ kind: 'invalidate', boardId: scope.boardId, resource: 'comments' });
  await refresh.whenIdle();
  matching.forEach((key) => assert.equal(client.getQueryState(key).isInvalidated, true));
  unrelated.forEach((key) => assert.equal(client.getQueryState(key).isInvalidated, false));
  refresh.dispose();
  client.clear();
});

test('bursts coalesce and a hint during a real REST query triggers a final fetch', async () => {
  const client = cache();
  const barrier = deferred();
  const reached = deferred();
  let fetches = 0;
  const key = [...boardResourceQueryKey(scope, 'comments'), 'threads'];
  client.setQueryData(key, 'old');
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      fetches += 1;
      if (fetches === 1) {
        reached.resolve();
        await barrier.promise;
      }
      return `fetched-${fetches}`;
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const refresh = new BoardResourceRefresh(client, scope);
  for (let index = 0; index < 10; index += 1) refresh.mutationCommitted(['comments']);
  await reached.promise;
  refresh.receive({ kind: 'invalidate', boardId: scope.boardId, resource: 'comments' });
  barrier.resolve();
  await refresh.whenIdle();
  assert.equal(fetches, 2);
  assert.equal(client.getQueryData(key), 'fetched-2');
  unsubscribe();
  refresh.dispose();
  client.clear();
});

test('ready/reconnect and local invite success refresh relational views without an invites wire event', async () => {
  const client = cache();
  const resources = ['comments', 'members', 'metadata', 'checkpoints', 'invites'];
  const keys = resources.map((resource) => boardResourceQueryKey(scope, resource));
  const listKey = boardListQueryKey(scope.deploymentOrigin, scope.accountId);
  [...keys, listKey].forEach((key) => client.setQueryData(key, 'old'));
  const refresh = new BoardResourceRefresh(client, scope);
  refresh.receive({ kind: 'ready', boardId: scope.boardId });
  await refresh.whenIdle();
  [...keys, listKey].forEach((key) => assert.equal(client.getQueryState(key).isInvalidated, true));
  [...keys, listKey].forEach((key) => client.setQueryData(key, 'cached-again'));
  refresh.inviteAccepted();
  await refresh.whenIdle();
  ['members', 'metadata', 'invites'].forEach((resource) =>
    assert.equal(client.getQueryState(boardResourceQueryKey(scope, resource)).isInvalidated, true),
  );
  assert.equal(client.getQueryState(boardResourceQueryKey(scope, 'comments')).isInvalidated, false);
  refresh.dispose();
  client.clear();
});

test('failed REST refresh remains stale and offline hints never fetch', async () => {
  const client = cache();
  let fetches = 0;
  const key = boardResourceQueryKey(scope, 'comments');
  client.setQueryData(key, 'old');
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      fetches += 1;
      throw new Error('Unavailable');
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const refresh = new BoardResourceRefresh(client, scope);
  refresh.setOnline(false);
  refresh.mutationCommitted(['comments']);
  await refresh.whenIdle();
  assert.equal(fetches, 0);
  assert.equal(client.getQueryState(key).isInvalidated, true);
  refresh.setOnline(true);
  await refresh.whenIdle();
  assert.equal(fetches, 1);
  assert.equal(client.getQueryState(key).isInvalidated, true);
  assert.equal(client.getQueryState(key).status, 'error');
  unsubscribe();
  refresh.dispose();
  client.clear();
});

test('removal clears only the old scope, cancels late responses and ignores later hints', async () => {
  const client = cache();
  const late = deferred();
  const reached = deferred();
  const oldKey = boardResourceQueryKey(scope, 'comments');
  const nextKey = boardResourceQueryKey({ ...scope, accountId: 'account-b' }, 'comments');
  client.setQueryData(oldKey, 'old');
  client.setQueryData(nextKey, 'next-account');
  const observer = new QueryObserver(client, {
    queryKey: oldKey,
    queryFn: async () => {
      reached.resolve();
      await late.promise;
      return 'late-old';
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const refresh = new BoardResourceRefresh(client, scope);
  refresh.mutationCommitted(['comments']);
  await reached.promise;
  refresh.receive({ kind: 'access', boardId: scope.boardId, role: null });
  late.resolve();
  await refresh.whenIdle();
  refresh.receive({ kind: 'ready', boardId: scope.boardId });
  await refresh.whenIdle();
  assert.equal(client.getQueryData(oldKey), undefined);
  assert.equal(client.getQueryData(nextKey), 'next-account');
  unsubscribe();
  client.clear();
});

test('actual transport invalidation leaves graph bytes, pending count, ACK operations and save status unchanged', async () => {
  const previousWindow = globalThis.window;
  const previousSocket = globalThis.WebSocket;
  globalThis.window = new EventTarget();
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    readyState = 0;
    sent = [];
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    send(value) {
      this.sent.push(value);
    }
    deliver(value) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = Socket;
  const document = createGraphDocument();
  let applies = 0;
  let acknowledgements = 0;
  let pending = 1;
  const localStatus = { phase: LOCAL_PERSISTENCE_PHASES.SAVED, pendingWrites: 0, errorCode: null };
  const persistence = {
    initialize: async () => undefined,
    subscribe: () => () => undefined,
    getSnapshot: () => localStatus,
    whenIdle: async () => undefined,
    countPendingUpdates: async () => pending,
    lastReceivedServerSequence: async () => '0',
    applyRemoteAndPersist: async (bytes) => {
      applies += 1;
      Y.applyUpdate(document, bytes);
    },
    listTransportEligibleUpdates: async () => [],
    acknowledgeUpdate: async () => {
      acknowledgements += 1;
      pending = 0;
    },
  };
  const socket = new Socket();
  const hints = [];
  const boardId = randomUUID();
  const client = new OrderedSyncClient({
    boardId,
    tabId: randomUUID(),
    webSocketOrigin: 'wss://example.test',
    persistence,
    createWebSocket: () => socket,
    canSend: () => false,
  });
  client.resourceEvents.subscribe((event) => hints.push(event));
  try {
    await client.start();
    socket.open();
    socket.deliver({
      event: 'ready',
      data: {
        role: 'editor',
        latestSeq: '0',
        snapshotBase64: Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64'),
        connectionId: randomUUID(),
        limits: {
          maxClientUpdateBytes: LIMITS.MAX_CLIENT_UPDATE_BYTES,
          maxEncodedYjsStateBytes: LIMITS.MAX_ENCODED_YJS_STATE_BYTES,
          maxWebSocketFrameBytes: LIMITS.MAX_WS_FRAME_BYTES,
          maxLiveNodes: LIMITS.MAX_LIVE_NODES,
          maxLiveEdges: LIMITS.MAX_LIVE_EDGES,
          maxLiveBoundaries: LIMITS.MAX_LIVE_BOUNDARIES,
          maxLivePresentationSteps: LIMITS.MAX_LIVE_PRESENTATION_STEPS,
          maxPresenceSelectedIds: LIMITS.MAX_PRESENCE_SELECTED_IDS,
        },
      },
    });
    await client.whenIdle();
    assert.equal(client.getSnapshot().ready, true);
    assert.equal(hints[0].kind, 'ready');
    const before = client.getSnapshot();
    const bytes = Y.encodeStateAsUpdate(document);
    const sent = [...socket.sent];
    socket.deliver({ event: 'invalidate', data: { resource: 'comments' } });
    await client.whenIdle();
    assert.deepEqual(hints.at(-1), { kind: 'invalidate', boardId, resource: 'comments' });
    assert.equal(client.getSnapshot(), before);
    assert.deepEqual(Y.encodeStateAsUpdate(document), bytes);
    assert.equal(applies, 1);
    assert.equal(acknowledgements, 0);
    assert.equal(pending, 1);
    assert.deepEqual(socket.sent, sent);
    assert.equal(JSON.parse(socket.sent[0]).data.protocolVersion, PROTOCOL_VERSION);
    assert.equal(GRAPH_SCHEMA_VERSION, 1);
  } finally {
    client.stop();
    document.destroy();
    globalThis.window = previousWindow;
    globalThis.WebSocket = previousSocket;
  }
});
