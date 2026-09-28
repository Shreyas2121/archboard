import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  CLIENT_EVENT_NAMES,
  COLOR_TOKENS,
  PRESENCE_EXPIRY_MS,
  PRESENCE_UPDATES_PER_SECOND,
  MAX_PRESENCE_USER_NAME_CHARACTERS,
  type PresenceState,
  type ServerPresenceMessage,
  CONTENT_UPDATE_BURST,
  CONTENT_UPDATES_PER_SECOND,
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
import { fromNodeHeaders } from 'better-auth/node';
import * as Y from 'yjs';

import { BoardPermissionService } from '../../../boards/application/index.js';
import { AUTH_SESSION_LOOKUP, type AuthSessionLookup } from '../../../auth/application/index.js';
import { CollaborationUpdateService } from '../../application/collaboration-update-service.js';
import { reportCollaborationMetric } from '../../application/collaboration-metrics.js';
import {
  DurableUpdateRejectedError,
  InjectedPostCommitCrashError,
} from '../../application/durable-update.js';
import {
  CollaborationRoomRegistry,
  RoomAdmissionError,
  type RoomReservation,
} from '../../application/room-registry.js';
import { RoomLoadError } from '../room/postgres-room-loader.js';
import { ValidationWorkerError } from '../validation-worker/index.js';

const CLOSE_POLICY_VIOLATION = 1008;
const MILLISECONDS_PER_SECOND = 1_000;
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
  readonly userName: string;
}

interface ConnectionState extends AuthorizedBoardSocket {
  readonly connectionId: string;
  readonly helloDeadline: NodeJS.Timeout;
  readonly liveness: NodeJS.Timeout;
  readonly sessionHeaders: Headers;
  lastPongAt: number;
  presenceTimes: number[];
  presence?: ServerPresenceMessage;
  presenceExpiry?: NodeJS.Timeout;
  joining: boolean;
  ready: boolean;
  closed: boolean;
  updateInFlight: boolean;
  updateTokens: number;
  updateRefillAt: number;
  reservation?: RoomReservation;
  unsubscribe?: () => void;
  deliverUpdate?: (update: { seq: string; updateBase64: string }) => void;
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
    @Inject(AUTH_SESSION_LOOKUP) private readonly sessions: AuthSessionLookup,
    @Inject(CollaborationUpdateService) private readonly updates: CollaborationUpdateService,
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
      sessionHeaders: fromNodeHeaders(request.headers),
      helloDeadline,
      liveness: setInterval(() => {
        if (Date.now() - state.lastPongAt > WS_PONG_TIMEOUT_MS) {
          websocket.terminate();
        } else if (websocket.readyState === WebSocket.OPEN) {
          websocket.ping();
        }
      }, WS_PING_INTERVAL_MS),
      lastPongAt: Date.now(),
      presenceTimes: [],
      joining: false,
      ready: false,
      closed: false,
      updateInFlight: false,
      updateTokens: CONTENT_UPDATE_BURST,
      updateRefillAt: Date.now(),
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
    this.removePresence(state);
    state.closed = true;
    clearTimeout(state.helloDeadline);
    clearInterval(state.liveness);
    state.unsubscribe?.();
    state.reservation?.release();
    this.connections.delete(websocket);
    reportCollaborationMetric('collaboration.connections', {
      activeSockets: this.connections.size,
      activeRooms: this.rooms.activeRoomCount,
    });
  }

  /** Called after a board access transaction commits; the room queue orders socket state with updates. */
  public async accessChanged(boardId: string, userId?: string): Promise<void> {
    const affected = [...this.connections].filter(
      ([, state]) => state.boardId === boardId && (userId === undefined || state.userId === userId),
    );
    if (affected.length === 0) return;
    try {
      await this.rooms.runIfActive(boardId, async () => {
        for (const [websocket, state] of affected) {
          if (state.closed || !state.ready) continue;
          const decision = await this.permissions.read(boardId, state.userId);
          if (!decision.allowed) {
            reportCollaborationMetric('collaboration.access_reject', { count: 1 });
            this.send(websocket, {
              event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
              data: { role: null, archived: false },
            });
            websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
          } else {
            this.send(websocket, {
              event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
              data: { role: decision.role, archived: decision.board.archivedAt !== null },
            });
          }
        }
      });
    } catch {
      // A failed authority refresh must fail closed without changing the committed REST result.
      for (const [websocket] of affected) websocket.terminate();
    }
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
    if (message.event === CLIENT_EVENT_NAMES.PRESENCE) {
      this.acceptPresence(state, message.data);
      return;
    }
    if (message.event === CLIENT_EVENT_NAMES.UPDATE) {
      if (!this.consumeUpdateBudget(state)) {
        this.sendError(websocket, ERROR_CODES.RATE_LIMITED, true, message.data.updateId);
        return;
      }
      if (state.updateInFlight) {
        this.sendError(websocket, ERROR_CODES.SERVER_BUSY, true, message.data.updateId);
        return;
      }
      state.updateInFlight = true;
      void this.acceptUpdate(websocket, state, message.data.updateId, message.data.updateBase64);
      return;
    }
    this.sendError(websocket, ERROR_CODES.SERVER_BUSY, true);
  }

  private acceptPresence(state: ConnectionState, presence: PresenceState): void {
    if (state.closed) return;
    const now = Date.now();
    state.presenceTimes = state.presenceTimes.filter(
      (time) => now - time < MILLISECONDS_PER_SECOND,
    );
    // Drop excess ephemeral traffic without disturbing the independent durable stream.
    if (state.presenceTimes.length >= PRESENCE_UPDATES_PER_SECOND) return;
    state.presenceTimes.push(now);
    const colors = Object.values(COLOR_TOKENS);
    const colorIndex = [...state.userId].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    );
    const message: ServerPresenceMessage = {
      event: SERVER_EVENT_NAMES.PRESENCE,
      data: {
        connectionId: state.connectionId,
        user: {
          id: state.userId,
          name: state.userName.slice(0, MAX_PRESENCE_USER_NAME_CHARACTERS),
          color: colors[colorIndex % colors.length] ?? COLOR_TOKENS.BLUE,
        },
        // The shared parser has already bounded coordinates, unique IDs, and size.
        presence,
        expiresAt: new Date(now + PRESENCE_EXPIRY_MS).toISOString(),
      },
    };
    state.presence = message;
    clearTimeout(state.presenceExpiry);
    state.presenceExpiry = setTimeout(() => this.removePresence(state), PRESENCE_EXPIRY_MS);
    state.presenceExpiry.unref();
    this.broadcastPresence(state, message);
  }

  private broadcastPresence(source: ConnectionState, message: ServerPresenceMessage): void {
    for (const [socket, peer] of this.connections) {
      if (peer !== source && peer.ready && !peer.closed && peer.boardId === source.boardId) {
        this.send(socket, message);
      }
    }
  }

  private removePresence(state: ConnectionState): void {
    clearTimeout(state.presenceExpiry);
    const message = state.presence;
    delete state.presence;
    if (message === undefined) return;
    // An expired empty presence is the v1 removal signal.
    this.broadcastPresence(state, {
      ...message,
      data: {
        ...message.data,
        presence: { cursor: null, selectedIds: [], dragPreview: null },
        expiresAt: new Date().toISOString(),
      },
    });
  }

  private consumeUpdateBudget(state: ConnectionState): boolean {
    const now = Date.now();
    state.updateTokens = Math.min(
      CONTENT_UPDATE_BURST,
      state.updateTokens +
        ((now - state.updateRefillAt) * CONTENT_UPDATES_PER_SECOND) / MILLISECONDS_PER_SECOND,
    );
    state.updateRefillAt = now;
    if (state.updateTokens < 1) return false;
    state.updateTokens -= 1;
    return true;
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
        const deliverUpdate = (update: { seq: string; updateBase64: string }) => {
          this.send(websocket, {
            event: SERVER_EVENT_NAMES.UPDATE,
            data: update,
          });
        };
        state.deliverUpdate = deliverUpdate;
        const subscription = reservation.room.subscribe(deliverUpdate);
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
          reportCollaborationMetric('collaboration.connections', {
            activeSockets: this.connections.size,
            activeRooms: this.rooms.activeRoomCount,
          });
          subscription.activate();
          for (const peer of this.connections.values()) {
            if (
              peer !== state &&
              peer.boardId === state.boardId &&
              peer.presence !== undefined &&
              Date.parse(peer.presence.data.expiresAt) > Date.now()
            ) {
              this.send(websocket, peer.presence);
            }
          }
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
      reportCollaborationMetric('collaboration.admission_reject', { code, count: 1 });
      this.sendError(
        websocket,
        code,
        code === ERROR_CODES.SERVER_BUSY || code === ERROR_CODES.ROOM_FULL,
      );
      websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
    }
  }

  private async acceptUpdate(
    websocket: WebSocket,
    state: ConnectionState,
    updateId: string,
    updateBase64: string,
  ): Promise<void> {
    const started = performance.now();
    try {
      const room = state.reservation?.room;
      if (room === undefined) throw new Error('Room reservation missing.');
      await room.run(async () => {
        const session = await this.sessions.lookup(state.sessionHeaders);
        if (session === null || session.userId !== state.userId) {
          throw new DurableUpdateRejectedError(ERROR_CODES.UNAUTHENTICATED, 'Session unavailable.');
        }
        const bytes = Buffer.from(updateBase64, 'base64');
        const result = await this.updates.accept(room, {
          actorUserId: session.userId,
          updateId,
          updateBytes: bytes,
        });
        this.send(websocket, {
          event: SERVER_EVENT_NAMES.ACK,
          data: { updateId, seq: result.sequence },
        });
        reportCollaborationMetric('collaboration.ack', {
          latencyMs: Math.round(performance.now() - started),
          duplicate: result.duplicate,
        });
        if (!result.duplicate) {
          room.publishCommittedUpdate({ seq: result.sequence, updateBase64 }, state.deliverUpdate);
        }
      });
    } catch (error) {
      if (error instanceof InjectedPostCommitCrashError) {
        websocket.terminate();
        return;
      }
      const code =
        error instanceof DurableUpdateRejectedError || error instanceof ValidationWorkerError
          ? error.code
          : ERROR_CODES.PERSISTENCE_FAILED;
      reportCollaborationMetric('collaboration.update_reject', { code, count: 1 });
      if (code === ERROR_CODES.FORBIDDEN || code === ERROR_CODES.BOARD_ARCHIVED) {
        reportCollaborationMetric('collaboration.access_reject', { count: 1 });
      }
      this.sendError(
        websocket,
        code,
        code === ERROR_CODES.SERVER_BUSY || code === ERROR_CODES.PERSISTENCE_FAILED,
        updateId,
      );
      if (code === ERROR_CODES.UNAUTHENTICATED)
        websocket.close(CLOSE_POLICY_VIOLATION, 'Session unavailable');
    } finally {
      state.updateInFlight = false;
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
