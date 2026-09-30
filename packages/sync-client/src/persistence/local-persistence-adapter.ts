import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  applicationIdSchema,
  serverSequenceSchema,
  type ErrorCode,
  type GraphProjection,
  type ServerSequence,
  type BoardRole,
} from '@archboard/contracts';
import {
  COMMAND_ORIGINS,
  applyHydrationUpdate,
  applyRemoteUpdate,
  createGraphDocument,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import type { IDBPTransaction } from 'idb';
import * as Y from 'yjs';

import {
  LOCAL_SNAPSHOT_BYTE_THRESHOLD,
  LOCAL_SNAPSHOT_UPDATE_THRESHOLD,
  LOCAL_UPDATE_DIRECTIONS,
  OUTBOX_STATUSES,
  SYNC_INDEX_NAMES,
  SYNC_STORE_NAMES,
  UPDATE_HASH_ALGORITHM,
} from '../config/index.js';
import {
  copyLocalSnapshot,
  copyLocalUpdate,
  copyOutboxRecord,
  openSyncClientDatabase,
  type LocalSnapshotRecord,
  type LocalUpdateRecord,
  type OutboxRecord,
  type OutboxReceiptRecord,
  type SyncClientDatabase,
  type SyncClientDatabaseConnection,
} from './database.js';
import { INDEXEDDB_FAILPOINTS, IndexedDbFailpointController } from './failpoints.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from './namespace.js';

export const LOCAL_PERSISTENCE_PHASES = {
  LOADING: 'loading',
  READY: 'ready',
  SAVING: 'saving',
  SAVED: 'saved',
  STORAGE_ERROR: 'storage-error',
  RECOVERY_REQUIRED: 'recovery-required',
} as const;

export type LocalPersistencePhase =
  (typeof LOCAL_PERSISTENCE_PHASES)[keyof typeof LOCAL_PERSISTENCE_PHASES];

export interface LocalPersistenceStatus {
  readonly phase: LocalPersistencePhase;
  readonly savedOnDevice: boolean;
  readonly editingPaused: boolean;
  readonly pendingWrites: number;
  readonly errorCode: ErrorCode | null;
  readonly diagnostic: string | null;
}

export interface LocalPersistenceAdapterOptions {
  readonly namespace: BoardStorageNamespace;
  readonly document: Y.Doc;
  readonly mode?: 'read-write' | 'read-only';
  readonly failpoints?: IndexedDbFailpointController;
  readonly createUpdateId?: () => string;
  readonly now?: () => Date;
}

export interface CachedBoardAccess {
  readonly role: BoardRole;
  readonly archived: boolean;
}

export class EditingPausedForStorageError extends Error {
  public constructor() {
    super('Editing is paused because local persistence is not writable.');
    this.name = 'EditingPausedForStorageError';
  }
}

export class LocalPersistenceError extends Error {
  public readonly code = ERROR_CODES.PERSISTENCE_FAILED;

  public constructor(message = 'IndexedDB persistence failed.') {
    super(message);
    this.name = 'LocalPersistenceError';
  }
}

export function storageFailureDiagnostic(cause: unknown): string {
  const quotaExceeded =
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    cause.name === 'QuotaExceededError';
  return quotaExceeded
    ? 'Browser storage quota was exceeded; export the in-memory graph before leaving.'
    : 'Local persistence failed; export the in-memory graph before leaving.';
}

type LocalWriteTransaction = IDBPTransaction<
  SyncClientDatabase,
  [
    typeof SYNC_STORE_NAMES.LOCAL_UPDATES,
    typeof SYNC_STORE_NAMES.OUTBOX,
    typeof SYNC_STORE_NAMES.OUTBOX_RECEIPTS,
  ],
  'readwrite'
>;

type StatusListener = () => void;

const LOCAL_COMMAND_ORIGINS = new Set<unknown>([
  COMMAND_ORIGINS.LOCAL_EDIT,
  COMMAND_ORIGINS.LOCAL_STRUCTURAL,
]);

function isPersistableLocalOrigin(origin: unknown): boolean {
  return LOCAL_COMMAND_ORIGINS.has(origin) || origin instanceof Y.UndoManager;
}

function bytesAsArrayBuffer(updateBytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(updateBytes.byteLength);
  copy.set(updateBytes);
  return copy.buffer;
}

function loadingStatus(): LocalPersistenceStatus {
  return Object.freeze({
    phase: LOCAL_PERSISTENCE_PHASES.LOADING,
    savedOnDevice: false,
    editingPaused: true,
    pendingWrites: 0,
    errorCode: null,
    diagnostic: null,
  });
}

export function shouldCreateLocalSnapshot(updateCount: number, updateBytes: number): boolean {
  return (
    updateCount >= LOCAL_SNAPSHOT_UPDATE_THRESHOLD || updateBytes >= LOCAL_SNAPSHOT_BYTE_THRESHOLD
  );
}

export class LocalPersistenceAdapter {
  private readonly namespace: string;
  private readonly document: Y.Doc;
  private readonly failpoints: IndexedDbFailpointController;
  private readonly createUpdateId: () => string;
  private readonly now: () => Date;
  private readonly graphSchemaVersion: number;
  private readonly readOnly: boolean;
  private readonly listeners = new Set<StatusListener>();
  private database: SyncClientDatabaseConnection | undefined;
  private initialization: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private nextLocalSequence = 0;
  private committedLocalSequence = 0;
  private pendingLocalWrites = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private status: LocalPersistenceStatus = loadingStatus();
  private closed = false;
  private observing = false;
  private namespaceHadStoredState = false;

  private constructor(options: LocalPersistenceAdapterOptions) {
    this.namespace = boardStorageNamespaceKey(options.namespace);
    this.graphSchemaVersion = options.namespace.graphSchemaVersion;
    this.readOnly = options.mode === 'read-only';
    this.document = options.document;
    this.failpoints = options.failpoints ?? new IndexedDbFailpointController();
    this.createUpdateId = options.createUpdateId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  public static create(options: LocalPersistenceAdapterOptions): LocalPersistenceAdapter {
    return new LocalPersistenceAdapter(options);
  }

  public static async open(
    options: LocalPersistenceAdapterOptions,
  ): Promise<LocalPersistenceAdapter> {
    const adapter = LocalPersistenceAdapter.create(options);
    await adapter.initialize();
    return adapter;
  }

  public initialize(): Promise<void> {
    this.initialization ??= this.initializeInternal();
    return this.initialization;
  }

  public getSnapshot(): LocalPersistenceStatus {
    return this.status;
  }

  public persistenceStatus(): LocalPersistenceStatus {
    return this.getSnapshot();
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public assertEditingAllowed(): void {
    if (this.status.editingPaused || this.closed) throw new EditingPausedForStorageError();
  }

  public exportInMemoryProjection(): GraphProjection {
    return projectGraphDocument(this.document);
  }

  public hadStoredStateOnOpen(): boolean {
    return this.namespaceHadStoredState;
  }

  public async whenIdle(): Promise<void> {
    await this.initialize();
    await this.writeTail;
  }

  public async listLocalUpdates(): Promise<readonly LocalUpdateRecord[]> {
    await this.initialize();
    const records = await this.requireDatabase().getAllFromIndex(
      SYNC_STORE_NAMES.LOCAL_UPDATES,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      this.namespace,
    );
    return records.sort((a, b) => a.localSequence - b.localSequence).map(copyLocalUpdate);
  }

  public async listTransportEligibleUpdates(): Promise<readonly OutboxRecord[]> {
    await this.initialize();
    const records = await this.requireDatabase().getAllFromIndex(
      SYNC_STORE_NAMES.OUTBOX,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      this.namespace,
    );
    return records.sort((a, b) => a.localSequence - b.localSequence).map(copyOutboxRecord);
  }

  public async countPendingUpdates(): Promise<number> {
    await this.initialize();
    return this.requireDatabase().countFromIndex(
      SYNC_STORE_NAMES.OUTBOX,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      this.namespace,
    );
  }

  public async oldestPendingUpdate(): Promise<OutboxRecord | null> {
    await this.initialize();
    const records = await this.requireDatabase().getAllFromIndex(
      SYNC_STORE_NAMES.OUTBOX,
      SYNC_INDEX_NAMES.BY_NAMESPACE_AND_SEQUENCE,
      IDBKeyRange.bound([this.namespace, 0], [this.namespace, Number.MAX_SAFE_INTEGER]),
      1,
    );
    return records[0] === undefined ? null : copyOutboxRecord(records[0]);
  }

  public async acknowledgedUpdate(updateId: string): Promise<OutboxReceiptRecord | null> {
    applicationIdSchema.parse(updateId);
    await this.initialize();
    return (
      (await this.requireDatabase().get(SYNC_STORE_NAMES.OUTBOX_RECEIPTS, [
        this.namespace,
        updateId,
      ])) ?? null
    );
  }

  public async localSnapshot(): Promise<LocalSnapshotRecord | null> {
    await this.initialize();
    const record = await this.requireDatabase().get(
      SYNC_STORE_NAMES.LOCAL_SNAPSHOTS,
      this.namespace,
    );
    return record === undefined ? null : copyLocalSnapshot(record);
  }

  public async listAcknowledgedUpdates(): Promise<readonly OutboxReceiptRecord[]> {
    await this.initialize();
    const records = await this.requireDatabase().getAllFromIndex(
      SYNC_STORE_NAMES.OUTBOX_RECEIPTS,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      this.namespace,
    );
    return records.sort((a, b) => a.localSequence - b.localSequence);
  }

  public async hasQueuedInitialState(): Promise<boolean> {
    await this.initialize();
    const transaction = this.requireDatabase().transaction(
      [SYNC_STORE_NAMES.OUTBOX, SYNC_STORE_NAMES.OUTBOX_RECEIPTS],
      'readonly',
    );
    const [pending, acknowledged] = await Promise.all([
      transaction
        .objectStore(SYNC_STORE_NAMES.OUTBOX)
        .index(SYNC_INDEX_NAMES.BY_NAMESPACE)
        .getAll(this.namespace),
      transaction
        .objectStore(SYNC_STORE_NAMES.OUTBOX_RECEIPTS)
        .index(SYNC_INDEX_NAMES.BY_NAMESPACE)
        .getAll(this.namespace),
    ]);
    await transaction.done;
    return (
      pending.some((record) => record.initialState === true) ||
      acknowledged.some((record) => record.initialState === true)
    );
  }

  public async lastReceivedServerSequence(): Promise<ServerSequence> {
    await this.initialize();
    const state = await this.requireDatabase().get(SYNC_STORE_NAMES.RECEIVED_STATE, this.namespace);
    return state?.lastServerSequence ?? '0';
  }

  public async readCachedBoardAccess(): Promise<CachedBoardAccess | null> {
    await this.initialize();
    const record = await this.requireDatabase().get(SYNC_STORE_NAMES.BOARD_CACHE, this.namespace);
    if (record === undefined) return null;
    return { role: record.role, archived: record.metadata.archived === true };
  }

  public async cacheBoardAccess(access: CachedBoardAccess): Promise<void> {
    await this.whenIdle();
    if (this.readOnly) return;
    const database = this.requireDatabase();
    const lastServerSequence = await this.lastReceivedServerSequence();
    const transaction = database.transaction(SYNC_STORE_NAMES.BOARD_CACHE, 'readwrite');
    const existing = await transaction.store.get(this.namespace);
    await transaction.store.put({
      namespace: this.namespace,
      role: access.role,
      metadata: { ...existing?.metadata, archived: access.archived },
      cachedAt: this.now().toISOString(),
      lastServerSequence,
    });
    await transaction.done;
  }

  public hydrate(updateBytes: Uint8Array): void {
    applyHydrationUpdate(this.document, updateBytes);
  }

  public async enqueueInitialDocumentState(updateBytes: Uint8Array): Promise<void> {
    this.assertEditingAllowed();
    await this.whenIdle();
    this.queueLocalBytes(updateBytes, true);
    await this.whenIdle();
    this.assertEditingAllowed();
  }

  public async applyRemoteAndPersist(
    updateBytes: Uint8Array,
    serverSequence: ServerSequence,
  ): Promise<void> {
    serverSequenceSchema.parse(serverSequence);
    this.assertEditingAllowed();
    await this.whenIdle();
    this.assertEditingAllowed();
    const exactBytes = Uint8Array.from(updateBytes);
    const localSequence = this.reserveLocalSequence();
    const record: LocalUpdateRecord = {
      namespace: this.namespace,
      localSequence,
      updateId: null,
      updateBytes: exactBytes,
      direction: LOCAL_UPDATE_DIRECTIONS.REMOTE,
      createdAt: this.now().toISOString(),
      acknowledgedServerSequence: serverSequence,
    };
    this.pendingLocalWrites += 1;
    this.publishSaving(this.pendingLocalWrites);
    let failed = false;
    this.writeTail = this.writeTail
      .then(async () => {
        const transaction = this.requireDatabase().transaction(
          [SYNC_STORE_NAMES.LOCAL_UPDATES, SYNC_STORE_NAMES.RECEIVED_STATE],
          'readwrite',
        );
        try {
          await transaction.objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES).put(record);
          if (this.failpoints.consume(INDEXEDDB_FAILPOINTS.AFTER_REMOTE_UPDATE_WRITE)) {
            transaction.abort();
            await transaction.done.catch(() => undefined);
            throw new LocalPersistenceError('Inbound persistence transaction aborted.');
          }
          const receivedStore = transaction.objectStore(SYNC_STORE_NAMES.RECEIVED_STATE);
          const previous = await receivedStore.get(this.namespace);
          if (
            previous === undefined ||
            BigInt(serverSequence) > BigInt(previous.lastServerSequence)
          ) {
            await receivedStore.put({
              namespace: this.namespace,
              lastServerSequence: serverSequence,
            });
          }
          await transaction.done;
        } catch (error) {
          await transaction.done.catch(() => undefined);
          throw error;
        }
        applyRemoteUpdate(this.document, exactBytes);
        this.committedLocalSequence = localSequence;
        this.pendingLocalWrites = Math.max(0, this.pendingLocalWrites - 1);
        this.publishSaving(this.pendingLocalWrites);
        if (this.pendingLocalWrites === 0) {
          await this.compactIfNeeded();
          this.publishSaved();
        }
      })
      .catch((error: unknown) => {
        failed = true;
        this.recordStorageFailure(error);
      });
    await this.writeTail;
    if (failed) throw new LocalPersistenceError();
  }

  public async acknowledgeUpdate(updateId: string, serverSequence: ServerSequence): Promise<void> {
    applicationIdSchema.parse(updateId);
    serverSequenceSchema.parse(serverSequence);
    await this.whenIdle();
    const transaction = this.requireDatabase().transaction(
      [
        SYNC_STORE_NAMES.LOCAL_UPDATES,
        SYNC_STORE_NAMES.OUTBOX,
        SYNC_STORE_NAMES.OUTBOX_RECEIPTS,
        SYNC_STORE_NAMES.RECEIVED_STATE,
      ],
      'readwrite',
    );
    try {
      const outbox = await transaction
        .objectStore(SYNC_STORE_NAMES.OUTBOX)
        .get([this.namespace, updateId]);
      const receiptStore = transaction.objectStore(SYNC_STORE_NAMES.OUTBOX_RECEIPTS);
      const previousReceipt = await receiptStore.get([this.namespace, updateId]);
      if (outbox === undefined) {
        if (previousReceipt !== undefined && previousReceipt.serverSequence !== serverSequence) {
          await transaction.done;
          throw new LocalPersistenceError(
            'Duplicate ACK sequence differs from the durable receipt.',
          );
        }
        await transaction.done;
        return;
      }
      if (previousReceipt !== undefined && previousReceipt.serverSequence !== serverSequence) {
        await transaction.done;
        throw new LocalPersistenceError('ACK sequence differs from the durable receipt.');
      }
      const localStore = transaction.objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES);
      const localRecord = await localStore.get([this.namespace, outbox.localSequence]);
      const acknowledgedAt = this.now().toISOString();
      if (localRecord !== undefined) {
        await localStore.put({
          ...localRecord,
          acknowledgedServerSequence: serverSequence,
          acknowledgedAt,
        });
      }
      await receiptStore.put({
        namespace: this.namespace,
        updateId,
        localSequence: outbox.localSequence,
        serverSequence,
        acknowledgedAt,
        ...(outbox.initialState === true ? { initialState: true as const } : {}),
      });
      const receivedStore = transaction.objectStore(SYNC_STORE_NAMES.RECEIVED_STATE);
      const previous = await receivedStore.get(this.namespace);
      if (previous === undefined || BigInt(serverSequence) > BigInt(previous.lastServerSequence)) {
        await receivedStore.put({ namespace: this.namespace, lastServerSequence: serverSequence });
      }
      if (this.failpoints.consume(INDEXEDDB_FAILPOINTS.AFTER_ACK_WRITE)) {
        transaction.abort();
        await transaction.done;
      }
      await transaction.objectStore(SYNC_STORE_NAMES.OUTBOX).delete([this.namespace, updateId]);
      await transaction.done;
    } catch (error) {
      await transaction.done.catch(() => undefined);
      if (error instanceof LocalPersistenceError) throw error;
      this.recordStorageFailure(error);
      throw new LocalPersistenceError();
    }
  }

  public close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async initializeInternal(): Promise<void> {
    if (this.graphSchemaVersion !== GRAPH_SCHEMA_VERSION) {
      this.publishRecovery(
        ERROR_CODES.SCHEMA_UNSUPPORTED,
        `Cached graph schema ${this.graphSchemaVersion} is not supported.`,
      );
      return;
    }
    const current = projectGraphDocument(this.document);
    if (
      [current.nodes, current.edges, current.boundaries, current.steps].some(
        (items) => items.length > 0,
      )
    ) {
      this.publishRecovery(
        ERROR_CODES.DOCUMENT_INVALID,
        'Local persistence requires a fresh graph document.',
      );
      return;
    }

    try {
      const database = await openSyncClientDatabase();
      if (this.closed) {
        database.close();
        return;
      }
      this.database = database;
    } catch (error) {
      this.recordStorageFailure(error);
      return;
    }

    let snapshot: LocalSnapshotRecord | undefined;
    let records: LocalUpdateRecord[];
    try {
      snapshot = await this.requireDatabase().get(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, this.namespace);
      records = (
        await this.requireDatabase().getAllFromIndex(
          SYNC_STORE_NAMES.LOCAL_UPDATES,
          SYNC_INDEX_NAMES.BY_NAMESPACE,
          this.namespace,
        )
      ).sort((a, b) => a.localSequence - b.localSequence);
      this.namespaceHadStoredState = snapshot !== undefined || records.length > 0;
    } catch (error) {
      this.recordStorageFailure(error);
      return;
    }

    if (snapshot === undefined && records.length > 0) {
      this.publishRecovery(ERROR_CODES.CAUSAL_GAP, 'Local update log has no base snapshot.');
      return;
    }
    const throughSequence = snapshot?.throughLocalSequence ?? 0;
    if (!Number.isSafeInteger(throughSequence) || throughSequence < 0) {
      this.publishRecovery(ERROR_CODES.CAUSAL_GAP, 'Local snapshot sequence is invalid.');
      return;
    }

    try {
      const candidate = createGraphDocument();
      if (snapshot !== undefined) applyHydrationUpdate(candidate, snapshot.updateBytes);
      let expectedSequence = throughSequence + 1;
      for (const record of records) {
        if (record.localSequence <= throughSequence) continue;
        if (record.localSequence !== expectedSequence) {
          this.publishRecovery(
            ERROR_CODES.CAUSAL_GAP,
            `Local update sequence ${expectedSequence} is missing.`,
          );
          return;
        }
        applyHydrationUpdate(candidate, record.updateBytes);
        expectedSequence += 1;
      }
      validateGraphDocument(candidate);
      projectGraphDocument(candidate);
      applyHydrationUpdate(this.document, Y.encodeStateAsUpdate(candidate));
      validateGraphDocument(this.document);
    } catch (error) {
      this.publishRecovery(
        ERROR_CODES.DOCUMENT_INVALID,
        error instanceof Error ? error.message : 'Cached graph data is invalid.',
      );
      return;
    }

    this.nextLocalSequence = Math.max(throughSequence, records.at(-1)?.localSequence ?? 0);
    this.committedLocalSequence = this.nextLocalSequence;
    if (!this.readOnly) {
      try {
        await this.requireDatabase().put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
          namespace: this.namespace,
          throughLocalSequence: this.nextLocalSequence,
          updateBytes: Y.encodeStateAsUpdate(this.document),
          updatedAt: this.now().toISOString(),
        });
        await this.deleteCoveredLocalUpdates(this.nextLocalSequence, records);
      } catch (error) {
        this.recordStorageFailure(error);
        return;
      }
    }
    if (this.closed) return;
    if (!this.readOnly) {
      this.document.on('update', this.handleDocumentUpdate);
      this.observing = true;
    }
    this.publishReady();
  }

  private readonly handleDocumentUpdate = (updateBytes: Uint8Array, origin: unknown): void => {
    if (!isPersistableLocalOrigin(origin) || this.status.editingPaused || this.closed) return;
    this.queueLocalBytes(updateBytes);
  };

  private queueLocalBytes(updateBytes: Uint8Array, initialState = false): void {
    const exactBytes = Uint8Array.from(updateBytes);
    let updateId: string;
    try {
      updateId = applicationIdSchema.parse(this.createUpdateId());
    } catch {
      this.recordStorageFailure();
      return;
    }
    const localSequence = this.reserveLocalSequence();
    this.pendingLocalWrites += 1;
    this.publishSaving(this.pendingLocalWrites);
    this.writeTail = this.writeTail.then(async () => {
      if (this.status.editingPaused) return;
      await this.persistLocalUpdate(updateId, localSequence, exactBytes, initialState);
      this.committedLocalSequence = localSequence;
      this.pendingLocalWrites = Math.max(0, this.pendingLocalWrites - 1);
      this.publishSaving(this.pendingLocalWrites);
      if (this.pendingLocalWrites === 0) {
        await this.compactIfNeeded();
        this.publishSaved();
      }
    });
    this.writeTail = this.writeTail.catch((error: unknown) => this.recordStorageFailure(error));
  }

  private reserveLocalSequence(): number {
    this.nextLocalSequence += 1;
    return this.nextLocalSequence;
  }

  private async persistLocalUpdate(
    updateId: string,
    localSequence: number,
    updateBytes: Uint8Array,
    initialState: boolean,
  ): Promise<void> {
    const createdAt = this.now().toISOString();
    const payloadHash = new Uint8Array(
      await crypto.subtle.digest(UPDATE_HASH_ALGORITHM, bytesAsArrayBuffer(updateBytes)),
    );
    const transaction = this.requireDatabase().transaction(
      [SYNC_STORE_NAMES.LOCAL_UPDATES, SYNC_STORE_NAMES.OUTBOX, SYNC_STORE_NAMES.OUTBOX_RECEIPTS],
      'readwrite',
    );
    try {
      if (
        (await transaction
          .objectStore(SYNC_STORE_NAMES.OUTBOX_RECEIPTS)
          .get([this.namespace, updateId])) !== undefined
      ) {
        await transaction.done;
        throw new LocalPersistenceError('Update ID already has a durable receipt.');
      }
      await this.writeLocalLog(transaction, {
        namespace: this.namespace,
        localSequence,
        updateId,
        updateBytes,
        direction: LOCAL_UPDATE_DIRECTIONS.LOCAL,
        createdAt,
      });
      if (this.failpoints.consume(INDEXEDDB_FAILPOINTS.AFTER_LOCAL_UPDATE_WRITE)) {
        transaction.abort();
        await transaction.done;
      }
      await transaction.objectStore(SYNC_STORE_NAMES.OUTBOX).add({
        namespace: this.namespace,
        updateId,
        localSequence,
        updateBytes,
        payloadHash,
        createdAt,
        status: OUTBOX_STATUSES.PENDING,
        ...(initialState ? { initialState: true as const } : {}),
      });
      await transaction.done;
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }

  private async writeLocalLog(
    transaction: LocalWriteTransaction,
    record: LocalUpdateRecord,
  ): Promise<void> {
    await transaction.objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES).put(record);
  }

  private async compactIfNeeded(): Promise<void> {
    if (this.status.editingPaused || this.pendingLocalWrites !== 0) return;
    const database = this.requireDatabase();
    const snapshot = await database.get(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, this.namespace);
    const records = (
      await database.getAllFromIndex(
        SYNC_STORE_NAMES.LOCAL_UPDATES,
        SYNC_INDEX_NAMES.BY_NAMESPACE,
        this.namespace,
      )
    ).sort((a, b) => a.localSequence - b.localSequence);
    const throughSequence = snapshot?.throughLocalSequence ?? 0;
    const uncovered = records.filter(({ localSequence }) => localSequence > throughSequence);
    const uncoveredBytes = uncovered.reduce(
      (total, record) => total + record.updateBytes.byteLength,
      0,
    );
    if (!shouldCreateLocalSnapshot(uncovered.length, uncoveredBytes)) return;

    // Reads can admit new edits. Capture bytes and their committed frontier
    // together only if the live document still has no uncommitted local work.
    if (this.status.editingPaused || this.pendingLocalWrites !== 0) return;
    const replacement: LocalSnapshotRecord = {
      namespace: this.namespace,
      throughLocalSequence: this.committedLocalSequence,
      updateBytes: Y.encodeStateAsUpdate(this.document),
      updatedAt: this.now().toISOString(),
    };
    await database.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, replacement);
    if (this.failpoints.consume(INDEXEDDB_FAILPOINTS.AFTER_SNAPSHOT_WRITE)) return;
    await this.deleteCoveredLocalUpdates(replacement.throughLocalSequence, records);
  }

  private async deleteCoveredLocalUpdates(
    throughSequence: number,
    records: readonly LocalUpdateRecord[],
  ): Promise<void> {
    const covered = records.filter(({ localSequence }) => localSequence <= throughSequence);
    if (covered.length === 0) return;
    const transaction = this.requireDatabase().transaction(
      SYNC_STORE_NAMES.LOCAL_UPDATES,
      'readwrite',
    );
    for (const record of covered) {
      await transaction.store.delete([this.namespace, record.localSequence]);
    }
    await transaction.done;
  }

  private publishReady(): void {
    this.setStatus({
      phase: LOCAL_PERSISTENCE_PHASES.READY,
      savedOnDevice: true,
      editingPaused: this.readOnly,
      pendingWrites: 0,
      errorCode: null,
      diagnostic: null,
    });
  }

  private publishSaving(pendingWrites: number): void {
    this.setStatus({
      phase: LOCAL_PERSISTENCE_PHASES.SAVING,
      savedOnDevice: false,
      editingPaused: false,
      pendingWrites,
      errorCode: null,
      diagnostic: null,
    });
  }

  private publishSaved(): void {
    if (this.status.editingPaused || this.pendingLocalWrites !== 0) return;
    this.setStatus({
      phase: LOCAL_PERSISTENCE_PHASES.SAVED,
      savedOnDevice: true,
      editingPaused: false,
      pendingWrites: 0,
      errorCode: null,
      diagnostic: null,
    });
  }

  private recordStorageFailure(cause?: unknown): void {
    this.pendingLocalWrites = 0;
    this.setStatus({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
      editingPaused: true,
      pendingWrites: 0,
      errorCode: ERROR_CODES.PERSISTENCE_FAILED,
      diagnostic: storageFailureDiagnostic(cause),
    });
  }

  private publishRecovery(errorCode: ErrorCode, diagnostic: string): void {
    this.setStatus({
      phase: LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED,
      savedOnDevice: false,
      editingPaused: true,
      pendingWrites: 0,
      errorCode,
      diagnostic,
    });
  }

  private setStatus(status: LocalPersistenceStatus): void {
    this.status = Object.freeze({ ...status });
    for (const listener of this.listeners) listener();
  }

  private requireDatabase(): SyncClientDatabaseConnection {
    if (this.database === undefined) throw new LocalPersistenceError('Database is not open.');
    return this.database;
  }

  private async closeInternal(): Promise<void> {
    this.closed = true;
    if (this.observing) {
      this.document.off('update', this.handleDocumentUpdate);
      this.observing = false;
    }
    try {
      await this.initialization;
      await this.writeTail;
    } finally {
      this.database?.close();
      this.listeners.clear();
    }
  }
}
