import {
  BOARD_ROLES,
  CLIENT_EVENT_NAMES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_WS_FRAME_BYTES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  applicationIdSchema,
  clientMessageSchema,
  serverMessageSchema,
  type BoardRole,
  type ErrorCode,
} from '@archboard/contracts';

import { LOCAL_PERSISTENCE_PHASES, type LocalPersistenceAdapter } from '../persistence/index.js';
import { TransientPresence } from './transient-presence.js';

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const RETRY_JITTER_FRACTION = 0.25;
const BASE64_CHUNK_SIZE = 32_768;
const SEQUENCE_ZERO = 0n;
const SEQUENCE_STEP = 1n;
const RETRY_MULTIPLIER = 2;

export const SYNC_PHASES = {
  CONNECTING: 'connecting',
  SYNCING: 'syncing',
  SAVED_TO_SERVER: 'saved-to-server',
  SAVING_ON_DEVICE: 'saving-on-device',
  SAVED_ON_DEVICE_OFFLINE: 'saved-on-device-offline',
  OFFLINE_CACHED: 'offline-cached',
  STORAGE_ERROR: 'storage-error',
  ACCESS_CHANGED: 'access-changed',
  RECOVERY_REQUIRED: 'recovery-required',
} as const;

export type SyncPhase = (typeof SYNC_PHASES)[keyof typeof SYNC_PHASES];

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly pendingCount: number;
  readonly role: BoardRole | null;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly errorCode: ErrorCode | null;
}

export interface OrderedSyncClientOptions {
  readonly boardId: string;
  readonly tabId: string;
  readonly webSocketOrigin: string;
  readonly persistence: LocalPersistenceAdapter;
  readonly createWebSocket?: (url: string) => WebSocket;
  readonly random?: () => number;
  readonly canSend?: () => boolean;
  readonly beforeDrain?: () => Promise<void>;
}

function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
  }
  return btoa(parts.join(''));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isWritableRole(role: BoardRole | null): boolean {
  return role === BOARD_ROLES.OWNER || role === BOARD_ROLES.EDITOR;
}

export class OrderedSyncClient {
  public readonly presence = new TransientPresence((message) => {
    if (!this.handshakeComplete || this.socket?.readyState !== WebSocket.OPEN || this.stopped)
      return false;
    this.socket.send(JSON.stringify(message));
    return true;
  });
  private readonly options: OrderedSyncClientOptions;
  private readonly listeners = new Set<() => void>();
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly random: () => number;
  private socket: WebSocket | null = null;
  private unsubscribePersistence: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private work: Promise<void> = Promise.resolve();
  private started = false;
  private stopped = false;
  private handshakeComplete = false;
  private role: BoardRole | null = null;
  private serverSequence: bigint = SEQUENCE_ZERO;
  private inFlightId: string | null = null;
  private causalGapId: string | null = null;
  private retryDelay = INITIAL_RETRY_MS;
  private reconnectCount = 0;
  private recoveryCode: ErrorCode | null = null;
  private accessDenied = false;
  private pendingCount = 0;
  private readonly handleOnline = (): void => this.retryNow();
  private status: SyncStatus = {
    phase: SYNC_PHASES.CONNECTING,
    pendingCount: 0,
    role: null,
    connected: false,
    ready: false,
    errorCode: null,
  };

  public constructor(options: OrderedSyncClientOptions) {
    applicationIdSchema.parse(options.boardId);
    applicationIdSchema.parse(options.tabId);
    const origin = new URL(options.webSocketOrigin);
    if (
      !['ws:', 'wss:'].includes(origin.protocol) ||
      origin.origin !== options.webSocketOrigin ||
      origin.username !== '' ||
      origin.password !== ''
    ) {
      throw new Error('A WebSocket origin is required.');
    }
    this.options = options;
    this.createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
    this.random = options.random ?? Math.random;
  }

  public getSnapshot(): SyncStatus {
    return this.status;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.options.persistence.initialize();
    if (this.localFailure()) {
      this.publish();
      return;
    }
    this.serverSequence = BigInt(await this.options.persistence.lastReceivedServerSequence());
    this.unsubscribePersistence = this.options.persistence.subscribe(() => this.enqueueRefresh());
    window.addEventListener('online', this.handleOnline);
    await this.refresh();
    if (!this.stopped && !this.localFailure()) this.connect();
  }

  public stop(): void {
    this.presence.clear();
    this.stopped = true;
    this.unsubscribePersistence?.();
    this.unsubscribePersistence = null;
    window.removeEventListener('online', this.handleOnline);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.handshakeComplete = false;
    this.inFlightId = null;
    this.publish();
  }

  public retryNow(): void {
    if (
      !this.started ||
      this.stopped ||
      this.localFailure() ||
      this.recoveryCode !== null ||
      this.accessDenied
    )
      return;
    if (this.socket !== null) return;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  }

  public resumeDrain(): void {
    if (this.started && !this.stopped) this.enqueueRefresh();
  }

  private connect(): void {
    if (this.stopped || this.socket !== null || this.localFailure()) return;
    const url = new URL(`/ws/boards/${this.options.boardId}`, this.options.webSocketOrigin);
    let socket: WebSocket;
    try {
      // Browser WebSocket credentials come from its cookie jar for this origin.
      socket = this.createWebSocket(url.href);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.handshakeComplete = false;
    this.inFlightId = null;
    this.publish();
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      socket.send(
        JSON.stringify(
          clientMessageSchema.parse({
            event: CLIENT_EVENT_NAMES.HELLO,
            data: {
              protocolVersion: PROTOCOL_VERSION,
              schemaVersion: GRAPH_SCHEMA_VERSION,
              tabId: this.options.tabId,
            },
          }),
        ),
      );
      this.publish();
    };
    socket.onmessage = (event) => {
      this.enqueue(async () => {
        if (this.socket !== socket || this.stopped) return;
        await this.receive(event.data);
      });
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.presence.clear();
      this.socket = null;
      this.handshakeComplete = false;
      this.inFlightId = null;
      this.publish();
      if (
        !this.stopped &&
        this.recoveryCode === null &&
        !this.accessDenied &&
        !this.localFailure()
      ) {
        this.scheduleReconnect();
      }
    };
    socket.onerror = () => undefined;
  }

  private async receive(raw: unknown): Promise<void> {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_WS_FRAME_BYTES) {
      this.reconnectForProtocolError();
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.reconnectForProtocolError();
      return;
    }
    const parsed = serverMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.reconnectForProtocolError();
      return;
    }
    const message = parsed.data;
    if (message.event === SERVER_EVENT_NAMES.READY) {
      if (this.handshakeComplete) return this.reconnectForProtocolError();
      if (BigInt(message.data.latestSeq) < this.serverSequence) {
        this.recoveryCode = ERROR_CODES.CAUSAL_GAP;
        this.publish();
        this.socket?.close();
        return;
      }
      await this.options.persistence.applyRemoteAndPersist(
        decodeBase64(message.data.snapshotBase64),
        message.data.latestSeq,
      );
      this.serverSequence = BigInt(message.data.latestSeq);
      this.role = message.data.role;
      this.handshakeComplete = true;
      this.presence.connect(message.data.connectionId);
      this.retryDelay = INITIAL_RETRY_MS;
      await this.refresh();
      await this.options.beforeDrain?.();
      await this.drain();
      return;
    }
    if (!this.handshakeComplete) {
      if (message.event === SERVER_EVENT_NAMES.ERROR) this.handleError(message.data);
      else this.reconnectForProtocolError();
      return;
    }
    if (message.event === SERVER_EVENT_NAMES.PRESENCE) {
      this.presence.receive(message.data);
      return;
    }
    if (message.event === SERVER_EVENT_NAMES.UPDATE) {
      const sequence = BigInt(message.data.seq);
      if (sequence <= this.serverSequence) return;
      if (sequence !== this.serverSequence + SEQUENCE_STEP) return this.reconnectForProtocolError();
      await this.options.persistence.applyRemoteAndPersist(
        decodeBase64(message.data.updateBase64),
        message.data.seq,
      );
      this.serverSequence = sequence;
      await this.refresh();
    } else if (message.event === SERVER_EVENT_NAMES.ACK) {
      if (message.data.updateId !== this.inFlightId) {
        const receipts = await this.options.persistence.listAcknowledgedUpdates();
        if (
          receipts.some(
            (receipt) =>
              receipt.updateId === message.data.updateId &&
              receipt.serverSequence === message.data.seq,
          )
        )
          return;
        return this.reconnectForProtocolError();
      }
      const sequence = BigInt(message.data.seq);
      if (sequence > this.serverSequence + SEQUENCE_STEP) return this.reconnectForProtocolError();
      await this.options.persistence.acknowledgeUpdate(message.data.updateId, message.data.seq);
      if (sequence > this.serverSequence) this.serverSequence = sequence;
      this.inFlightId = null;
      this.causalGapId = null;
      await this.refresh();
      await this.drain();
    } else if (message.event === SERVER_EVENT_NAMES.ERROR) {
      this.handleError(message.data);
    } else if (message.event === SERVER_EVENT_NAMES.ACCESS_CHANGED) {
      this.role = message.data.role;
      this.accessDenied = message.data.archived || !isWritableRole(message.data.role);
      this.publish();
      if (!this.accessDenied) await this.drain();
    }
  }

  private handleError(error: {
    code: ErrorCode;
    retryable: boolean;
    updateId?: string | undefined;
  }): void {
    if (error.updateId !== undefined && error.updateId !== this.inFlightId) return;
    if (error.code === ERROR_CODES.CAUSAL_GAP && this.inFlightId !== null) {
      if (this.causalGapId === this.inFlightId) {
        this.recoveryCode = error.code;
        this.publish();
        return;
      }
      this.causalGapId = this.inFlightId;
      this.reconnectForProtocolError();
      return;
    }
    if (error.retryable) {
      this.reconnectForProtocolError();
      return;
    }
    if (
      error.code === ERROR_CODES.FORBIDDEN ||
      error.code === ERROR_CODES.BOARD_ARCHIVED ||
      error.code === ERROR_CODES.UNAUTHENTICATED ||
      error.code === ERROR_CODES.NOT_FOUND
    ) {
      this.accessDenied = true;
    } else {
      this.recoveryCode = error.code;
    }
    this.publish();
  }

  private async drain(): Promise<void> {
    if (
      !this.handshakeComplete ||
      this.inFlightId !== null ||
      this.socket?.readyState !== WebSocket.OPEN ||
      !isWritableRole(this.role) ||
      this.options.canSend?.() === false ||
      this.accessDenied ||
      this.recoveryCode !== null
    )
      return;
    await this.options.persistence.whenIdle();
    if (this.localFailure()) return;
    const pending = await this.options.persistence.listTransportEligibleUpdates();
    this.pendingCount = pending.length;
    const first = pending[0];
    if (first === undefined) return this.publish();
    const envelope = clientMessageSchema.parse({
      event: CLIENT_EVENT_NAMES.UPDATE,
      data: { updateId: first.updateId, updateBase64: encodeBase64(first.updateBytes) },
    });
    this.inFlightId = first.updateId;
    this.socket.send(JSON.stringify(envelope));
    this.publish();
  }

  private enqueueRefresh(): void {
    this.enqueue(async () => {
      await this.refresh();
      await this.drain();
    });
  }

  private enqueue(action: () => Promise<void>): void {
    this.work = this.work.then(action).catch(() => {
      if (this.localFailure()) {
        this.socket?.close();
        this.publish();
      } else {
        this.recoveryCode = ERROR_CODES.DOCUMENT_INVALID;
        this.socket?.close();
        this.publish();
      }
    });
  }

  private async refresh(): Promise<void> {
    await this.options.persistence.whenIdle();
    this.pendingCount = (await this.options.persistence.listTransportEligibleUpdates()).length;
    this.publish();
  }

  private localFailure(): boolean {
    const phase = this.options.persistence.getSnapshot().phase;
    return (
      phase === LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR ||
      phase === LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED
    );
  }

  private reconnectForProtocolError(): void {
    this.presence.clear();
    this.handshakeComplete = false;
    this.inFlightId = null;
    this.socket?.close();
    this.publish();
  }

  private scheduleReconnect(): void {
    if (this.retryTimer !== null || this.stopped) return;
    const delay = Math.min(
      MAX_RETRY_MS,
      this.retryDelay * (1 + this.random() * RETRY_JITTER_FRACTION),
    );
    this.retryDelay = Math.min(MAX_RETRY_MS, this.retryDelay * RETRY_MULTIPLIER);
    this.reconnectCount += 1;
    console.info(JSON.stringify({ event: 'collaboration.reconnect', count: this.reconnectCount }));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private publish(): void {
    const local = this.options.persistence.getSnapshot();
    const connected = this.socket?.readyState === WebSocket.OPEN;
    const phase =
      local.phase === LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR
        ? SYNC_PHASES.STORAGE_ERROR
        : local.phase === LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED || this.recoveryCode !== null
          ? SYNC_PHASES.RECOVERY_REQUIRED
          : this.accessDenied ||
              (this.pendingCount > 0 && this.handshakeComplete && !isWritableRole(this.role))
            ? SYNC_PHASES.ACCESS_CHANGED
            : local.pendingWrites > 0 || local.phase === LOCAL_PERSISTENCE_PHASES.SAVING
              ? SYNC_PHASES.SAVING_ON_DEVICE
              : connected && this.handshakeComplete
                ? this.pendingCount > 0
                  ? SYNC_PHASES.SYNCING
                  : SYNC_PHASES.SAVED_TO_SERVER
                : connected || this.socket !== null
                  ? SYNC_PHASES.CONNECTING
                  : this.pendingCount > 0
                    ? SYNC_PHASES.SAVED_ON_DEVICE_OFFLINE
                    : SYNC_PHASES.OFFLINE_CACHED;
    this.status = Object.freeze({
      phase,
      pendingCount: this.pendingCount,
      role: this.role,
      connected,
      ready: connected && this.handshakeComplete,
      errorCode: this.recoveryCode ?? local.errorCode,
    });
    for (const listener of this.listeners) listener();
  }
}
