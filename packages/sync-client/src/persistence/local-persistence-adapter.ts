import {
  ERROR_CODES,
  applicationIdSchema,
  serverSequenceSchema,
  type GraphProjection,
  type ServerSequence,
} from '@archboard/contracts';
import {
  COMMAND_ORIGINS,
  applyHydrationUpdate,
  applyRemoteUpdate,
  projectGraphDocument,
} from '@archboard/document-model';
import type { IDBPTransaction } from 'idb';
import type * as Y from 'yjs';

import {
  LOCAL_UPDATE_DIRECTIONS,
  OUTBOX_STATUSES,
  SYNC_INDEX_NAMES,
  SYNC_STORE_NAMES,
  UPDATE_HASH_ALGORITHM,
} from '../config/index.js';
import {
  copyLocalUpdate,
  copyOutboxRecord,
  openSyncClientDatabase,
  type LocalUpdateRecord,
  type OutboxRecord,
  type SyncClientDatabase,
  type SyncClientDatabaseConnection,
} from './database.js';
import { INDEXEDDB_FAILPOINTS, IndexedDbFailpointController } from './failpoints.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from './namespace.js';

export const LOCAL_PERSISTENCE_PHASES = {
  READY: 'ready',
  SAVING: 'saving',
  SAVED: 'saved',
  STORAGE_ERROR: 'storage-error',
} as const;

export type LocalPersistencePhase =
  (typeof LOCAL_PERSISTENCE_PHASES)[keyof typeof LOCAL_PERSISTENCE_PHASES];

export interface LocalPersistenceStatus {
  readonly phase: LocalPersistencePhase;
  readonly savedOnDevice: boolean;
  readonly editingPaused: boolean;
  readonly errorCode: typeof ERROR_CODES.PERSISTENCE_FAILED | null;
}

export interface LocalPersistenceAdapterOptions {
  readonly namespace: BoardStorageNamespace;
  readonly document: Y.Doc;
  readonly failpoints?: IndexedDbFailpointController;
  readonly createUpdateId?: () => string;
  readonly now?: () => Date;
}

export class EditingPausedForStorageError extends Error {
  public constructor() {
    super('Editing is paused because local persistence failed.');
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

type LocalWriteTransaction = IDBPTransaction<
  SyncClientDatabase,
  [typeof SYNC_STORE_NAMES.LOCAL_UPDATES, typeof SYNC_STORE_NAMES.OUTBOX],
  'readwrite'
>;

const LOCAL_COMMAND_ORIGINS = new Set<unknown>([
  COMMAND_ORIGINS.LOCAL_EDIT,
  COMMAND_ORIGINS.LOCAL_STRUCTURAL,
]);

function bytesAsArrayBuffer(updateBytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(updateBytes.byteLength);
  copy.set(updateBytes);
  return copy.buffer;
}

export class LocalPersistenceAdapter {
  private nextLocalSequence: number;
  private pendingLocalWrites = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private status: LocalPersistenceStatus = Object.freeze({
    phase: LOCAL_PERSISTENCE_PHASES.READY,
    savedOnDevice: true,
    editingPaused: false,
    errorCode: null,
  });

  private constructor(
    private readonly namespace: string,
    private readonly document: Y.Doc,
    private readonly database: SyncClientDatabaseConnection,
    nextLocalSequence: number,
    private readonly failpoints: IndexedDbFailpointController,
    private readonly createUpdateId: () => string,
    private readonly now: () => Date,
  ) {
    this.nextLocalSequence = nextLocalSequence;
    this.document.on('update', this.handleDocumentUpdate);
  }

  public static async open(
    options: LocalPersistenceAdapterOptions,
  ): Promise<LocalPersistenceAdapter> {
    const namespace = boardStorageNamespaceKey(options.namespace);
    const database = await openSyncClientDatabase();
    const records = await database.getAllFromIndex(
      SYNC_STORE_NAMES.LOCAL_UPDATES,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      namespace,
    );
    const nextLocalSequence = records.reduce(
      (highest, record) => Math.max(highest, record.localSequence),
      0,
    );
    return new LocalPersistenceAdapter(
      namespace,
      options.document,
      database,
      nextLocalSequence,
      options.failpoints ?? new IndexedDbFailpointController(),
      options.createUpdateId ?? (() => crypto.randomUUID()),
      options.now ?? (() => new Date()),
    );
  }

  public persistenceStatus(): LocalPersistenceStatus {
    return this.status;
  }

  public assertEditingAllowed(): void {
    if (this.status.editingPaused) throw new EditingPausedForStorageError();
  }

  public exportInMemoryProjection(): GraphProjection {
    return projectGraphDocument(this.document);
  }

  public async whenIdle(): Promise<void> {
    await this.writeTail;
  }

  public async listLocalUpdates(): Promise<readonly LocalUpdateRecord[]> {
    const records = await this.database.getAllFromIndex(
      SYNC_STORE_NAMES.LOCAL_UPDATES,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      this.namespace,
    );
    return records
      .sort((left, right) => left.localSequence - right.localSequence)
      .map(copyLocalUpdate);
  }

  public async listTransportEligibleUpdates(): Promise<readonly OutboxRecord[]> {
    const records = await this.database.getAllFromIndex(
      SYNC_STORE_NAMES.OUTBOX,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      this.namespace,
    );
    return records
      .sort((left, right) => left.localSequence - right.localSequence)
      .map(copyOutboxRecord);
  }

  public hydrate(updateBytes: Uint8Array): void {
    applyHydrationUpdate(this.document, updateBytes);
  }

  public async applyRemoteAndPersist(
    updateBytes: Uint8Array,
    serverSequence: ServerSequence,
  ): Promise<void> {
    serverSequenceSchema.parse(serverSequence);
    await this.whenIdle();
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
    try {
      await this.database.put(SYNC_STORE_NAMES.LOCAL_UPDATES, record);
      applyRemoteUpdate(this.document, exactBytes);
    } catch {
      this.recordStorageFailure();
      throw new LocalPersistenceError();
    }
  }

  public async acknowledgeUpdate(updateId: string, serverSequence: ServerSequence): Promise<void> {
    applicationIdSchema.parse(updateId);
    serverSequenceSchema.parse(serverSequence);
    await this.whenIdle();
    const transaction = this.database.transaction(
      [SYNC_STORE_NAMES.LOCAL_UPDATES, SYNC_STORE_NAMES.OUTBOX],
      'readwrite',
    );
    try {
      const outbox = await transaction
        .objectStore(SYNC_STORE_NAMES.OUTBOX)
        .get([this.namespace, updateId]);
      if (outbox === undefined) {
        await transaction.done;
        return;
      }
      const localStore = transaction.objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES);
      const localRecord = await localStore.get([this.namespace, outbox.localSequence]);
      if (localRecord === undefined)
        throw new LocalPersistenceError('Outbox update has no local log.');
      await localStore.put({
        ...localRecord,
        acknowledgedServerSequence: serverSequence,
        acknowledgedAt: this.now().toISOString(),
      });
      if (this.failpoints.consume(INDEXEDDB_FAILPOINTS.AFTER_ACK_WRITE)) {
        transaction.abort();
        await transaction.done;
      }
      await transaction.objectStore(SYNC_STORE_NAMES.OUTBOX).delete([this.namespace, updateId]);
      await transaction.done;
    } catch (error) {
      if (error instanceof LocalPersistenceError) throw error;
      this.recordStorageFailure();
      throw new LocalPersistenceError();
    }
  }

  public async close(): Promise<void> {
    this.document.off('update', this.handleDocumentUpdate);
    await this.whenIdle();
    this.database.close();
  }

  private readonly handleDocumentUpdate = (updateBytes: Uint8Array, origin: unknown): void => {
    if (!LOCAL_COMMAND_ORIGINS.has(origin) || this.status.editingPaused) return;
    const exactBytes = Uint8Array.from(updateBytes);
    const updateId = this.createUpdateId();
    applicationIdSchema.parse(updateId);
    const localSequence = this.reserveLocalSequence();
    this.pendingLocalWrites += 1;
    this.status = Object.freeze({
      phase: LOCAL_PERSISTENCE_PHASES.SAVING,
      savedOnDevice: false,
      editingPaused: false,
      errorCode: null,
    });
    this.writeTail = this.writeTail
      .then(async () => {
        if (this.status.editingPaused) return;
        await this.persistLocalUpdate(updateId, localSequence, exactBytes);
      })
      .then(
        () => this.finishLocalWrite(),
        () => this.recordStorageFailure(),
      );
  };

  private reserveLocalSequence(): number {
    this.nextLocalSequence += 1;
    return this.nextLocalSequence;
  }

  private async persistLocalUpdate(
    updateId: string,
    localSequence: number,
    updateBytes: Uint8Array,
  ): Promise<void> {
    const createdAt = this.now().toISOString();
    const payloadHash = new Uint8Array(
      await crypto.subtle.digest(UPDATE_HASH_ALGORITHM, bytesAsArrayBuffer(updateBytes)),
    );
    const transaction = this.database.transaction(
      [SYNC_STORE_NAMES.LOCAL_UPDATES, SYNC_STORE_NAMES.OUTBOX],
      'readwrite',
    );
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
    await transaction.objectStore(SYNC_STORE_NAMES.OUTBOX).put({
      namespace: this.namespace,
      updateId,
      localSequence,
      updateBytes,
      payloadHash,
      createdAt,
      status: OUTBOX_STATUSES.PENDING,
    });
    await transaction.done;
  }

  private async writeLocalLog(
    transaction: LocalWriteTransaction,
    record: LocalUpdateRecord,
  ): Promise<void> {
    await transaction.objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES).put(record);
  }

  private finishLocalWrite(): void {
    this.pendingLocalWrites -= 1;
    if (this.pendingLocalWrites === 0 && !this.status.editingPaused) {
      this.status = Object.freeze({
        phase: LOCAL_PERSISTENCE_PHASES.SAVED,
        savedOnDevice: true,
        editingPaused: false,
        errorCode: null,
      });
    }
  }

  private recordStorageFailure(): void {
    this.pendingLocalWrites = Math.max(0, this.pendingLocalWrites - 1);
    this.status = Object.freeze({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
      editingPaused: true,
      errorCode: ERROR_CODES.PERSISTENCE_FAILED,
    });
  }
}
