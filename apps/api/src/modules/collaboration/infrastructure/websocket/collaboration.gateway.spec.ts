import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_BOARD_CONNECTIONS,
  PROTOCOL_VERSION,
  ROOM_IDLE_EVICTION_MS,
  WS_PING_INTERVAL_MS,
} from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import WebSocket, { type WebSocketServer } from 'ws';

import type { AuthSessionLookup } from '../../../auth/application/index.js';
import { BoardPermissionService } from '../../../boards/application/index.js';
import type { BoardAuthorityState } from '../../../boards/application/permissions/board-permissions.js';
import type { CollaborationUpdateService } from '../../application/collaboration-update-service.js';
import { CollaborationRoomRegistry, type LoadedRoom } from '../../application/room-registry.js';
import { CollaborationGateway } from './collaboration.gateway.js';
import {
  MAX_SOCKET_BUFFERED_BYTES,
  MAX_PENDING_ROOM_UPDATES,
} from '../../application/collaboration-limits.js';

const SETTLE_MICROTASKS = 50;
const SESSION_LOOKUP_TIMEOUT_MS = 5_000;
const RECONNECT_SEQUENCE_OFFSET = 2;

class TestSocket extends EventEmitter {
  public readyState: number = WebSocket.OPEN;
  public bufferedAmount = 0;
  public failSend = false;
  public messages: { event: string; data: Record<string, unknown> }[] = [];
  public readyCallback?: (error?: Error) => void;
  public send(message: string, callback?: (error?: Error) => void): void {
    if (this.failSend) throw new Error('Socket failed');
    this.messages.push(JSON.parse(message));
    if (JSON.parse(message).event === 'ready' && callback !== undefined)
      this.readyCallback = callback;
    else callback?.();
  }
  public close(): void {
    this.readyState = WebSocket.CLOSING;
  }
  public terminate(): void {
    this.readyState = WebSocket.CLOSED;
  }
  public ping(): void {
    this.emit('pong');
  }
  public get websocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function settle() {
  for (let index = 0; index < SETTLE_MICROTASKS; index += 1) await Promise.resolve();
}

function harness(load?: () => Promise<LoadedRoom>) {
  const boardId = randomUUID();
  const userId = randomUUID();
  let authority: BoardAuthorityState | null = {
    id: boardId,
    ownerUserId: randomUUID(),
    memberRole: 'editor',
    archivedAt: null,
    metadataVersion: 1,
    latestSeq: '0',
  };
  const rooms = new CollaborationRoomRegistry({
    load:
      load ??
      (async () => ({
        document: createGraphDocument(),
        latestSeq: '0',
        compactedSeq: '0',
      })),
  });
  const lookup = jest.fn<AuthSessionLookup['lookup']>().mockResolvedValue({
    userId,
    user: { id: userId, name: 'Reader', email: 'reader@example.com', image: null },
  });
  const permissions = new BoardPermissionService({
    read: async () => authority,
    lock: async () => authority,
  });
  const gateway = new CollaborationGateway(
    rooms,
    permissions,
    { lookup },
    {} as CollaborationUpdateService,
    { run: async (work) => work({ isTransactionActive: true }) },
  );
  const sockets: TestSocket[] = [];
  function connect() {
    const socket = new TestSocket();
    sockets.push(socket);
    const request = { headers: {} } as IncomingMessage;
    gateway.server = {
      handleUpgrade: (
        _request: IncomingMessage,
        _socket: Duplex,
        _head: Buffer,
        callback: (socket: WebSocket) => void,
      ) => callback(socket.websocket),
      emit: () => gateway.handleConnection(socket.websocket, request),
    } as unknown as WebSocketServer;
    gateway.acceptUpgrade(request, {} as Duplex, Buffer.alloc(0), {
      boardId,
      userId,
      userName: 'Reader',
    });
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          event: 'hello',
          data: {
            protocolVersion: PROTOCOL_VERSION,
            schemaVersion: GRAPH_SCHEMA_VERSION,
            tabId: randomUUID(),
          },
        }),
      ),
      false,
    );
    return socket;
  }
  async function publish(seq = '1') {
    const reservation = await rooms.reserve(boardId);
    await reservation.room.run(async () => {
      reservation.room.publishCommittedUpdate({ seq, updateBase64: 'AQ==' });
    });
    await gateway.drain();
    reservation.release();
  }
  return {
    boardId,
    rooms,
    gateway,
    lookup,
    connect,
    publish,
    change: (value: Partial<BoardAuthorityState> | null) => {
      authority = value === null ? null : { ...authority!, ...value };
    },
    cleanup: () => {
      for (const socket of sockets) gateway.handleDisconnect(socket.websocket);
      rooms.evictIdle(Date.now() + ROOM_IDLE_EVICTION_MS);
    },
  };
}

describe('collaboration connection authority and admission', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(['slow', 'failed'] as const)(
    'detaches a %s sender while healthy readers receive every commit',
    async (failure) => {
      const h = harness();
      try {
        const bad = h.connect();
        const healthy = h.connect();
        await settle();
        bad.readyCallback?.();
        healthy.readyCallback?.();
        await settle();
        if (failure === 'slow') bad.bufferedAmount = MAX_SOCKET_BUFFERED_BYTES;
        else bad.failSend = true;
        await h.publish('1');
        await h.publish('2');
        expect(bad.readyState).toBe(WebSocket.CLOSED);
        expect(h.rooms.connectionCount(h.boardId)).toBe(1);
        expect(
          healthy.messages
            .filter((message) => message.event === 'update')
            .map((message) => message.data.seq),
        ).toEqual(['1', '2']);
      } finally {
        h.cleanup();
      }
    },
  );

  it('bounds a held ready subscription while a healthy reader receives the entire stream', async () => {
    const h = harness();
    try {
      const slow = h.connect();
      const healthy = h.connect();
      await settle();
      healthy.readyCallback?.();
      await settle();
      for (let index = 0; index <= MAX_PENDING_ROOM_UPDATES; index += 1)
        await h.publish(String(index + 1));
      expect(slow.readyState).toBe(WebSocket.CLOSED);
      expect(h.rooms.connectionCount(h.boardId)).toBe(1);
      slow.readyCallback?.();
      await settle();
      expect(slow.messages.filter((message) => message.event === 'update')).toHaveLength(0);
      expect(healthy.messages.filter((message) => message.event === 'update')).toHaveLength(
        MAX_PENDING_ROOM_UPDATES + 1,
      );
      const reconnect = h.connect();
      await settle();
      reconnect.readyCallback?.();
      await settle();
      await h.publish(String(MAX_PENDING_ROOM_UPDATES + RECONNECT_SEQUENCE_OFFSET));
      expect(reconnect.messages.at(-1)?.event).toBe('update');
    } finally {
      h.cleanup();
    }
  });

  it('releases late reservations after disconnect repeatedly beyond the board cap', async () => {
    const loading = deferred<LoadedRoom>();
    const h = harness(() => loading.promise);
    try {
      for (let index = 0; index <= MAX_BOARD_CONNECTIONS; index += 1) {
        const socket = h.connect();
        await settle();
        h.gateway.handleDisconnect(socket.websocket);
        if (index === 0)
          loading.resolve({ document: createGraphDocument(), latestSeq: '0', compactedSeq: '0' });
        await settle();
        expect(h.rooms.connectionCount(h.boardId)).toBe(0);
        expect(socket.messages.some((message) => message.data.code === ERROR_CODES.ROOM_FULL)).toBe(
          false,
        );
      }
      expect(h.rooms.evictIdle(Date.now() + ROOM_IDLE_EVICTION_MS)).toBe(1);
    } finally {
      h.cleanup();
    }
  });

  it('detaches a revoked joining reader before the ready callback can activate it', async () => {
    const h = harness();
    try {
      const socket = h.connect();
      await settle();
      await h.publish(); // buffered during ready delivery
      h.change(null);
      await h.gateway.accessChanged(h.boardId);
      expect(h.rooms.connectionCount(h.boardId)).toBe(0);
      socket.readyCallback?.();
      await settle();
      await h.publish();
      expect(socket.messages.filter((message) => message.event === 'update')).toHaveLength(0);
    } finally {
      h.cleanup();
    }
  });

  it.each(['demotion', 'archive', 'restore'] as const)(
    'refreshes %s before activating a pending ready',
    async (transition) => {
      const h = harness();
      try {
        if (transition === 'restore') h.change({ archivedAt: new Date() });
        const socket = h.connect();
        await settle();
        await h.publish();
        h.change(
          transition === 'demotion'
            ? { memberRole: 'viewer' }
            : {
                archivedAt: transition === 'archive' ? new Date() : null,
              },
        );
        await h.gateway.accessChanged(h.boardId);
        socket.readyCallback?.();
        await settle();
        const changed = socket.messages.find((message) => message.event === 'access.changed');
        expect(changed?.data).toMatchObject({
          role: transition === 'demotion' ? 'viewer' : 'editor',
          archived: transition === 'archive',
        });
        expect(
          socket.messages.findIndex((message) => message.event === 'access.changed'),
        ).toBeLessThan(socket.messages.findIndex((message) => message.event === 'update'));
      } finally {
        h.cleanup();
      }
    },
  );

  it.each(['revoked', 'expired', 'failure', 'timeout', 'different-user'] as const)(
    'disconnects a responsive reader when session lookup is %s',
    async (failure) => {
      const h = harness();
      try {
        h.change({ memberRole: 'viewer' });
        const socket = h.connect();
        await settle();
        socket.readyCallback?.();
        await settle();
        if (failure === 'failure') h.lookup.mockRejectedValue(new Error('Lookup unavailable'));
        else if (failure === 'timeout')
          h.lookup.mockImplementation(() => new Promise(() => undefined));
        else if (failure === 'different-user')
          h.lookup.mockResolvedValue({
            userId: randomUUID(),
            user: { id: randomUUID(), name: 'Other', email: 'other@example.com', image: null },
          });
        else h.lookup.mockResolvedValue(null);
        await jest.advanceTimersByTimeAsync(WS_PING_INTERVAL_MS + SESSION_LOOKUP_TIMEOUT_MS);
        expect(socket.readyState).toBe(WebSocket.CLOSING);
        expect(h.rooms.connectionCount(h.boardId)).toBe(0);
        await h.publish();
        expect(socket.messages.filter((message) => message.event === 'update')).toHaveLength(0);
        expect(JSON.stringify(socket.messages)).not.toContain('Lookup unavailable');
      } finally {
        h.cleanup();
      }
    },
  );
});
