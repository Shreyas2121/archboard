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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
