import { it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as contracts from '../packages/contracts/dist/index.js';
import { OrderedSyncClient, TransientPresenter } from '../packages/sync-client/dist/index.js';

it('bounds controls and never assumes an acquisition succeeded', () => {
  const sent = [];
  const presenter = new TransientPresenter((message) => {
    sent.push(message);
    return true;
  });
  assert.equal(presenter.acquire(), false);
  presenter.connect(randomUUID());
  assert.equal(presenter.select('bad id'), false);
  assert.equal(presenter.acquire(), true);
  assert.equal(presenter.getSnapshot().connectionId, null);
  presenter.deny();
  assert.equal(presenter.wasDenied(), true);
  presenter.clear();
  assert.equal(presenter.release(), false);
  assert.deepEqual(sent, [{ event: 'presenter.acquire', data: {} }]);
});

it('ordered transport isolates presenter denial from durability and clears old connection events', async () => {
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const oldWindow = globalThis.window;
  const oldSocket = globalThis.WebSocket;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.WebSocket = Socket;
  const writes = [];
  const socket = new Socket();
  const persistence = {
    initialize: async () => {},
    whenIdle: async () => {},
    subscribe: () => () => {},
    lastReceivedServerSequence: async () => '0',
    countPendingUpdates: async () => 0,
    oldestPendingUpdate: async () => null,
    applyRemoteAndPersist: async (...args) => writes.push(args),
    getSnapshot: () => ({ phase: 'saved', savedOnDevice: true, errorCode: null }),
  };
  const client = new OrderedSyncClient({
    boardId: randomUUID(),
    tabId: randomUUID(),
    webSocketOrigin: 'ws://localhost',
    persistence,
    createWebSocket: () => socket,
  });
  const deliver = async (event, data) => {
    socket.onmessage({ data: JSON.stringify({ event, data }) });
    await client.whenIdle();
  };
  try {
    await client.start();
    socket.onopen();
    const connectionId = randomUUID();
    const limits = {
      maxClientUpdateBytes: contracts.MAX_CLIENT_UPDATE_BYTES,
      maxEncodedYjsStateBytes: contracts.MAX_ENCODED_YJS_STATE_BYTES,
      maxWebSocketFrameBytes: contracts.MAX_WS_FRAME_BYTES,
      maxLiveNodes: contracts.MAX_LIVE_NODES,
      maxLiveEdges: contracts.MAX_LIVE_EDGES,
      maxLiveBoundaries: contracts.MAX_LIVE_BOUNDARIES,
      maxLivePresentationSteps: contracts.MAX_LIVE_PRESENTATION_STEPS,
      maxPresenceSelectedIds: contracts.MAX_PRESENCE_SELECTED_IDS,
    };
    await deliver('ready', {
      connectionId,
      role: 'editor',
      latestSeq: '0',
      snapshotBase64: 'AQ==',
      limits,
    });
    assert.equal(client.presenter.acquire(), true);
    await deliver('error', { code: 'PRESENTER_DENIED', message: 'Unavailable', retryable: false });
    assert.equal(client.presenter.wasDenied(), true);
    assert.equal(client.getSnapshot().errorCode, null);
    assert.equal(client.getSnapshot().ready, true);
    const held = {
      connectionId,
      stepId: randomUUID(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
    await deliver('presenter', held);
    assert.deepEqual(client.presenter.getSnapshot(), held);
    assert.equal(writes.length, 1); // Only ready hydration; no presenter receipt/outbox write.
    assert.deepEqual(
      socket.sent.map((message) => message.event),
      ['hello', 'presenter.acquire'],
    );
    await deliver('access.changed', { role: 'editor', archived: true });
    assert.equal(client.presenter.getSnapshot().connectionId, null);
    assert.equal(client.presenter.acquire(), false);
    await deliver('access.changed', { role: 'editor', archived: false });
    assert.equal(client.presenter.acquire(), true);
    client.stop();
    await deliver('presenter', held);
    assert.equal(client.presenter.getSnapshot().connectionId, null);
  } finally {
    client.stop();
    globalThis.window = oldWindow;
    globalThis.WebSocket = oldSocket;
  }
});
