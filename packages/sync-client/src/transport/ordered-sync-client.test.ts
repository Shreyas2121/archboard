import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_WS_FRAME_BYTES,
  ERROR_CODES,
  RECONNECT_INITIAL_DELAY_MS,
} from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';
import * as Y from 'yjs';

import {
  LocalPersistenceAdapter,
  LOCAL_PERSISTENCE_PHASES,
} from '../persistence/local-persistence-adapter.js';
import { OrderedSyncClient } from './ordered-sync-client.js';

const BACKLOG_SIZE = 128;
const PAYLOAD_BYTES = 512;
const WS_OPEN = 1;
const WS_CLOSED = 3;
const RETRY_FACTOR = 2;
const limits = {
  maxClientUpdateBytes: MAX_CLIENT_UPDATE_BYTES,
  maxEncodedYjsStateBytes: MAX_ENCODED_YJS_STATE_BYTES,
  maxWebSocketFrameBytes: MAX_WS_FRAME_BYTES,
  maxLiveNodes: MAX_LIVE_NODES,
  maxLiveEdges: MAX_LIVE_EDGES,
  maxLiveBoundaries: MAX_LIVE_BOUNDARIES,
  maxLivePresentationSteps: MAX_LIVE_PRESENTATION_STEPS,
  maxPresenceSelectedIds: MAX_PRESENCE_SELECTED_IDS,
};

class Socket {
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public readonly sent: string[] = [];
  public send(value: string): void {
    this.sent.push(value);
  }
  public close(): void {
    this.readyState = WS_CLOSED;
    this.onclose?.();
  }
  public deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pendingHarness(byteLength = PAYLOAD_BYTES) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('WebSocket', { OPEN: WS_OPEN, CLOSED: WS_CLOSED });
  const document = createGraphDocument();
  const namespace = {
    deploymentOrigin: 'https://example.test',
    userId: 'sync-user',
    boardId: crypto.randomUUID(),
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
  };
  const adapter = LocalPersistenceAdapter.create({ namespace, document });
  const record = {
    namespace: 'test',
    localSequence: 1,
    updateId: crypto.randomUUID(),
    updateBytes: new Uint8Array(byteLength).fill(1),
    payloadHash: new Uint8Array(),
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
  };
  const backlog = [record];
  vi.spyOn(adapter, 'initialize').mockResolvedValue();
  vi.spyOn(adapter, 'whenIdle').mockResolvedValue();
  vi.spyOn(adapter, 'subscribe').mockReturnValue(() => {});
  vi.spyOn(adapter, 'getSnapshot').mockReturnValue({
    phase: LOCAL_PERSISTENCE_PHASES.SAVED,
    savedOnDevice: true,
    editingPaused: false,
    pendingWrites: 0,
    errorCode: null,
    diagnostic: null,
  });
  vi.spyOn(adapter, 'lastReceivedServerSequence').mockResolvedValue('0');
  vi.spyOn(adapter, 'applyRemoteAndPersist').mockResolvedValue();
  vi.spyOn(adapter, 'countPendingUpdates').mockImplementation(async () => backlog.length);
  vi.spyOn(adapter, 'oldestPendingUpdate').mockImplementation(async () => backlog[0] ?? null);
  const acknowledge = vi.spyOn(adapter, 'acknowledgeUpdate').mockImplementation(async () => {
    backlog.shift();
  });
  const sockets: Socket[] = [];
  const client = new OrderedSyncClient({
    boardId: namespace.boardId,
    tabId: crypto.randomUUID(),
    webSocketOrigin: 'wss://example.test',
    persistence: adapter,
    random: () => 0,
    createWebSocket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  async function ready() {
    const socket = sockets.at(-1)!;
    socket.readyState = WS_OPEN;
    socket.onopen?.();
    socket.deliver({
      event: 'ready',
      data: {
        role: 'editor',
        latestSeq: '0',
        snapshotBase64: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(document))),
        connectionId: crypto.randomUUID(),
        limits,
      },
    });
    await client.whenIdle();
    return socket;
  }
  return { client, record, backlog, sockets, document, ready, acknowledge };
}

it.each([
  ERROR_CODES.SERVER_BUSY,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.ROOM_FULL,
  ERROR_CODES.PERSISTENCE_FAILED,
])('backs off repeated %s after ready without altering FIFO bytes or IDs', async (code) => {
  vi.useFakeTimers();
  const h = pendingHarness();
  const expectedBytes = h.record.updateBytes.slice();
  try {
    await h.client.start();
    let socket = await h.ready();
    let delay = RECONNECT_INITIAL_DELAY_MS;
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const sent = JSON.parse(socket.sent.at(-1)!);
      expect(sent.data.updateId).toBe(h.record.updateId);
      expect(
        Uint8Array.from(atob(sent.data.updateBase64), (character) => character.charCodeAt(0)),
      ).toEqual(expectedBytes);
      socket.deliver({
        event: 'error',
        data: { code, retryable: true, message: 'Synthetic overload', updateId: h.record.updateId },
      });
      await h.client.whenIdle();
      const before = h.sockets.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.sockets).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.sockets).toHaveLength(before + 1);
      socket = await h.ready();
      delay *= RETRY_FACTOR;
    }
    expect(h.acknowledge).not.toHaveBeenCalled();
    expect(h.backlog).toEqual([h.record]);
    expect(h.record.updateBytes).toEqual(expectedBytes);
    socket.deliver({ event: 'ack', data: { updateId: h.record.updateId, seq: '1' } });
    await h.client.whenIdle();
    expect(h.acknowledge).toHaveBeenCalledOnce();
  } finally {
    h.client.stop();
    h.document.destroy();
  }
});

it('pauses an oversized pending update before allocating its base64 and keeps the complete recovery record', async () => {
  const h = pendingHarness(MAX_CLIENT_UPDATE_BYTES + 1);
  const encode = vi.spyOn(globalThis, 'btoa');
  try {
    await h.client.start();
    const socket = await h.ready();
    expect(socket.sent.map((frame) => JSON.parse(frame).event)).toEqual(['hello']);
    expect(h.client.getSnapshot().errorCode).toBe(ERROR_CODES.DOCUMENT_LIMIT);
    expect(h.backlog[0]?.updateBytes.byteLength).toBe(MAX_CLIENT_UPDATE_BYTES + 1);
    // Only the tiny synthetic ready snapshot was encoded by the test helper.
    expect(encode).toHaveBeenCalledOnce();
    expect(h.acknowledge).not.toHaveBeenCalled();
  } finally {
    h.client.stop();
    h.document.destroy();
  }
});

describe('focused ordered sync reads', () => {
  it('drains exact FIFO payloads with one selected-record read per send and direct duplicate ACK lookup', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('WebSocket', { OPEN: WS_OPEN, CLOSED: WS_CLOSED });
    const document = createGraphDocument();
    const namespace = {
      deploymentOrigin: 'https://example.test',
      userId: 'sync-user',
      boardId: crypto.randomUUID(),
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    };
    const adapter = LocalPersistenceAdapter.create({ namespace, document });
    const backlog = Array.from({ length: BACKLOG_SIZE }, (_, index) => ({
      namespace: 'test',
      localSequence: index + 1,
      updateId: crypto.randomUUID(),
      updateBytes: new Uint8Array(PAYLOAD_BYTES).fill(index),
      payloadHash: new Uint8Array(),
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    }));
    const originals = [...backlog];
    const receipts = new Map<
      string,
      {
        namespace: string;
        updateId: string;
        localSequence: number;
        serverSequence: string;
        acknowledgedAt: string;
      }
    >();
    vi.spyOn(adapter, 'initialize').mockResolvedValue();
    vi.spyOn(adapter, 'whenIdle').mockResolvedValue();
    vi.spyOn(adapter, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(adapter, 'getSnapshot').mockReturnValue({
      phase: LOCAL_PERSISTENCE_PHASES.SAVED,
      savedOnDevice: true,
      editingPaused: false,
      pendingWrites: 0,
      errorCode: null,
      diagnostic: null,
    });
    vi.spyOn(adapter, 'lastReceivedServerSequence').mockResolvedValue('0');
    vi.spyOn(adapter, 'applyRemoteAndPersist').mockResolvedValue();
    const count = vi
      .spyOn(adapter, 'countPendingUpdates')
      .mockImplementation(async () => backlog.length);
    const oldest = vi
      .spyOn(adapter, 'oldestPendingUpdate')
      .mockImplementation(async () => backlog[0] ?? null);
    const receipt = vi
      .spyOn(adapter, 'acknowledgedUpdate')
      .mockImplementation(async (id) => receipts.get(id) ?? null);
    const bulk = vi
      .spyOn(adapter, 'listTransportEligibleUpdates')
      .mockRejectedValue(new Error('bulk read forbidden'));
    const allReceipts = vi
      .spyOn(adapter, 'listAcknowledgedUpdates')
      .mockRejectedValue(new Error('receipt scan forbidden'));
    vi.spyOn(adapter, 'acknowledgeUpdate').mockImplementation(async (id, sequence) => {
      const first = backlog.shift()!;
      expect(first.updateId).toBe(id);
      receipts.set(id, {
        namespace: 'test',
        updateId: id,
        localSequence: first.localSequence,
        serverSequence: sequence,
        acknowledgedAt: new Date().toISOString(),
      });
    });
    const socket = new Socket();
    const client = new OrderedSyncClient({
      boardId: namespace.boardId,
      tabId: crypto.randomUUID(),
      webSocketOrigin: 'wss://example.test',
      persistence: adapter,
      createWebSocket: () => socket as unknown as WebSocket,
    });
    try {
      await client.start();
      expect(oldest).not.toHaveBeenCalled();
      expect(count).toHaveBeenCalledTimes(1);
      socket.readyState = WS_OPEN;
      socket.onopen?.();
      socket.deliver({
        event: 'ready',
        data: {
          role: 'editor',
          latestSeq: '0',
          snapshotBase64: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(document))),
          connectionId: crypto.randomUUID(),
          limits,
        },
      });
      await client.whenIdle();
      for (const [index, record] of originals.entries()) {
        const frame = JSON.parse(socket.sent.at(-1)!) as {
          event: string;
          data: { updateId: string; updateBase64: string };
        };
        expect(frame.event).toBe('update');
        expect(frame.data.updateId).toBe(record.updateId);
        expect(
          Uint8Array.from(atob(frame.data.updateBase64), (char) => char.charCodeAt(0)),
        ).toEqual(record.updateBytes);
        socket.deliver({
          event: 'ack',
          data: { updateId: record.updateId, seq: String(index + 1) },
        });
        await client.whenIdle();
      }
      expect(client.getSnapshot().pendingCount).toBe(0);
      expect(oldest).toHaveBeenCalledTimes(BACKLOG_SIZE + 1);
      expect(bulk).not.toHaveBeenCalled();
      socket.deliver({ event: 'ack', data: { updateId: originals[0]!.updateId, seq: '1' } });
      await client.whenIdle();
      expect(receipt).toHaveBeenCalledWith(originals[0]!.updateId);
      expect(allReceipts).not.toHaveBeenCalled();
      expect(socket.readyState).toBe(WS_OPEN);
      const log = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        socket.deliver({
          event: 'ack',
          data: { updateId: originals[0]!.updateId, seq: String(BACKLOG_SIZE) },
        });
        await client.whenIdle();
        expect(socket.readyState).toBe(WS_CLOSED);
      } finally {
        log.mockRestore();
      }
    } finally {
      client.stop();
      document.destroy();
    }
  });
});
