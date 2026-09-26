import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_WS_FRAME_BYTES,
} from '@archboard/contracts';
import { createGraphDocument, createNode, projectGraphDocument } from '@archboard/document-model';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SYNC_DATABASE_NAME } from '../config/index.js';
import {
  INDEXEDDB_FAILPOINTS,
  IndexedDbFailpointController,
  LocalPersistenceAdapter,
} from '../persistence/index.js';
import { OrderedSyncClient, SYNC_PHASES } from './ordered-sync-client.js';

const WS_ORIGIN = 'wss://app.archboard.example';
const TWO = 2;
const THREE = 3;
const LIMITS = {
  maxClientUpdateBytes: MAX_CLIENT_UPDATE_BYTES,
  maxEncodedYjsStateBytes: MAX_ENCODED_YJS_STATE_BYTES,
  maxWebSocketFrameBytes: MAX_WS_FRAME_BYTES,
  maxLiveNodes: MAX_LIVE_NODES,
  maxLiveEdges: MAX_LIVE_EDGES,
  maxLiveBoundaries: MAX_LIVE_BOUNDARIES,
  maxLivePresentationSteps: MAX_LIVE_PRESENTATION_STEPS,
  maxPresenceSelectedIds: MAX_PRESENCE_SELECTED_IDS,
};

class FakeSocket {
  public readyState: number = WebSocket.CONNECTING;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public readonly sent: unknown[] = [];

  public open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  public send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  public deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

const adapters: LocalPersistenceAdapter[] = [];
const clients: OrderedSyncClient[] = [];

async function setup(failpoints?: IndexedDbFailpointController) {
  const boardId = crypto.randomUUID();
  const document = createGraphDocument();
  const adapter = await LocalPersistenceAdapter.open({
    namespace: {
      deploymentOrigin: 'https://app.archboard.example',
      userId: 'sync-test-user',
      boardId,
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    },
    document,
    ...(failpoints === undefined ? {} : { failpoints }),
  });
  adapters.push(adapter);
  const sockets: FakeSocket[] = [];
  const client = new OrderedSyncClient({
    boardId,
    tabId: crypto.randomUUID(),
    webSocketOrigin: WS_ORIGIN,
    persistence: adapter,
    createWebSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    random: () => 0,
  });
  clients.push(client);
  await client.start();
  return { boardId, document, adapter, client, sockets };
}

function ready(snapshot: Y.Doc, latestSeq = '0', role = 'editor') {
  return {
    event: 'ready',
    data: {
      role,
      latestSeq,
      snapshotBase64: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(snapshot))),
      connectionId: crypto.randomUUID(),
      limits: LIMITS,
    },
  };
}

function addNode(document: Y.Doc): void {
  createNode(document, {
    id: crypto.randomUUID(),
    kind: 'component',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 140 },
    title: 'Persisted locally',
    color: COLOR_TOKENS.BLUE,
    content: {
      category: COMPONENT_CATEGORIES.SERVICE,
      description: '',
      technology: 'TypeScript',
      externalUrl: null,
    },
  });
}

async function waitForSent(socket: FakeSocket, count: number): Promise<void> {
  await vi.waitFor(() => expect(socket.sent).toHaveLength(count));
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.stop());
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
  await deleteDB(SYNC_DATABASE_NAME);
});

describe('ordered browser WebSocket client', () => {
  it('never sends an edit whose local IndexedDB transaction failed', async () => {
    const failpoints = new IndexedDbFailpointController();
    const { document, adapter, client, sockets } = await setup(failpoints);
    sockets[0]!.open();
    sockets[0]!.deliver(ready(createGraphDocument()));
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.SAVED_TO_SERVER));
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_LOCAL_UPDATE_WRITE);
    addNode(document);
    await adapter.whenIdle();
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.STORAGE_ERROR));
    expect(sockets[0]!.sent).toHaveLength(1);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
  });

  it('replays local IndexedDB work after reload and merges an independent remote edit', async () => {
    const first = await setup();
    addNode(first.document);
    await first.adapter.whenIdle();
    const [queued] = await first.adapter.listTransportEligibleUpdates();
    first.client.stop();
    await first.adapter.close();

    const document = createGraphDocument();
    const adapter = await LocalPersistenceAdapter.open({
      namespace: {
        deploymentOrigin: 'https://app.archboard.example',
        userId: 'sync-test-user',
        boardId: first.boardId,
        graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      },
      document,
    });
    adapters.push(adapter);
    expect(projectGraphDocument(document).nodes).toHaveLength(1);
    const sockets: FakeSocket[] = [];
    const client = new OrderedSyncClient({
      boardId: first.boardId,
      tabId: crypto.randomUUID(),
      webSocketOrigin: WS_ORIGIN,
      persistence: adapter,
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    clients.push(client);
    await client.start();
    sockets[0]!.open();
    const remote = createGraphDocument();
    addNode(remote);
    sockets[0]!.deliver(ready(remote, '1'));
    await waitForSent(sockets[0]!, TWO);
    expect(projectGraphDocument(document).nodes).toHaveLength(TWO);
    expect(sockets[0]!.sent[1]).toEqual({
      event: 'update',
      data: {
        updateId: queued!.updateId,
        updateBase64: btoa(String.fromCharCode(...queued!.updateBytes)),
      },
    });
    sockets[0]!.deliver({ event: 'ack', data: { updateId: queued!.updateId, seq: '2' } });
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.SAVED_TO_SERVER));
    expect(await adapter.lastReceivedServerSequence()).toBe('2');
  });

  it('merges full ready, then drains committed local bytes one at a time', async () => {
    const { document, adapter, client, sockets } = await setup();
    addNode(document);
    addNode(document);
    await adapter.whenIdle();
    const pending = await adapter.listTransportEligibleUpdates();
    expect(pending).toHaveLength(TWO);
    sockets[0]!.open();
    await waitForSent(sockets[0]!, 1);
    expect(sockets[0]!.sent[0]).toMatchObject({ event: 'hello' });
    const server = createGraphDocument();
    addNode(server);
    sockets[0]!.deliver(ready(server));
    await waitForSent(sockets[0]!, TWO);
    expect(projectGraphDocument(document).nodes).toHaveLength(THREE);
    expect(sockets[0]!.sent[1]).toEqual({
      event: 'update',
      data: {
        updateId: pending[0]!.updateId,
        updateBase64: btoa(String.fromCharCode(...pending[0]!.updateBytes)),
      },
    });
    expect(await adapter.lastReceivedServerSequence()).toBe('0');
    sockets[0]!.deliver({ event: 'ack', data: { updateId: pending[0]!.updateId, seq: '1' } });
    await waitForSent(sockets[0]!, THREE);
    expect(sockets[0]!.sent[2]).toMatchObject({ data: { updateId: pending[1]!.updateId } });
    sockets[0]!.deliver({ event: 'ack', data: { updateId: pending[1]!.updateId, seq: '2' } });
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.SAVED_TO_SERVER));
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
  });

  it('retries the identical queued ID and bytes after a lost ACK', async () => {
    const { document, adapter, client, sockets } = await setup();
    addNode(document);
    await adapter.whenIdle();
    sockets[0]!.open();
    sockets[0]!.deliver(ready(createGraphDocument()));
    await waitForSent(sockets[0]!, TWO);
    const firstSend = sockets[0]!.sent[1];
    sockets[0]!.close();
    expect(client.getSnapshot().phase).toBe(SYNC_PHASES.SAVED_ON_DEVICE_OFFLINE);
    client.retryNow();
    sockets[1]!.open();
    sockets[1]!.deliver(ready(createGraphDocument(), '1'));
    await waitForSent(sockets[1]!, TWO);
    expect(sockets[1]!.sent[1]).toEqual(firstSend);
    const id = (firstSend as { data: { updateId: string } }).data.updateId;
    sockets[1]!.deliver({ event: 'ack', data: { updateId: id, seq: '1' } });
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.SAVED_TO_SERVER));
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
  });

  it('reconnects on a broadcast gap and keeps pending local work', async () => {
    const { document, adapter, client, sockets } = await setup();
    addNode(document);
    await adapter.whenIdle();
    sockets[0]!.open();
    sockets[0]!.deliver(ready(createGraphDocument()));
    await waitForSent(sockets[0]!, TWO);
    const update = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(createGraphDocument())));
    sockets[0]!.deliver({ event: 'update', data: { seq: '2', updateBase64: update } });
    await vi.waitFor(() => expect(sockets[0]!.readyState).toBe(WebSocket.CLOSED));
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(1);
    expect(client.getSnapshot().phase).toBe(SYNC_PHASES.SAVED_ON_DEVICE_OFFLINE);
  });

  it('retries CAUSAL_GAP once, then pauses without dropping the queued entry', async () => {
    const { document, adapter, client, sockets } = await setup();
    addNode(document);
    await adapter.whenIdle();
    sockets[0]!.open();
    sockets[0]!.deliver(ready(createGraphDocument()));
    await waitForSent(sockets[0]!, TWO);
    const id = (sockets[0]!.sent[1] as { data: { updateId: string } }).data.updateId;
    sockets[0]!.deliver({
      event: 'error',
      data: { code: ERROR_CODES.CAUSAL_GAP, message: 'Gap', retryable: false, updateId: id },
    });
    await vi.waitFor(() => expect(sockets[0]!.readyState).toBe(WebSocket.CLOSED));
    client.retryNow();
    sockets[1]!.open();
    sockets[1]!.deliver(ready(createGraphDocument()));
    await waitForSent(sockets[1]!, TWO);
    expect(sockets[1]!.sent[1]).toEqual(sockets[0]!.sent[1]);
    sockets[1]!.deliver({
      event: 'error',
      data: { code: ERROR_CODES.CAUSAL_GAP, message: 'Gap', retryable: false, updateId: id },
    });
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.RECOVERY_REQUIRED));
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(1);
  });

  it('freezes dependent sends on a permanent server rejection', async () => {
    const { document, adapter, client, sockets } = await setup();
    addNode(document);
    addNode(document);
    await adapter.whenIdle();
    sockets[0]!.open();
    sockets[0]!.deliver(ready(createGraphDocument()));
    await waitForSent(sockets[0]!, TWO);
    const id = (sockets[0]!.sent[1] as { data: { updateId: string } }).data.updateId;
    sockets[0]!.deliver({
      event: 'error',
      data: {
        code: ERROR_CODES.DOCUMENT_INVALID,
        message: 'Invalid',
        retryable: false,
        updateId: id,
      },
    });
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.RECOVERY_REQUIRED));
    expect(sockets[0]!.sent).toHaveLength(TWO);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(TWO);
  });

  it('preserves queued work when ready grants viewer access', async () => {
    const { document, adapter, client, sockets } = await setup();
    addNode(document);
    await adapter.whenIdle();
    sockets[0]!.open();
    sockets[0]!.deliver(ready(createGraphDocument(), '0', 'viewer'));
    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe(SYNC_PHASES.ACCESS_CHANGED));
    expect(sockets[0]!.sent).toHaveLength(1);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(1);
  });

  it('rejects malformed server envelopes without claiming server save', async () => {
    const { client, sockets } = await setup();
    sockets[0]!.open();
    sockets[0]!.deliver({
      event: 'ready',
      data: { ...ready(createGraphDocument()).data, extra: true },
    });
    await vi.waitFor(() => expect(sockets[0]!.readyState).toBe(WebSocket.CLOSED));
    expect(client.getSnapshot().phase).toBe(SYNC_PHASES.OFFLINE_CACHED);
  });
});
