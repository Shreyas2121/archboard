import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  CLIENT_EVENT_NAMES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  HELLO_TIMEOUT_MS,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_WS_FRAME_BYTES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  WS_PING_INTERVAL_MS,
  WS_PONG_TIMEOUT_MS,
  parseClientFrame,
  serverMessageSchema,
  type ErrorCode,
} from '@archboard/contracts';
import { Inject } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer as NestWebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import WebSocket from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { BoardPermissionService } from '../../../boards/application/index.js';
import {
  CollaborationRoomRegistry,
  RoomAdmissionError,
  type RoomReservation,
} from '../../application/room-registry.js';
import { RoomLoadError } from '../room/postgres-room-loader.js';

const CLOSE_POLICY_VIOLATION = 1008;
const READY_LIMITS = {
  maxClientUpdateBytes: MAX_CLIENT_UPDATE_BYTES,
  maxEncodedYjsStateBytes: MAX_ENCODED_YJS_STATE_BYTES,
  maxWebSocketFrameBytes: MAX_WS_FRAME_BYTES,
  maxLiveNodes: MAX_LIVE_NODES,
  maxLiveEdges: MAX_LIVE_EDGES,
  maxLiveBoundaries: MAX_LIVE_BOUNDARIES,
  maxLivePresentationSteps: MAX_LIVE_PRESENTATION_STEPS,
  maxPresenceSelectedIds: MAX_PRESENCE_SELECTED_IDS,
} as const;

export interface AuthorizedBoardSocket {
  readonly boardId: string;
  readonly userId: string;
}

interface ConnectionState extends AuthorizedBoardSocket {
  readonly connectionId: string;
  readonly helloDeadline: NodeJS.Timeout;
  readonly liveness: NodeJS.Timeout;
  lastPongAt: number;
  joining: boolean;
  ready: boolean;
  closed: boolean;
  reservation?: RoomReservation;
  unsubscribe?: () => void;
}

// The adapter creates a noServer ws instance; the authenticated upgrade broker matches dynamic IDs.
@WebSocketGateway({ path: '/ws/boards/:boardId' })
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @NestWebSocketServer()
  public server!: WebSocketServer;

  private readonly contexts = new WeakMap<IncomingMessage, AuthorizedBoardSocket>();
  private readonly connections = new Map<WebSocket, ConnectionState>();

  public constructor(
    @Inject(CollaborationRoomRegistry) private readonly rooms: CollaborationRoomRegistry,
    @Inject(BoardPermissionService) private readonly permissions: BoardPermissionService,
  ) {}

  public acceptUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: AuthorizedBoardSocket,
  ): void {
    this.contexts.set(request, context);
    this.server.handleUpgrade(request, socket, head, (websocket) => {
      this.server.emit('connection', websocket, request);
    });
  }

  public handleConnection(websocket: WebSocket, request: IncomingMessage): void {
    const context = this.contexts.get(request);
    this.contexts.delete(request);
    if (context === undefined) {
      websocket.terminate();
      return;
    }
    const helloDeadline = setTimeout(() => {
      websocket.close(CLOSE_POLICY_VIOLATION, 'Hello required');
    }, HELLO_TIMEOUT_MS);
    const state: ConnectionState = {
      ...context,
      connectionId: randomUUID(),
      helloDeadline,
      liveness: setInterval(() => {
        if (Date.now() - state.lastPongAt > WS_PONG_TIMEOUT_MS) {
          websocket.terminate();
        } else if (websocket.readyState === WebSocket.OPEN) {
          websocket.ping();
        }
      }, WS_PING_INTERVAL_MS),
      lastPongAt: Date.now(),
      joining: false,
      ready: false,
      closed: false,
    };
    helloDeadline.unref();
    state.liveness.unref();
    this.connections.set(websocket, state);
    websocket.on('pong', () => {
      state.lastPongAt = Date.now();
    });
    websocket.on('error', () => undefined);
    websocket.on('message', (raw, isBinary) => {
      this.onMessage(websocket, state, raw, isBinary);
    });
  }

  public handleDisconnect(websocket: WebSocket): void {
    const state = this.connections.get(websocket);
    if (state === undefined) return;
    state.closed = true;
    clearTimeout(state.helloDeadline);
    clearInterval(state.liveness);
    state.unsubscribe?.();
    state.reservation?.release();
    this.connections.delete(websocket);
  }

  private onMessage(
    websocket: WebSocket,
    state: ConnectionState,
    raw: RawData,
    isBinary: boolean,
  ): void {
    const bytes = this.frameBytes(raw);
    if (isBinary || bytes === undefined) {
      websocket.close(CLOSE_POLICY_VIOLATION, 'Invalid client envelope');
      return;
    }
    let message: ReturnType<typeof parseClientFrame>;
    try {
      message = parseClientFrame(bytes);
    } catch {
      if (this.isUnsupportedHello(bytes)) {
        this.sendError(websocket, ERROR_CODES.SCHEMA_UNSUPPORTED, false);
      }
      websocket.close(CLOSE_POLICY_VIOLATION, 'Invalid client envelope');
      return;
    }
    if (!state.ready) {
      if (message.event !== CLIENT_EVENT_NAMES.HELLO || state.joining) {
        websocket.close(CLOSE_POLICY_VIOLATION, 'Hello required');
        return;
      }
      state.joining = true;
      clearTimeout(state.helloDeadline);
      void this.join(websocket, state);
      return;
    }
    if (message.event === CLIENT_EVENT_NAMES.HELLO) {
      websocket.close(CLOSE_POLICY_VIOLATION, 'Hello already received');
      return;
    }
    this.sendError(
      websocket,
      ERROR_CODES.SERVER_BUSY,
      true,
      message.event === CLIENT_EVENT_NAMES.UPDATE ? message.data.updateId : undefined,
    );
  }

  private async join(websocket: WebSocket, state: ConnectionState): Promise<void> {
    try {
      const firstDecision = await this.permissions.read(state.boardId, state.userId);
      if (!firstDecision.allowed) {
        this.sendError(websocket, ERROR_CODES.NOT_FOUND, false);
        websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
        return;
      }
      const reservation = await this.rooms.reserve(state.boardId);
      state.reservation = reservation;
      await reservation.room.run(async () => {
        if (state.closed) return;
        const decision = await this.permissions.read(state.boardId, state.userId);
        if (!decision.allowed) {
          this.sendError(websocket, ERROR_CODES.NOT_FOUND, false);
          websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
          return;
        }
        const subscription = reservation.room.subscribe((update) => {
          this.send(websocket, {
            event: SERVER_EVENT_NAMES.UPDATE,
            data: update,
          });
        });
        state.unsubscribe = subscription.unsubscribe;
        const snapshotBase64 = Buffer.from(
          Y.encodeStateAsUpdate(reservation.room.document),
        ).toString('base64');
        const ready = serverMessageSchema.parse({
          event: SERVER_EVENT_NAMES.READY,
          data: {
            role: decision.role,
            latestSeq: reservation.room.latestSeq,
            snapshotBase64,
            connectionId: state.connectionId,
            limits: READY_LIMITS,
          },
        });
        websocket.send(JSON.stringify(ready), (error) => {
          if (error != null || state.closed) {
            websocket.terminate();
            return;
          }
          state.ready = true;
          subscription.activate();
          if (decision.board.archivedAt !== null) {
            this.send(websocket, {
              event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
              data: { role: decision.role, archived: true },
            });
          }
        });
      });
    } catch (error) {
      const code =
        error instanceof RoomAdmissionError || error instanceof RoomLoadError
          ? error.code
          : ERROR_CODES.SERVER_BUSY;
      this.sendError(
        websocket,
        code,
        code === ERROR_CODES.SERVER_BUSY || code === ERROR_CODES.ROOM_FULL,
      );
      websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
    }
  }

  private send(websocket: WebSocket, message: unknown): void {
    if (websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(JSON.stringify(serverMessageSchema.parse(message)));
  }

  private sendError(
    websocket: WebSocket,
    code: ErrorCode,
    retryable: boolean,
    updateId?: string,
  ): void {
    this.send(websocket, {
      event: SERVER_EVENT_NAMES.ERROR,
      data: {
        code,
        message: 'Collaboration request unavailable.',
        retryable,
        ...(updateId === undefined ? {} : { updateId }),
      },
    });
  }

  private frameBytes(raw: RawData): Uint8Array | undefined {
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (Array.isArray(raw)) return Buffer.concat(raw);
    return undefined;
  }

  private isUnsupportedHello(bytes: Uint8Array): boolean {
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
      if (
        typeof value !== 'object' ||
        value === null ||
        !('event' in value) ||
        value.event !== CLIENT_EVENT_NAMES.HELLO ||
        !('data' in value) ||
        typeof value.data !== 'object' ||
        value.data === null
      )
        return false;
      const data = value.data as Record<string, unknown>;
      return (
        ('protocolVersion' in data && data.protocolVersion !== PROTOCOL_VERSION) ||
        ('schemaVersion' in data && data.schemaVersion !== GRAPH_SCHEMA_VERSION)
      );
    } catch {
      return false;
    }
  }
}
