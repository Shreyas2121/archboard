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
  PRESENTER_LEASE_TIMEOUT_MS,
  PRESENCE_UPDATES_PER_SECOND,
  CONTENT_UPDATE_BURST,
  CONTENT_UPDATES_PER_SECOND,
  MAX_WS_FRAME_BYTES,
} from '@archboard/contracts';
import {
  createGraphDocument,
  hydrateGraphDocument,
  tombstonePresentationStep,
} from '@archboard/document-model';
import { allEntityGraphFixture } from '@archboard/fixtures';
import * as Y from 'yjs';
import { jest } from '@jest/globals';
import WebSocket, { type WebSocketServer } from 'ws';

import type { AuthSessionLookup } from '../../../auth/application/index.js';
import { BoardPermissionService } from '../../../boards/application/index.js';
import type { BoardAuthorityState } from '../../../boards/application/permissions/board-permissions.js';
import type { CollaborationUpdateService } from '../../application/collaboration-update-service.js';
import {
  CollaborationRoomRegistry,
  RoomAdmissionError,
  type LoadedRoom,
} from '../../application/room-registry.js';
import { CollaborationGateway } from './collaboration.gateway.js';
import {
  MAX_SOCKET_BUFFERED_BYTES,
  MAX_PENDING_ROOM_UPDATES,
  MAX_AUTHENTICATED_SOCKETS,
} from '../../application/collaboration-limits.js';

const SETTLE_MICROTASKS = 50;
const SESSION_LOOKUP_TIMEOUT_MS = 5_000;
const RECONNECT_SEQUENCE_OFFSET = 2;
const PRESENTER_PEERS = 2;
const TRANSIENT_WINDOW_MS = 1_000;

class TestSocket extends EventEmitter {
  public readyState: number = WebSocket.OPEN;
  public bufferedAmount = 0;
  public failSend = false;
  public autoPong = true;
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
    if (this.autoPong) this.emit('pong');
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
  const acceptUpdate = jest
    .fn<CollaborationUpdateService['accept']>()
    .mockResolvedValue({ sequence: '0', duplicate: true });
  const gateway = new CollaborationGateway(
    rooms,
    permissions,
    { lookup },
    { accept: acceptUpdate } as unknown as CollaborationUpdateService,
    { run: async (work) => work({ isTransactionActive: true }) },
  );
  const sockets: TestSocket[] = [];
  function connect(sendHello = true) {
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
    if (sendHello)
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
    acceptUpdate,
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

  async function ready(h: ReturnType<typeof harness>, count = PRESENTER_PEERS) {
    const sockets = Array.from({ length: count }, () => h.connect());
    await settle();
    for (const socket of sockets) socket.readyCallback?.();
    await h.gateway.drain();
    return sockets;
  }
  async function control(
    h: ReturnType<typeof harness>,
    socket: TestSocket,
    event: string,
    data = {},
  ) {
    socket.emit('message', Buffer.from(JSON.stringify({ event, data })), false);
    await h.gateway.drain();
  }
  const latestPresenter = (socket: TestSocket) =>
    socket.messages.filter((m) => m.event === 'presenter').at(-1)?.data;

  it('reports temporary presenter queue refusal and admits the next control without closing peers', async () => {
    const h = harness();
    try {
      const [holder, peer] = await ready(h);
      await control(h, holder!, 'presenter.acquire');
      const reservation = await h.rooms.reserve(h.boardId);
      try {
        const before = reservation.room.presenter.snapshot();
        jest
          .spyOn(reservation.room, 'run')
          .mockRejectedValueOnce(new RoomAdmissionError(ERROR_CODES.SERVER_BUSY));
        await control(h, holder!, 'presenter.release');
        expect(holder!.messages.at(-1)?.data).toMatchObject({
          code: ERROR_CODES.SERVER_BUSY,
          retryable: true,
        });
        expect(reservation.room.presenter.snapshot()).toEqual(before);
        expect(holder!.websocket.readyState).toBe(WebSocket.OPEN);
        expect(peer!.websocket.readyState).toBe(WebSocket.OPEN);
        await control(h, holder!, 'presenter.release');
        expect(reservation.room.presenter.snapshot().connectionId).toBeNull();
      } finally {
        reservation.release();
      }
    } finally {
      h.cleanup();
    }
  });

  it('enforces content burst/refill independently of dropped excess presence', async () => {
    const h = harness();
    try {
      const [writer, peer] = await ready(h);
      const frame = () => ({
        event: 'update',
        data: { updateId: randomUUID(), updateBase64: 'AQ==' },
      });
      for (let index = 0; index < CONTENT_UPDATE_BURST; index++)
        await control(h, writer!, 'update', frame().data);
      expect(h.acceptUpdate).toHaveBeenCalledTimes(CONTENT_UPDATE_BURST);
      await control(h, writer!, 'update', frame().data);
      expect(writer!.messages.at(-1)?.data.code).toBe(ERROR_CODES.RATE_LIMITED);
      const presence = { cursor: null, selectedIds: [], dragPreview: null };
      for (let index = 0; index <= PRESENCE_UPDATES_PER_SECOND; index++)
        await control(h, writer!, 'presence', presence);
      expect(peer!.messages.filter(({ event }) => event === 'presence')).toHaveLength(
        PRESENCE_UPDATES_PER_SECOND,
      );
      await jest.advanceTimersByTimeAsync(TRANSIENT_WINDOW_MS);
      for (let index = 0; index < CONTENT_UPDATES_PER_SECOND; index++)
        await control(h, writer!, 'update', frame().data);
      expect(h.acceptUpdate).toHaveBeenCalledTimes(
        CONTENT_UPDATE_BURST + CONTENT_UPDATES_PER_SECOND,
      );
    } finally {
      h.cleanup();
    }
  });

  it('bounds authenticated pre-hello sockets without opening rooms or looking up another session', async () => {
    const h = harness();
    try {
      for (let index = 0; index < MAX_AUTHENTICATED_SOCKETS; index++) h.connect(false);
      const excess = h.connect(false);
      expect(excess.messages.at(-1)?.data).toMatchObject({
        code: ERROR_CODES.SERVER_BUSY,
        retryable: true,
      });
      expect(h.lookup).not.toHaveBeenCalled();
      expect(h.rooms.activeRoomCount).toBe(0);
      expect(excess.readyState).toBe(WebSocket.CLOSED);
    } finally {
      h.cleanup();
    }
  });

  it('rejects fragmented oversized frames before concatenation or application work', async () => {
    const h = harness();
    try {
      const [socket] = await ready(h, 1);
      const concatenate = jest.spyOn(Buffer, 'concat');
      const calls = concatenate.mock.calls.length;
      socket!.emit('message', [Buffer.alloc(MAX_WS_FRAME_BYTES), Buffer.alloc(1)], false);
      expect(concatenate.mock.calls).toHaveLength(calls);
      expect(h.acceptUpdate).not.toHaveBeenCalled();
      expect(socket!.readyState).toBe(WebSocket.CLOSING);
      concatenate.mockRestore();
    } finally {
      h.cleanup();
    }
  });

  it('serializes same-account tab contention, rejects unknown committed IDs and leaves graph/sequence untouched', async () => {
    const h = harness();
    try {
      const [a, b] = await ready(h);
      expect(a!.messages[0]?.event).toBe('ready');
      expect(latestPresenter(a!)).toEqual({ connectionId: null, stepId: null, expiresAt: null });
      await Promise.all([control(h, a!, 'presenter.acquire'), control(h, b!, 'presenter.acquire')]);
      const held = latestPresenter(a!);
      expect(held?.connectionId).toBe(a!.messages[0]?.data.connectionId);
      expect(
        b!.messages.some(
          (m) => m.event === 'error' && m.data.code === ERROR_CODES.PRESENTER_DENIED,
        ),
      ).toBe(true);
      await control(h, b!, 'presenter.release');
      await control(h, a!, 'presenter.step', { stepId: randomUUID() });
      expect(latestPresenter(a!)).toEqual(held);
      await control(h, a!, 'presenter.acquire');
      expect(latestPresenter(a!)).toEqual(held);
      const reservation = await h.rooms.reserve(h.boardId);
      expect(reservation.room.latestSeq).toBe('0');
      reservation.release();
      expect(a!.messages.some((m) => m.event === 'ack' || m.event === 'update')).toBe(false);
      await control(h, a!, 'presenter.release');
      expect(latestPresenter(b!)?.connectionId).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it('expires at 30 seconds while the socket is still open and other peers continue ponging', async () => {
    const h = harness();
    try {
      const [a, b] = await ready(h);
      a!.autoPong = false;
      await control(h, a!, 'presenter.acquire');
      await jest.advanceTimersByTimeAsync(PRESENTER_LEASE_TIMEOUT_MS - 1);
      await h.gateway.drain();
      expect(latestPresenter(b!)?.connectionId).not.toBeNull();
      await jest.advanceTimersByTimeAsync(1);
      await h.gateway.drain();
      expect(latestPresenter(b!)?.connectionId).toBeNull();
      expect(a!.readyState).toBe(WebSocket.OPEN);
    } finally {
      h.cleanup();
    }
  });

  it('selects only committed live steps without changing Yjs bytes, and clears a deleted active step', async () => {
    const h = harness(async () => ({
      document: hydrateGraphDocument(allEntityGraphFixture),
      latestSeq: '0',
      compactedSeq: '0',
    }));
    try {
      const [a, b] = await ready(h);
      const reservation = await h.rooms.reserve(h.boardId);
      const original = Y.encodeStateAsUpdate(reservation.room.document);
      const stepId = allEntityGraphFixture.steps[0]!.id;
      await control(h, a!, 'presenter.acquire');
      await control(h, a!, 'presenter.step', { stepId });
      expect(latestPresenter(b!)?.stepId).toBe(stepId);
      expect(Y.encodeStateAsUpdate(reservation.room.document)).toEqual(original);
      const candidate = hydrateGraphDocument(allEntityGraphFixture);
      tombstonePresentationStep(candidate, stepId);
      await reservation.room.run(async () =>
        reservation.room.installCommittedCandidate(candidate, '1'),
      );
      await h.gateway.resourcesChanged(h.boardId, ['metadata']);
      expect(latestPresenter(b!)?.stepId).toBeNull();
      expect(latestPresenter(b!)?.connectionId).toBe(a!.messages[0]?.data.connectionId);
      reservation.release();
    } finally {
      h.cleanup();
    }
  });

  it('sends current lease only after ready activation, including a lease acquired during pending ready', async () => {
    const h = harness();
    try {
      const [holder] = await ready(h, 1);
      const joining = h.connect();
      await settle();
      await control(h, holder!, 'presenter.acquire');
      expect(joining.messages.map((message) => message.event)).toEqual(['ready']);
      joining.readyCallback?.();
      await h.gateway.drain();
      expect(latestPresenter(joining)?.connectionId).toBe(holder!.messages[0]?.data.connectionId);
      expect(joining.messages.map((message) => message.event)).toEqual(['ready', 'presenter']);
    } finally {
      h.cleanup();
    }
  });

  it('denies viewer controls and bounds transient bursts without graph ACKs', async () => {
    const h = harness();
    try {
      const [socket] = await ready(h, 1);
      h.change({ memberRole: 'viewer' });
      await control(h, socket!, 'presenter.acquire');
      expect(
        socket!.messages.some(
          (message) => message.event === 'error' && message.data.code === ERROR_CODES.FORBIDDEN,
        ),
      ).toBe(true);
      expect(latestPresenter(socket!)?.connectionId).toBeNull();
      h.change({ memberRole: 'editor' });
      await jest.advanceTimersByTimeAsync(TRANSIENT_WINDOW_MS);
      for (let index = 0; index <= PRESENCE_UPDATES_PER_SECOND; index++)
        await control(h, socket!, 'presenter.acquire');
      expect(socket!.messages.at(-1)?.data.code).toBe(ERROR_CODES.PRESENTER_DENIED);
      expect(socket!.messages.some((message) => message.event === 'ack')).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it('renews only through holder pong and clears admission/shutdown state', async () => {
    const h = harness();
    try {
      const [a, b] = await ready(h);
      await control(h, a!, 'presenter.acquire');
      const original = latestPresenter(b!)?.expiresAt;
      await jest.advanceTimersByTimeAsync(PRESENTER_LEASE_TIMEOUT_MS);
      await h.gateway.drain();
      expect(latestPresenter(b!)?.connectionId).toBe(a!.messages[0]?.data.connectionId);
      expect(latestPresenter(b!)?.expiresAt).not.toBe(original);
      h.gateway.stopAdmission();
      await h.gateway.drain();
      const reservation = await h.rooms.reserve(h.boardId);
      expect(reservation.room.presenter.snapshot().connectionId).toBeNull();
      reservation.release();
    } finally {
      h.cleanup();
    }
  });

  it.each(['viewer', 'archive', 'disconnect', 'session'] as const)(
    'clears the holder after %s',
    async (cause) => {
      const h = harness();
      try {
        const [a, b] = await ready(h);
        await control(h, a!, 'presenter.acquire');
        if (cause === 'viewer') {
          h.change({ memberRole: 'viewer' });
          await h.gateway.accessChanged(h.boardId);
        }
        if (cause === 'archive') {
          h.change({ archivedAt: new Date() });
          await h.gateway.accessChanged(h.boardId);
        }
        if (cause === 'disconnect') h.gateway.handleDisconnect(a!.websocket);
        if (cause === 'session') {
          h.lookup.mockResolvedValueOnce(null);
          a!.emit('pong');
        }
        await h.gateway.drain();
        if (cause !== 'session') expect(latestPresenter(b!)?.connectionId).toBeNull();
        const reservation = await h.rooms.reserve(h.boardId);
        expect(reservation.room.presenter.snapshot().connectionId).toBeNull();
        reservation.release();
      } finally {
        h.cleanup();
      }
    },
  );

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
