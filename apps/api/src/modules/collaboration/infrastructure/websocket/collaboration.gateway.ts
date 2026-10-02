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
  type BoardRole,
  type InvalidateMessage,
} from '@archboard/contracts';
import { Inject } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer as NestWebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import WebSocket from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import { fromNodeHeaders } from 'better-auth/node';
import * as Y from 'yjs';
import { projectGraphDocument } from '@archboard/document-model';

import {
  BoardPermissionService,
  BoardAuthorityTransaction,
} from '../../../boards/application/index.js';
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
import {
  MAX_SOCKET_BUFFERED_BYTES,
  MAX_PENDING_ACTIVATION_BYTES,
  MAX_PENDING_ACTIVATION_FRAMES,
} from '../../application/collaboration-limits.js';

const CLOSE_POLICY_VIOLATION = 1008;
const MILLISECONDS_PER_SECOND = 1_000;
// Check every heartbeat and fail closed if the authority cannot answer within five seconds.
const SESSION_LOOKUP_TIMEOUT_MS = 5_000;
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
  presenterTimes: number[];
  presenterDeadline?: NodeJS.Timeout;
  presence?: ServerPresenceMessage;
  presenceExpiry?: NodeJS.Timeout;
  joining: boolean;
  ready: boolean;
  closed: boolean;
  updateInFlight: boolean;
  updateTokens: number;
  updateRefillAt: number;
  sessionCheck?: Promise<boolean>;
  sessionDeadline?: NodeJS.Timeout;
  cancelSessionCheck?: () => void;
  accessChangedWhileJoining: boolean;
  activation?: Promise<void>;
  pendingActivationBytes: number;
  pendingActivationFrames: number;
  reservation?: RoomReservation;
  unsubscribe?: () => void;
  deliverUpdate?: (update: { seq: string; updateBase64: string }) => void;
  lastRole?: BoardRole;
  lastArchived?: boolean;
}

// The adapter creates a noServer ws instance; the authenticated upgrade broker matches dynamic IDs.
@WebSocketGateway({ path: '/ws/boards/:boardId' })
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @NestWebSocketServer()
  public server!: WebSocketServer;

  private readonly contexts = new WeakMap<IncomingMessage, AuthorizedBoardSocket>();
  private readonly connections = new Map<WebSocket, ConnectionState>();
  private readonly operations = new Set<Promise<unknown>>();
  private stopped = false;

  public constructor(
    @Inject(CollaborationRoomRegistry) private readonly rooms: CollaborationRoomRegistry,
    @Inject(BoardPermissionService) private readonly permissions: BoardPermissionService,
    @Inject(AUTH_SESSION_LOOKUP) private readonly sessions: AuthSessionLookup,
    @Inject(CollaborationUpdateService) private readonly updates: CollaborationUpdateService,
    @Inject(BoardAuthorityTransaction)
    private readonly authorityTransactions: BoardAuthorityTransaction,
  ) {}

  public acceptUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: AuthorizedBoardSocket,
  ): void {
    if (this.stopped) {
      socket.destroy();
      return;
    }
    this.contexts.set(request, context);
    this.server.handleUpgrade(request, socket, head, (websocket) => {
      this.server.emit('connection', websocket, request);
    });
  }

  public handleConnection(websocket: WebSocket, request: IncomingMessage): void {
    const context = this.contexts.get(request);
    this.contexts.delete(request);
    if (context === undefined || this.stopped) {
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
        if (
          websocket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES ||
          Date.now() - state.lastPongAt > WS_PONG_TIMEOUT_MS
        ) {
          this.terminate(websocket);
        } else if (websocket.readyState === WebSocket.OPEN) {
          websocket.ping();
          void this.revalidateSession(websocket, state);
        }
      }, WS_PING_INTERVAL_MS),
      lastPongAt: Date.now(),
      presenceTimes: [],
      presenterTimes: [],
      joining: false,
      ready: false,
      closed: false,
      updateInFlight: false,
      updateTokens: CONTENT_UPDATE_BURST,
      updateRefillAt: Date.now(),
      accessChangedWhileJoining: false,
      pendingActivationBytes: 0,
      pendingActivationFrames: 0,
    };
    helloDeadline.unref();
    state.liveness.unref();
    this.connections.set(websocket, state);
    websocket.on('pong', () => {
      state.lastPongAt = Date.now();
      if (state.reservation?.room.presenter.snapshot().connectionId === state.connectionId)
        void this.presenterOperation(state, websocket, 'heartbeat');
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
    clearTimeout(state.presenterDeadline);
    void this.presenterOperation(state, websocket, 'disconnect');
    clearTimeout(state.helloDeadline);
    clearInterval(state.liveness);
    clearTimeout(state.sessionDeadline);
    state.cancelSessionCheck?.();
    state.unsubscribe?.();
    state.reservation?.release();
    this.connections.delete(websocket);
    reportCollaborationMetric('collaboration.connections', {
      activeSockets: this.connections.size,
      activeRooms: this.rooms.activeRoomCount,
    });
  }

  /** Called after a board access transaction commits; the room queue orders socket state with updates. */
  public accessChanged(boardId: string, userId?: string): Promise<void> {
    return this.track(
      this.refreshAccess(boardId, userId).then(() => this.refreshPresenter(boardId)),
    );
  }

  public resourcesChanged(
    boardId: string,
    resources: readonly InvalidateMessage['data']['resource'][],
  ): Promise<void> {
    return this.track(
      this.refreshAccess(boardId, undefined, resources).then(() => this.refreshPresenter(boardId)),
    );
  }

  private async refreshAccess(
    boardId: string,
    userId?: string,
    resources?: readonly InvalidateMessage['data']['resource'][],
  ): Promise<void> {
    const affected = [...this.connections].filter(
      ([, state]) => state.boardId === boardId && (userId === undefined || state.userId === userId),
    );
    if (affected.length === 0) return;
    try {
      await this.rooms.runIfActive(boardId, async () => {
        await this.authorityTransactions.run(async (transaction) => {
          for (const [websocket, state] of affected) {
            if (!this.isOpen(websocket, state)) continue;
            // Hold the same board lock through protected fanout: removal cannot commit between
            // authority lookup and delivery. Session lookup is bounded by the existing deadline.
            const decision = await this.permissions.readLocked(transaction, boardId, state.userId);
            if (!(await this.revalidateSession(websocket, state))) continue;
            if (!this.isOpen(websocket, state)) continue;
            if (!decision.allowed) {
              reportCollaborationMetric('collaboration.access_reject', { count: 1 });
              this.send(websocket, {
                event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
                data: { role: null, archived: false },
              });
              websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
              this.handleDisconnect(websocket);
            } else {
              if (!state.ready) {
                state.accessChangedWhileJoining = true;
                continue;
              }
              if (
                resources === undefined ||
                state.lastRole !== decision.role ||
                state.lastArchived !== (decision.board.archivedAt !== null)
              )
                this.send(websocket, {
                  event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
                  data: { role: decision.role, archived: decision.board.archivedAt !== null },
                });
              state.lastRole = decision.role;
              state.lastArchived = decision.board.archivedAt !== null;
              for (const resource of new Set(resources ?? [])) {
                this.send(websocket, { event: SERVER_EVENT_NAMES.INVALIDATE, data: { resource } });
              }
            }
          }
        });
      });
    } catch {
      // A failed authority refresh must fail closed without changing the committed REST result.
      for (const [websocket] of affected) {
        this.handleDisconnect(websocket);
        websocket.terminate();
      }
    }
  }

  private onMessage(
    websocket: WebSocket,
    state: ConnectionState,
    raw: RawData,
    isBinary: boolean,
  ): void {
    if (!this.isOpen(websocket, state)) return;
    if (!state.ready && state.activation !== undefined) {
      // Ready may reach the client while the final authority read is still pending.
      const bytes = this.frameBytes(raw)?.byteLength ?? MAX_WS_FRAME_BYTES;
      if (
        state.pendingActivationFrames >= MAX_PENDING_ACTIVATION_FRAMES ||
        state.pendingActivationBytes + bytes > MAX_PENDING_ACTIVATION_BYTES
      ) {
        this.terminate(websocket);
        return;
      }
      state.pendingActivationFrames += 1;
      state.pendingActivationBytes += bytes;
      void state.activation
        .then(() => {
          state.pendingActivationFrames -= 1;
          state.pendingActivationBytes -= bytes;
          this.onMessage(websocket, state, raw, isBinary);
        })
        .catch(() => this.terminate(websocket));
      return;
    }
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
      void this.track(this.join(websocket, state));
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
    if (
      message.event === CLIENT_EVENT_NAMES.PRESENTER_ACQUIRE ||
      message.event === CLIENT_EVENT_NAMES.PRESENTER_STEP ||
      message.event === CLIENT_EVENT_NAMES.PRESENTER_RELEASE
    ) {
      const now = Date.now();
      state.presenterTimes = state.presenterTimes.filter(
        (time) => now - time < MILLISECONDS_PER_SECOND,
      );
      if (state.presenterTimes.length >= PRESENCE_UPDATES_PER_SECOND) {
        this.sendError(websocket, ERROR_CODES.PRESENTER_DENIED, false);
        return;
      }
      state.presenterTimes.push(now);
      void this.presenterOperation(
        state,
        websocket,
        message.event,
        message.event === CLIENT_EVENT_NAMES.PRESENTER_STEP ? message.data.stepId : undefined,
      );
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
      void this.track(
        this.acceptUpdate(websocket, state, message.data.updateId, message.data.updateBase64),
      );
      return;
    }
    this.sendError(websocket, ERROR_CODES.SERVER_BUSY, true);
  }

  private refreshPresenter(boardId: string): Promise<void> {
    const entry = [...this.connections].find(
      ([, state]) => state.boardId === boardId && state.ready,
    );
    return entry === undefined ? Promise.resolve() : this.presenterOperation(entry[1], entry[0]);
  }

  /** Queue and board transaction lock cover control and every protected delivery. */
  private presenterOperation(
    source: ConnectionState,
    socket: WebSocket,
    action?: string,
    stepId?: string,
  ): Promise<void> {
    const room = source.reservation?.room;
    if (room === undefined) return Promise.resolve();
    return this.track(
      room
        .run(async () => {
          await this.authorityTransactions.run(async (transaction) => {
            const lease = room.presenter;
            lease.expire(Date.now());
            if (action === 'disconnect') lease.release(source.connectionId);
            const holder = [...this.connections].find(
              ([, peer]) =>
                peer.boardId === source.boardId &&
                peer.connectionId === lease.snapshot().connectionId,
            );
            if (lease.snapshot().connectionId !== null) {
              if (
                holder === undefined ||
                !this.isOpen(holder[0], holder[1]) ||
                !(await this.revalidateSession(holder[0], holder[1])) ||
                !(await this.permissions.editGraph(transaction, source.boardId, holder[1].userId))
                  .allowed
              )
                lease.clear();
            }
            if (
              action !== undefined &&
              action !== 'disconnect' &&
              action !== 'expiry' &&
              action !== 'join' &&
              this.isOpen(socket, source) &&
              source.ready
            ) {
              const permission = await this.permissions.editGraph(
                transaction,
                source.boardId,
                source.userId,
              );
              if (!(await this.revalidateSession(socket, source))) return;
              if (!permission.allowed) this.sendError(socket, permission.code, false);
              else {
                lease.expire(Date.now());
                let accepted = false;
                if (action === CLIENT_EVENT_NAMES.PRESENTER_ACQUIRE)
                  accepted = lease.acquire(source.connectionId, Date.now());
                else if (action === CLIENT_EVENT_NAMES.PRESENTER_RELEASE)
                  accepted = lease.release(source.connectionId);
                else if (action === 'heartbeat')
                  accepted = lease.heartbeat(source.connectionId, source.lastPongAt);
                else if (action === CLIENT_EVENT_NAMES.PRESENTER_STEP && stepId !== undefined)
                  accepted = lease.select(
                    source.connectionId,
                    stepId,
                    projectGraphDocument(room.document).steps.some((step) => step.id === stepId),
                  );
                if (!accepted && action !== 'heartbeat')
                  this.sendError(socket, ERROR_CODES.PRESENTER_DENIED, false);
              }
            }
            lease.expire(Date.now());
            const publishAll = lease.consumeChange();
            const publishSource =
              action === 'join' ||
              action === CLIENT_EVENT_NAMES.PRESENTER_ACQUIRE ||
              action === CLIENT_EVENT_NAMES.PRESENTER_RELEASE ||
              action === CLIENT_EVENT_NAMES.PRESENTER_STEP;
            for (const [peerSocket, peer] of this.connections) {
              if (!publishAll && !(publishSource && peer === source)) continue;
              if (peer.boardId !== source.boardId || !peer.ready || !this.isOpen(peerSocket, peer))
                continue;
              const permission = await this.permissions.readLocked(
                transaction,
                source.boardId,
                peer.userId,
              );
              if (!permission.allowed || !(await this.revalidateSession(peerSocket, peer)))
                continue;
              lease.expire(Date.now());
              if (holder !== undefined && !this.isOpen(holder[0], holder[1]))
                lease.release(holder[1].connectionId);
              this.send(peerSocket, {
                event: SERVER_EVENT_NAMES.PRESENTER,
                data: lease.snapshot(),
              });
            }
            const snapshot = lease.snapshot();
            if (lease.hasChanges()) void this.presenterOperation(source, socket);
            // An independent deadline, never the 45-second socket timeout. Nonholders cannot renew it.
            for (const [peerSocket, peer] of this.connections) {
              if (peer.boardId !== source.boardId) continue;
              clearTimeout(peer.presenterDeadline);
              if (peer.connectionId === snapshot.connectionId && snapshot.expiresAt !== null) {
                peer.presenterDeadline = setTimeout(
                  () => {
                    void this.presenterOperation(peer, peerSocket, 'expiry');
                  },
                  Math.max(0, Date.parse(snapshot.expiresAt) - Date.now()),
                );
                peer.presenterDeadline.unref();
              }
            }
          });
        })
        .catch(() => {
          // Fail closed on unavailable authority; destruction also clears the room lease.
          room.presenter.clear();
          for (const [peerSocket, peer] of this.connections)
            if (peer.boardId === source.boardId) this.terminate(peerSocket);
        }),
    );
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
      if (!(await this.revalidateSession(websocket, state))) return;
      const firstDecision = await this.permissions.read(state.boardId, state.userId);
      if (!this.isOpen(websocket, state)) return;
      if (!firstDecision.allowed) {
        this.sendError(websocket, ERROR_CODES.NOT_FOUND, false);
        websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
        this.handleDisconnect(websocket);
        return;
      }
      const reservation = await this.rooms.reserve(state.boardId);
      // Ownership transfers only to a live connection. Disconnect may have run during loading.
      if (!this.isOpen(websocket, state)) {
        reservation.release();
        return;
      }
      state.reservation = reservation;
      await reservation.room.run(async () => {
        if (!this.isOpen(websocket, state)) {
          this.handleDisconnect(websocket);
          return;
        }
        const decision = await this.permissions.read(state.boardId, state.userId);
        if (!this.isOpen(websocket, state)) {
          this.handleDisconnect(websocket);
          return;
        }
        if (!decision.allowed) {
          this.sendError(websocket, ERROR_CODES.NOT_FOUND, false);
          websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
          this.handleDisconnect(websocket);
          return;
        }
        const deliverUpdate = (update: { seq: string; updateBase64: string }) => {
          if (!this.isOpen(websocket, state)) return;
          // Queue delivery separately from installation. A REST access change may have committed
          // while the graph transaction was finishing; recheck before releasing protected bytes.
          void this.track(
            this.rooms
              .runIfActive(state.boardId, async () => {
                await this.authorityTransactions.run(async (transaction) => {
                  const decision = await this.permissions.readLocked(
                    transaction,
                    state.boardId,
                    state.userId,
                  );
                  if (!(await this.revalidateSession(websocket, state))) return;
                  if (!decision.allowed) {
                    this.send(websocket, {
                      event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
                      data: { role: null, archived: false },
                    });
                    websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
                    this.handleDisconnect(websocket);
                    return;
                  }
                  this.send(websocket, { event: SERVER_EVENT_NAMES.UPDATE, data: update });
                });
              })
              .catch(() => this.terminate(websocket)),
          );
        };
        state.deliverUpdate = deliverUpdate;
        const subscription = reservation.room.subscribe(deliverUpdate, () =>
          this.terminate(websocket),
        );
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
        this.send(websocket, ready, (error) => {
          if (error != null || !this.isOpen(websocket, state)) {
            this.handleDisconnect(websocket);
            websocket.terminate();
            return;
          }
          // Do not hold the queue while waiting for network delivery. Final activation rejoins
          // the queue and reads current authority before flushing any buffered graph updates.
          state.activation = this.track(
            reservation.room
              .run(async () => {
                if (!this.isOpen(websocket, state)) return;
                const current = await this.permissions.read(state.boardId, state.userId);
                if (!this.isOpen(websocket, state)) return;
                if (!current.allowed) {
                  this.handleDisconnect(websocket);
                  websocket.close(CLOSE_POLICY_VIOLATION, 'Board unavailable');
                  return;
                }
                state.ready = true;
                state.lastRole = current.role;
                state.lastArchived = current.board.archivedAt !== null;
                reportCollaborationMetric('collaboration.connections', {
                  activeSockets: this.connections.size,
                  activeRooms: this.rooms.activeRoomCount,
                });
                if (
                  state.accessChangedWhileJoining ||
                  current.role !== decision.role ||
                  current.board.archivedAt !== null
                ) {
                  this.send(websocket, {
                    event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
                    data: { role: current.role, archived: current.board.archivedAt !== null },
                  });
                }
                subscription.activate();
                // Queued after buffered update deliveries, with current locked authority.
                void this.presenterOperation(state, websocket, 'join');
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
              })
              .catch(() => {
                this.handleDisconnect(websocket);
                websocket.terminate();
              })
              .finally(() => {
                delete state.activation;
              }),
          );
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
      this.handleDisconnect(websocket);
    }
  }

  private isOpen(websocket: WebSocket, state: ConnectionState): boolean {
    return !this.stopped && !state.closed && websocket.readyState === WebSocket.OPEN;
  }

  private revalidateSession(websocket: WebSocket, state: ConnectionState): Promise<boolean> {
    if (!this.isOpen(websocket, state)) return Promise.resolve(false);
    if (state.sessionCheck !== undefined) return state.sessionCheck;
    const fail = () => {
      this.handleDisconnect(websocket);
      websocket.close(CLOSE_POLICY_VIOLATION, 'Session unavailable');
    };
    const timeout = new Promise<null>((resolve) => {
      state.cancelSessionCheck = () => resolve(null);
      state.sessionDeadline = setTimeout(() => {
        fail();
        resolve(null);
      }, SESSION_LOOKUP_TIMEOUT_MS);
      state.sessionDeadline.unref();
    });
    state.sessionCheck = Promise.race([
      Promise.resolve().then(() => this.sessions.lookup(state.sessionHeaders)),
      timeout,
    ])
      .then((session) => {
        if (!this.isOpen(websocket, state)) return false;
        if (session === null || session.userId !== state.userId) {
          fail();
          return false;
        }
        return true;
      })
      .catch(() => {
        fail();
        return false;
      })
      .finally(() => {
        clearTimeout(state.sessionDeadline);
        delete state.sessionDeadline;
        delete state.cancelSessionCheck;
        delete state.sessionCheck;
      });
    return state.sessionCheck;
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
        if (!this.isOpen(websocket, state)) return;
        const session = await this.sessions.lookup(state.sessionHeaders);
        if (!this.isOpen(websocket, state)) return;
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
          void this.presenterOperation(state, websocket);
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
      if (code === ERROR_CODES.UNAUTHENTICATED) {
        websocket.close(CLOSE_POLICY_VIOLATION, 'Session unavailable');
        this.handleDisconnect(websocket);
      }
    } finally {
      state.updateInFlight = false;
    }
  }

  private send(websocket: WebSocket, message: unknown, delivered?: (error?: Error) => void): void {
    const state = this.connections.get(websocket);
    if (state === undefined || !this.isOpen(websocket, state)) return;
    try {
      const payload = JSON.stringify(serverMessageSchema.parse(message));
      if (
        websocket.bufferedAmount + Buffer.byteLength(payload, 'utf8') >
        MAX_SOCKET_BUFFERED_BYTES
      ) {
        this.terminate(websocket);
        return;
      }
      websocket.send(payload, (error) => {
        if (error != null) this.terminate(websocket);
        delivered?.(error ?? undefined);
      });
    } catch {
      this.terminate(websocket);
    }
  }

  private terminate(websocket: WebSocket): void {
    this.handleDisconnect(websocket);
    websocket.terminate();
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => undefined);
    return operation;
  }

  public stopAdmission(): void {
    this.stopped = true;
    for (const websocket of this.connections.keys()) this.terminate(websocket);
  }

  public async drain(): Promise<void> {
    while (this.operations.size > 0) await Promise.allSettled([...this.operations]);
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
