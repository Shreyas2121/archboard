import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  HANDLES,
  type GraphEdge,
  type GraphNode,
} from '@archboard/contracts';
import {
  COMMAND_ORIGINS,
  createLocalUndoManager,
  deleteGraphObjects,
  editGraphText,
  createEdge,
  createGraphDocument,
  createNode,
  projectGraphDocument,
} from '@archboard/document-model';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB, openDB } from 'idb';
import * as Y from 'yjs';

import {
  SYNC_DATABASE_NAME,
  SYNC_DATABASE_VERSION,
  SYNC_INDEX_NAMES,
  SYNC_STORE_NAMES,
  UPDATE_HASH_ALGORITHM,
  LOCAL_SNAPSHOT_BYTE_THRESHOLD,
  LOCAL_SNAPSHOT_UPDATE_THRESHOLD,
  LOCAL_UPDATE_DIRECTIONS,
  OUTBOX_STATUSES,
} from '../config/index.js';
import { openSyncClientDatabase } from './database.js';
import { INDEXEDDB_FAILPOINTS, IndexedDbFailpointController } from './failpoints.js';
import {
  EditingPausedForStorageError,
  LOCAL_PERSISTENCE_PHASES,
  LocalPersistenceAdapter,
  LocalPersistenceError,
  shouldCreateLocalSnapshot,
} from './local-persistence-adapter.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from './namespace.js';
import {
  deleteBoardStorageNamespace,
  listBoardStorageNamespaceRecords,
} from './namespace-storage.js';

const DEPLOYMENT_ORIGIN = 'https://app.archboard.example';
const ALTERNATE_DEPLOYMENT_ORIGIN = 'https://preview.archboard.example';
const USER_ID = 'indexeddb-unit-user';
const ALTERNATE_USER_ID = 'indexeddb-other-user';
const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 140;
const FIXED_TIME = new Date('2026-09-14T12:00:00.000Z');
const FIRST_SERVER_SEQUENCE = '1';
const SECOND_SERVER_SEQUENCE = '2';
const TWO_LOG_RECORDS = 2;
const EXPECTED_NAMESPACE_KEY_COUNT = 5;
const ONE_BELOW_SNAPSHOT_THRESHOLD = LOCAL_SNAPSHOT_UPDATE_THRESHOLD - 1;
const LEGACY_SYNC_DATABASE_VERSION = 1;

const openAdapters: LocalPersistenceAdapter[] = [];

function namespace(overrides: Partial<BoardStorageNamespace> = {}): BoardStorageNamespace {
  return {
    deploymentOrigin: DEPLOYMENT_ORIGIN,
    userId: USER_ID,
    boardId: crypto.randomUUID(),
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    ...overrides,
  };
}

function node(title: string): GraphNode {
  return {
    id: crypto.randomUUID(),
    kind: 'component',
    position: { x: 0, y: 0 },
    size: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    title,
    color: COLOR_TOKENS.BLUE,
    content: {
      category: COMPONENT_CATEGORIES.SERVICE,
      description: '',
      technology: 'TypeScript',
      externalUrl: null,
    },
  };
}

function edge(sourceId: string, targetId: string): GraphEdge {
  return {
    id: crypto.randomUUID(),
    sourceId,
    targetId,
    sourceHandle: HANDLES.RIGHT,
    targetHandle: HANDLES.LEFT,
    label: 'Request',
    protocol: 'HTTPS',
    direction: EDGE_DIRECTIONS.FORWARD,
    style: EDGE_STYLES.SOLID,
  };
}

async function openAdapter(
  document: Y.Doc,
  storageNamespace: BoardStorageNamespace,
  failpoints = new IndexedDbFailpointController(),
): Promise<LocalPersistenceAdapter> {
  const adapter = await LocalPersistenceAdapter.open({
    namespace: storageNamespace,
    document,
    failpoints,
    now: () => FIXED_TIME,
  });
  openAdapters.push(adapter);
  return adapter;
}

async function sha256(updateBytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(updateBytes.byteLength);
  copy.set(updateBytes);
  return new Uint8Array(await crypto.subtle.digest(UPDATE_HASH_ALGORITHM, copy.buffer));
}

function updateAddingNode(base: Y.Doc, graphNode: GraphNode): Uint8Array {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(base));
  const baseState = Y.encodeStateVector(replica);
  createNode(replica, graphNode);
  return Y.encodeStateAsUpdate(replica, baseState);
}

afterEach(async () => {
  await Promise.all(openAdapters.splice(0).map(async (adapter) => adapter.close()));
  await deleteDB(SYNC_DATABASE_NAME);
});

describe('IndexedDB persistence and outbox units in a real browser', () => {
  it('queues the initial Yjs schema clock before fresh-board edits', async () => {
    const document = createGraphDocument();
    const adapter = await openAdapter(document, namespace());
    const bootstrap = Y.encodeStateAsUpdate(document);
    await adapter.enqueueInitialDocumentState(bootstrap);
    const created = node('First authenticated edit');
    createNode(document, created);
    await adapter.whenIdle();

    const [initial, edit] = await adapter.listTransportEligibleUpdates();
    expect(initial?.updateBytes).toEqual(bootstrap);
    expect(initial?.initialState).toBe(true);
    expect(edit?.localSequence).toBe((initial?.localSequence ?? 0) + 1);
    const server = createGraphDocument();
    Y.applyUpdate(server, initial!.updateBytes);
    Y.applyUpdate(server, edit!.updateBytes);
    expect(projectGraphDocument(server).nodes.map(({ id }) => id)).toContain(created.id);
    await adapter.acknowledgeUpdate(initial!.updateId, FIRST_SERVER_SEQUENCE);
    expect((await adapter.listAcknowledgedUpdates())[0]?.initialState).toBe(true);
  });

  it('detects an unqueued initial clock after an aborted transaction and reload', async () => {
    const storageNamespace = namespace();
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, storageNamespace, failpoints);
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_LOCAL_UPDATE_WRITE);
    await expect(
      adapter.enqueueInitialDocumentState(Y.encodeStateAsUpdate(document)),
    ).rejects.toThrow();
    expect(await adapter.hasQueuedInitialState()).toBe(false);
    await adapter.close();

    const reopened = createGraphDocument();
    const recovered = await openAdapter(reopened, storageNamespace);
    expect(await recovered.hasQueuedInitialState()).toBe(false);
    await recovered.enqueueInitialDocumentState(Y.encodeStateAsUpdate(reopened));
    expect(await recovered.hasQueuedInitialState()).toBe(true);
  });

  it('creates the named stores at the versioned database boundary', async () => {
    const database = await openSyncClientDatabase();
    const storeNames = [...database.objectStoreNames].sort();
    database.close();

    expect(SYNC_DATABASE_VERSION).toBe(LEGACY_SYNC_DATABASE_VERSION + 1);
    expect(storeNames).toEqual(Object.values(SYNC_STORE_NAMES).sort());
  });

  it('upgrades the existing database without deleting its local snapshot', async () => {
    const storageNamespace = namespace();
    const key = boardStorageNamespaceKey(storageNamespace);
    const base = createGraphDocument();
    const bytes = Y.encodeStateAsUpdate(base);
    const pendingNode = node('Legacy pending edit');
    const pendingBytes = updateAddingNode(base, pendingNode);
    const updateId = crypto.randomUUID();
    const legacy = await openDB(SYNC_DATABASE_NAME, LEGACY_SYNC_DATABASE_VERSION, {
      upgrade(database) {
        database.createObjectStore(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, { keyPath: 'namespace' });
        const updates = database.createObjectStore(SYNC_STORE_NAMES.LOCAL_UPDATES, {
          keyPath: ['namespace', 'localSequence'],
        });
        updates.createIndex(SYNC_INDEX_NAMES.BY_NAMESPACE, 'namespace');
        const outbox = database.createObjectStore(SYNC_STORE_NAMES.OUTBOX, {
          keyPath: ['namespace', 'updateId'],
        });
        outbox.createIndex(SYNC_INDEX_NAMES.BY_NAMESPACE, 'namespace');
        outbox.createIndex(SYNC_INDEX_NAMES.BY_NAMESPACE_AND_SEQUENCE, [
          'namespace',
          'localSequence',
        ]);
        database.createObjectStore(SYNC_STORE_NAMES.BOARD_CACHE, { keyPath: 'namespace' });
      },
    });
    await legacy.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
      namespace: key,
      throughLocalSequence: 0,
      updateBytes: bytes,
      updatedAt: FIXED_TIME.toISOString(),
    });
    await legacy.put(SYNC_STORE_NAMES.LOCAL_UPDATES, {
      namespace: key,
      localSequence: 1,
      updateId,
      updateBytes: pendingBytes,
      direction: LOCAL_UPDATE_DIRECTIONS.LOCAL,
      createdAt: FIXED_TIME.toISOString(),
    });
    await legacy.put(SYNC_STORE_NAMES.OUTBOX, {
      namespace: key,
      updateId,
      localSequence: 1,
      updateBytes: pendingBytes,
      payloadHash: await sha256(pendingBytes),
      createdAt: FIXED_TIME.toISOString(),
      status: OUTBOX_STATUSES.PENDING,
    });
    legacy.close();
    const upgraded = await openSyncClientDatabase();
    expect([...upgraded.objectStoreNames].sort()).toEqual(Object.values(SYNC_STORE_NAMES).sort());
    expect((await upgraded.get(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, key))?.updateBytes).toEqual(bytes);
    upgraded.close();
    const reopenedDocument = createGraphDocument();
    const adapter = await openAdapter(reopenedDocument, storageNamespace);
    expect(projectGraphDocument(reopenedDocument).nodes.map(({ id }) => id)).toContain(
      pendingNode.id,
    );
    expect((await adapter.listTransportEligibleUpdates())[0]).toMatchObject({
      updateId,
      updateBytes: pendingBytes,
    });
  });

  it('namespaces records by deployment, user, board, and graph schema version', async () => {
    const boardId = crypto.randomUUID();
    const baseline = namespace({ boardId });
    const keys = new Set([
      boardStorageNamespaceKey(baseline),
      boardStorageNamespaceKey({
        ...baseline,
        deploymentOrigin: ALTERNATE_DEPLOYMENT_ORIGIN,
      }),
      boardStorageNamespaceKey({ ...baseline, userId: ALTERNATE_USER_ID }),
      boardStorageNamespaceKey({ ...baseline, boardId: crypto.randomUUID() }),
      boardStorageNamespaceKey({
        ...baseline,
        graphSchemaVersion: GRAPH_SCHEMA_VERSION + 1,
      }),
    ]);
    expect(keys.size).toBe(EXPECTED_NAMESPACE_KEY_COUNT);

    const firstDocument = createGraphDocument();
    const secondDocument = createGraphDocument();
    const first = await openAdapter(firstDocument, baseline);
    const second = await openAdapter(secondDocument, {
      ...baseline,
      userId: ALTERNATE_USER_ID,
    });
    createNode(firstDocument, node('Only in first namespace'));
    await first.whenIdle();

    expect(await first.listTransportEligibleUpdates()).toHaveLength(1);
    expect(await second.listTransportEligibleUpdates()).toHaveLength(0);
  });

  it('stores the exact local Yjs bytes in the log and outbox before transport eligibility', async () => {
    const document = createGraphDocument();
    const storageNamespace = namespace();
    const adapter = await openAdapter(document, storageNamespace);
    let emittedUpdate: Uint8Array | undefined;
    document.on('update', (updateBytes, origin) => {
      if (origin === COMMAND_ORIGINS.LOCAL_STRUCTURAL) {
        emittedUpdate = Uint8Array.from(updateBytes);
      }
    });

    createNode(document, node('Persist exact bytes'));
    expect(adapter.persistenceStatus()).toEqual({
      phase: LOCAL_PERSISTENCE_PHASES.SAVING,
      savedOnDevice: false,
      editingPaused: false,
      pendingWrites: 1,
      errorCode: null,
      diagnostic: null,
    });
    await adapter.whenIdle();

    const localUpdates = await adapter.listLocalUpdates();
    const outbox = await adapter.listTransportEligibleUpdates();
    expect(emittedUpdate).toBeDefined();
    expect(localUpdates).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(localUpdates[0]!.updateBytes).toEqual(emittedUpdate);
    expect(outbox[0]!.updateBytes).toEqual(emittedUpdate);
    expect(outbox[0]!.payloadHash).toEqual(await sha256(emittedUpdate!));
    expect(outbox[0]!.localSequence).toBe(localUpdates[0]!.localSequence);
    expect(outbox[0]!.updateId).toBe(localUpdates[0]!.updateId);
    expect(adapter.persistenceStatus()).toEqual({
      phase: LOCAL_PERSISTENCE_PHASES.SAVED,
      savedOnDevice: true,
      editingPaused: false,
      pendingWrites: 0,
      errorCode: null,
      diagnostic: null,
    });
    await adapter.close();
    const resumed = await openAdapter(createGraphDocument(), storageNamespace);
    expect(await resumed.listTransportEligibleUpdates()).toEqual(outbox);
  });

  it('keeps the first pending payload when an update ID is generated twice', async () => {
    const document = createGraphDocument();
    const updateId = crypto.randomUUID();
    const adapter = await LocalPersistenceAdapter.open({
      namespace: namespace(),
      document,
      createUpdateId: () => updateId,
    });
    openAdapters.push(adapter);
    createNode(document, node('First ID use'));
    await adapter.whenIdle();
    const first = await adapter.listTransportEligibleUpdates();
    createNode(document, node('Duplicate ID use'));
    await adapter.whenIdle();
    expect(adapter.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
    });
    expect(await adapter.listLocalUpdates()).toHaveLength(1);
    expect(await adapter.listTransportEligibleUpdates()).toEqual(first);
  });

  it('persists ACK state and removes its outbox item atomically', async () => {
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const storageNamespace = namespace();
    const adapter = await openAdapter(document, storageNamespace, failpoints);
    createNode(document, node('Acknowledged update'));
    await adapter.whenIdle();
    const firstOutbox = (await adapter.listTransportEligibleUpdates())[0]!;

    await adapter.acknowledgeUpdate(firstOutbox.updateId, FIRST_SERVER_SEQUENCE);
    const acknowledged = (await adapter.listLocalUpdates())[0]!;
    expect(acknowledged.acknowledgedServerSequence).toBe(FIRST_SERVER_SEQUENCE);
    expect(acknowledged.acknowledgedAt).toBe(FIXED_TIME.toISOString());
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
    expect(await adapter.listAcknowledgedUpdates()).toEqual([
      {
        namespace: boardStorageNamespaceKey(storageNamespace),
        updateId: firstOutbox.updateId,
        localSequence: firstOutbox.localSequence,
        serverSequence: FIRST_SERVER_SEQUENCE,
        acknowledgedAt: FIXED_TIME.toISOString(),
      },
    ]);
    expect(await adapter.lastReceivedServerSequence()).toBe(FIRST_SERVER_SEQUENCE);

    createNode(document, node('ACK transaction must abort'));
    await adapter.whenIdle();
    const secondOutbox = (await adapter.listTransportEligibleUpdates())[0]!;
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_ACK_WRITE);
    await expect(
      adapter.acknowledgeUpdate(secondOutbox.updateId, SECOND_SERVER_SEQUENCE),
    ).rejects.toBeInstanceOf(LocalPersistenceError);

    const recordsAfterAbort = await adapter.listLocalUpdates();
    expect(recordsAfterAbort).toHaveLength(TWO_LOG_RECORDS);
    expect(recordsAfterAbort[1]!.acknowledgedServerSequence).toBeUndefined();
    expect(await adapter.listTransportEligibleUpdates()).toEqual([secondOutbox]);
    expect(await adapter.listAcknowledgedUpdates()).toHaveLength(1);
    expect(await adapter.lastReceivedServerSequence()).toBe(FIRST_SERVER_SEQUENCE);
  });

  it('ACKs a pending entry after its log row was compacted and preserves the receipt through reload', async () => {
    const storageNamespace = namespace();
    const document = createGraphDocument();
    const first = await openAdapter(document, storageNamespace);
    for (let index = 0; index < LOCAL_SNAPSHOT_UPDATE_THRESHOLD; index += 1) {
      createNode(document, node(`Compacted pending ${index}`));
    }
    await first.whenIdle();
    const pending = await first.listTransportEligibleUpdates();
    expect(pending).toHaveLength(LOCAL_SNAPSHOT_UPDATE_THRESHOLD);
    expect(await first.listLocalUpdates()).toHaveLength(0);
    await first.close();

    const reopened = await openAdapter(createGraphDocument(), storageNamespace);
    await reopened.acknowledgeUpdate(pending[0]!.updateId, FIRST_SERVER_SEQUENCE);
    expect(await reopened.listTransportEligibleUpdates()).toHaveLength(
      ONE_BELOW_SNAPSHOT_THRESHOLD,
    );
    expect(await reopened.listAcknowledgedUpdates()).toMatchObject([
      { updateId: pending[0]!.updateId, serverSequence: FIRST_SERVER_SEQUENCE },
    ]);
    expect(await reopened.lastReceivedServerSequence()).toBe(FIRST_SERVER_SEQUENCE);
    await reopened.acknowledgeUpdate(pending[0]!.updateId, FIRST_SERVER_SEQUENCE);
    await expect(
      reopened.acknowledgeUpdate(pending[0]!.updateId, SECOND_SERVER_SEQUENCE),
    ).rejects.toBeInstanceOf(LocalPersistenceError);
    expect(await reopened.lastReceivedServerSequence()).toBe(FIRST_SERVER_SEQUENCE);
    expect(await reopened.listTransportEligibleUpdates()).toHaveLength(
      ONE_BELOW_SNAPSHOT_THRESHOLD,
    );
  });

  it('keeps the received server sequence monotonic when receipts arrive out of order', async () => {
    const document = createGraphDocument();
    const adapter = await openAdapter(document, namespace());
    createNode(document, node('First local update'));
    createNode(document, node('Second local update'));
    await adapter.whenIdle();
    const pending = await adapter.listTransportEligibleUpdates();
    await adapter.acknowledgeUpdate(pending[1]!.updateId, SECOND_SERVER_SEQUENCE);
    await adapter.acknowledgeUpdate(pending[0]!.updateId, FIRST_SERVER_SEQUENCE);
    expect(await adapter.lastReceivedServerSequence()).toBe(SECOND_SERVER_SEQUENCE);
    expect(await adapter.listAcknowledgedUpdates()).toHaveLength(TWO_LOG_RECORDS);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
  });

  it('keeps hydration, remote application, and local-command origins distinct', async () => {
    const document = createGraphDocument();
    const adapter = await openAdapter(document, namespace());
    const origins: unknown[] = [];
    document.on('update', (_updateBytes, origin) => origins.push(origin));

    const hydratedNode = node('Hydrated node');
    const hydrationSource = createGraphDocument();
    createNode(hydrationSource, hydratedNode);
    adapter.hydrate(Y.encodeStateAsUpdate(hydrationSource));
    expect(await adapter.listLocalUpdates()).toHaveLength(0);

    const remoteBytes = updateAddingNode(document, node('Remote node'));
    await adapter.applyRemoteAndPersist(remoteBytes, FIRST_SERVER_SEQUENCE);
    createNode(document, node('Local node'));
    await adapter.whenIdle();

    const records = await adapter.listLocalUpdates();
    expect(origins).toContain(COMMAND_ORIGINS.HYDRATION);
    expect(origins).toContain(COMMAND_ORIGINS.REMOTE);
    expect(origins).toContain(COMMAND_ORIGINS.LOCAL_STRUCTURAL);
    expect(records.map(({ direction }) => direction)).toEqual(['remote', 'local']);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(1);
    expect(await adapter.lastReceivedServerSequence()).toBe(FIRST_SERVER_SEQUENCE);
  });

  it('rolls back a failed inbound transaction without applying the remote update', async () => {
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, namespace(), failpoints);
    const remoteBytes = updateAddingNode(document, node('Remote transaction failure'));
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_REMOTE_UPDATE_WRITE);
    await expect(
      adapter.applyRemoteAndPersist(remoteBytes, FIRST_SERVER_SEQUENCE),
    ).rejects.toBeInstanceOf(LocalPersistenceError);
    expect(projectGraphDocument(document).nodes).toHaveLength(0);
    expect(await adapter.listLocalUpdates()).toHaveLength(0);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
    expect(await adapter.lastReceivedServerSequence()).toBe('0');
    expect(adapter.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
      editingPaused: true,
    });
  });

  it('proves A22 when the local update/outbox transaction fails', async () => {
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, namespace(), failpoints);
    const inMemoryNode = node('Export after storage failure');
    const observedPhases: string[] = [];
    adapter.subscribe(() => observedPhases.push(adapter.getSnapshot().phase));
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_LOCAL_UPDATE_WRITE);

    createNode(document, inMemoryNode);
    await adapter.whenIdle();

    expect(adapter.persistenceStatus()).toEqual({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
      editingPaused: true,
      pendingWrites: 0,
      errorCode: ERROR_CODES.PERSISTENCE_FAILED,
      diagnostic: 'Local persistence failed; export the in-memory graph before leaving.',
    });
    expect(await adapter.listLocalUpdates()).toHaveLength(0);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
    expect(() => adapter.assertEditingAllowed()).toThrow(EditingPausedForStorageError);
    expect(adapter.exportInMemoryProjection().nodes).toContainEqual(inMemoryNode);
    expect(observedPhases).toContain(LOCAL_PERSISTENCE_PHASES.SAVING);
    expect(observedPhases).not.toContain(LOCAL_PERSISTENCE_PHASES.SAVED);
  });

  it('keeps an earlier pending entry when a later local transaction aborts', async () => {
    const storageNamespace = namespace();
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, storageNamespace, failpoints);
    createNode(document, node('Already durable'));
    await adapter.whenIdle();
    const durableOutbox = await adapter.listTransportEligibleUpdates();
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_LOCAL_UPDATE_WRITE);
    createNode(document, node('Failed later edit'));
    await adapter.whenIdle();
    expect(adapter.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
    });
    expect(await adapter.listTransportEligibleUpdates()).toEqual(durableOutbox);
    await adapter.close();
    const resumed = await openAdapter(createGraphDocument(), storageNamespace);
    expect(await resumed.listTransportEligibleUpdates()).toEqual(durableOutbox);
  });
});

describe('productized IndexedDB hydration, snapshot, outbox, and failure lifecycle', () => {
  it('hydrates read-only mode without attaching a persistence writer', async () => {
    const storageNamespace = namespace();
    const writerDocument = createGraphDocument();
    const writer = await openAdapter(writerDocument, storageNamespace);
    createNode(writerDocument, node('Durable writer node'));
    await writer.whenIdle();
    await writer.close();

    const readOnlyDocument = createGraphDocument();
    const readOnly = await LocalPersistenceAdapter.open({
      namespace: storageNamespace,
      document: readOnlyDocument,
      mode: 'read-only',
    });
    openAdapters.push(readOnly);
    const before = await listBoardStorageNamespaceRecords(storageNamespace);
    expect(readOnly.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.READY,
      editingPaused: true,
    });
    expect(() => readOnly.assertEditingAllowed()).toThrow(EditingPausedForStorageError);
    createNode(readOnlyDocument, node('Must remain memory-only'));
    await readOnly.whenIdle();
    const after = await listBoardStorageNamespaceRecords(storageNamespace);
    expect(after.localUpdates).toEqual(before.localUpdates);
    expect(after.outbox).toEqual(before.outbox);
  });

  it('uses both named snapshot thresholds at their exact boundaries', () => {
    expect(shouldCreateLocalSnapshot(ONE_BELOW_SNAPSHOT_THRESHOLD, 0)).toBe(false);
    expect(shouldCreateLocalSnapshot(LOCAL_SNAPSHOT_UPDATE_THRESHOLD, 0)).toBe(true);
    expect(shouldCreateLocalSnapshot(0, LOCAL_SNAPSHOT_BYTE_THRESHOLD - 1)).toBe(false);
    expect(shouldCreateLocalSnapshot(0, LOCAL_SNAPSHOT_BYTE_THRESHOLD)).toBe(true);
  });

  it('reopens an equivalent graph without producing hydration log or outbox records', async () => {
    const storageNamespace = namespace();
    const firstDocument = createGraphDocument();
    const first = await openAdapter(firstDocument, storageNamespace);
    const firstNode = node('Browser');
    const secondNode = node('API');
    const connection = edge(firstNode.id, secondNode.id);
    createNode(firstDocument, firstNode);
    createNode(firstDocument, secondNode);
    createEdge(firstDocument, connection);
    await first.whenIdle();
    const expected = projectGraphDocument(firstDocument);
    const localCount = (await first.listLocalUpdates()).length;
    const outboxCount = (await first.listTransportEligibleUpdates()).length;
    await first.close();

    const reopenedDocument = createGraphDocument();
    const reopened = await openAdapter(reopenedDocument, storageNamespace);

    expect(projectGraphDocument(reopenedDocument)).toEqual(expected);
    expect(localCount).toBeGreaterThan(0);
    expect(await reopened.listLocalUpdates()).toHaveLength(0);
    expect((await reopened.localSnapshot())?.throughLocalSequence).toBe(localCount);
    expect(await reopened.listTransportEligibleUpdates()).toHaveLength(outboxCount);
    expect(reopened.persistenceStatus().phase).toBe(LOCAL_PERSISTENCE_PHASES.READY);
  });

  it('persists undo-manager updates so later local commands reopen without a Yjs clock gap', async () => {
    const storageNamespace = namespace();
    const document = createGraphDocument();
    const adapter = await openAdapter(document, storageNamespace);
    const graphNode = node('Original');
    createNode(document, graphNode);
    const undo = createLocalUndoManager(document);
    editGraphText(
      document,
      { entity: 'node', id: graphNode.id, field: 'title' },
      { index: 0, deleteCount: graphNode.title.length, insert: 'Edited' },
    );
    undo.undo();
    deleteGraphObjects(document, { nodeIds: [graphNode.id] });
    await adapter.whenIdle();
    expect(projectGraphDocument(document).nodes).toHaveLength(0);
    await adapter.close();

    const reopenedDocument = createGraphDocument();
    await openAdapter(reopenedDocument, storageNamespace);
    expect(projectGraphDocument(reopenedDocument).nodes).toHaveLength(0);
    undo.destroy();
  });

  it('publishes immutable loading, saving, and saved snapshots with exact pending counts', async () => {
    const document = createGraphDocument();
    const adapter = LocalPersistenceAdapter.create({
      namespace: namespace(),
      document,
      now: () => FIXED_TIME,
    });
    openAdapters.push(adapter);
    const snapshots = [adapter.getSnapshot()];
    const unsubscribe = adapter.subscribe(() => snapshots.push(adapter.getSnapshot()));

    expect(adapter.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.LOADING,
      editingPaused: true,
      pendingWrites: 0,
    });
    await adapter.initialize();
    createNode(document, node('First queued write'));
    createNode(document, node('Second queued write'));
    await adapter.whenIdle();
    unsubscribe();

    expect(snapshots.every(Object.isFrozen)).toBe(true);
    expect(snapshots.map(({ phase }) => phase)).toContain(LOCAL_PERSISTENCE_PHASES.READY);
    expect(snapshots).toContainEqual(
      expect.objectContaining({ phase: LOCAL_PERSISTENCE_PHASES.SAVING, pendingWrites: 2 }),
    );
    expect(snapshots.at(-1)).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.SAVED,
      savedOnDevice: true,
      pendingWrites: 0,
    });
  });

  it('snapshots at the named boundary, preserves outbox, and recovers an interrupted cleanup path', async () => {
    const storageNamespace = namespace();
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, storageNamespace, failpoints);
    for (let index = 0; index < ONE_BELOW_SNAPSHOT_THRESHOLD; index += 1) {
      createNode(document, node(`Before threshold ${index}`));
    }
    await adapter.whenIdle();
    expect((await adapter.localSnapshot())?.throughLocalSequence).toBe(0);
    expect(await adapter.listLocalUpdates()).toHaveLength(ONE_BELOW_SNAPSHOT_THRESHOLD);

    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_SNAPSHOT_WRITE);
    createNode(document, node('At snapshot threshold'));
    await adapter.whenIdle();
    const expectedAtSnapshot = projectGraphDocument(document);
    expect((await adapter.localSnapshot())?.throughLocalSequence).toBe(
      LOCAL_SNAPSHOT_UPDATE_THRESHOLD,
    );
    expect(await adapter.listLocalUpdates()).toHaveLength(LOCAL_SNAPSHOT_UPDATE_THRESHOLD);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(
      LOCAL_SNAPSHOT_UPDATE_THRESHOLD,
    );
    await adapter.close();

    const reopenedDocument = createGraphDocument();
    const reopened = await openAdapter(reopenedDocument, storageNamespace);
    expect(projectGraphDocument(reopenedDocument)).toEqual(expectedAtSnapshot);
    expect(await reopened.listLocalUpdates()).toHaveLength(0);
    expect(await reopened.listTransportEligibleUpdates()).toHaveLength(
      LOCAL_SNAPSHOT_UPDATE_THRESHOLD,
    );

    createNode(reopenedDocument, node('After snapshot'));
    await reopened.whenIdle();
    const expectedWithLaterLog = projectGraphDocument(reopenedDocument);
    expect(await reopened.listLocalUpdates()).toHaveLength(1);
    await reopened.close();

    const finalDocument = createGraphDocument();
    const finalAdapter = await openAdapter(finalDocument, storageNamespace);
    expect(projectGraphDocument(finalDocument)).toEqual(expectedWithLaterLog);
    expect(await finalAdapter.listTransportEligibleUpdates()).toHaveLength(
      LOCAL_SNAPSHOT_UPDATE_THRESHOLD + 1,
    );
  });

  it('enters recovery-required for a sequence gap without altering cached records', async () => {
    const storageNamespace = namespace();
    const sourceDocument = createGraphDocument();
    const source = await openAdapter(sourceDocument, storageNamespace);
    createNode(sourceDocument, node('Gap source'));
    await source.whenIdle();
    const [record] = await source.listLocalUpdates();
    await source.close();

    const database = await openSyncClientDatabase();
    const key = boardStorageNamespaceKey(storageNamespace);
    await database.delete(SYNC_STORE_NAMES.LOCAL_UPDATES, [key, record!.localSequence]);
    await database.put(SYNC_STORE_NAMES.LOCAL_UPDATES, {
      ...record!,
      localSequence: record!.localSequence + 1,
    });
    database.close();

    const recovered = await openAdapter(createGraphDocument(), storageNamespace);
    expect(recovered.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED,
      editingPaused: true,
      errorCode: ERROR_CODES.CAUSAL_GAP,
    });
    expect(await recovered.listLocalUpdates()).toHaveLength(1);
    expect(await recovered.listTransportEligibleUpdates()).toHaveLength(1);
  });

  it('rejects invalid snapshots and unsupported cached schema without overwriting bytes', async () => {
    const invalidNamespace = namespace();
    const unsupportedNamespace = namespace({ graphSchemaVersion: GRAPH_SCHEMA_VERSION + 1 });
    const database = await openSyncClientDatabase();
    const invalidKey = boardStorageNamespaceKey(invalidNamespace);
    const invalidBytes = new TextEncoder().encode('not a Yjs update');
    await database.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
      namespace: invalidKey,
      throughLocalSequence: 0,
      updateBytes: invalidBytes,
      updatedAt: FIXED_TIME.toISOString(),
    });
    const unsupportedBytes = Y.encodeStateAsUpdate(createGraphDocument());
    await database.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
      namespace: boardStorageNamespaceKey(unsupportedNamespace),
      throughLocalSequence: 0,
      updateBytes: unsupportedBytes,
      updatedAt: FIXED_TIME.toISOString(),
    });
    database.close();

    const invalid = await openAdapter(createGraphDocument(), invalidNamespace);
    expect(invalid.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED,
      errorCode: ERROR_CODES.DOCUMENT_INVALID,
    });
    expect((await invalid.localSnapshot())?.updateBytes).toEqual(invalidBytes);

    const unsupported = await openAdapter(createGraphDocument(), unsupportedNamespace);
    expect(unsupported.getSnapshot()).toMatchObject({
      phase: LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED,
      errorCode: ERROR_CODES.SCHEMA_UNSUPPORTED,
    });
    expect(
      (await listBoardStorageNamespaceRecords(unsupportedNamespace)).snapshot?.updateBytes,
    ).toEqual(unsupportedBytes);
  });

  it('deletes only a fully resolved namespace and retains neighboring dimensions', async () => {
    const boardId = crypto.randomUUID();
    const target = namespace({ boardId });
    const neighbors = [
      namespace({ boardId, userId: ALTERNATE_USER_ID }),
      namespace({ boardId, deploymentOrigin: ALTERNATE_DEPLOYMENT_ORIGIN }),
      namespace(),
    ];
    for (const [index, storageNamespace] of [target, ...neighbors].entries()) {
      const document = createGraphDocument();
      const adapter = await openAdapter(document, storageNamespace);
      createNode(document, node(`Namespace ${index}`));
      await adapter.whenIdle();
      if (index === 0) {
        const pending = (await adapter.listTransportEligibleUpdates())[0]!;
        await adapter.acknowledgeUpdate(pending.updateId, FIRST_SERVER_SEQUENCE);
      }
    }
    const schemaNeighbor = namespace({
      boardId,
      graphSchemaVersion: GRAPH_SCHEMA_VERSION + 1,
    });
    const database = await openSyncClientDatabase();
    await database.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
      namespace: boardStorageNamespaceKey(schemaNeighbor),
      throughLocalSequence: 0,
      updateBytes: Y.encodeStateAsUpdate(createGraphDocument()),
      updatedAt: FIXED_TIME.toISOString(),
    });
    database.close();

    await deleteBoardStorageNamespace(target);

    const deleted = await listBoardStorageNamespaceRecords(target);
    expect(deleted).toMatchObject({
      snapshot: null,
      localUpdates: [],
      outbox: [],
      receipts: [],
      receivedState: null,
      boardCache: null,
    });
    for (const storageNamespace of neighbors) {
      expect((await listBoardStorageNamespaceRecords(storageNamespace)).localUpdates).toHaveLength(
        1,
      );
    }
    expect((await listBoardStorageNamespaceRecords(schemaNeighbor)).snapshot).not.toBeNull();
    await expect(deleteBoardStorageNamespace({ ...target, boardId: '' })).rejects.toThrow();
  });

  it('flushes a pending write on idempotent close and tolerates close during initialization', async () => {
    const storageNamespace = namespace();
    const document = createGraphDocument();
    const adapter = await openAdapter(document, storageNamespace);
    createNode(document, node('Close while saving'));
    const firstClose = adapter.close();
    const secondClose = adapter.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    const records = await listBoardStorageNamespaceRecords(storageNamespace);
    expect(records.localUpdates).toHaveLength(1);
    expect(records.outbox).toHaveLength(1);

    const partial = LocalPersistenceAdapter.create({
      namespace: namespace(),
      document: createGraphDocument(),
    });
    openAdapters.push(partial);
    const initialization = partial.initialize();
    await expect(
      Promise.all([initialization, partial.close(), partial.close()]),
    ).resolves.toBeDefined();
  });
});
