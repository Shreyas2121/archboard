import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
} from '@archboard/contracts';
import { COMMAND_ORIGINS, createGraphDocument, createNode } from '@archboard/document-model';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import * as Y from 'yjs';

import {
  SYNC_DATABASE_NAME,
  SYNC_DATABASE_VERSION,
  SYNC_STORE_NAMES,
  UPDATE_HASH_ALGORITHM,
} from '../config/index.js';
import { openSyncClientDatabase } from './database.js';
import { INDEXEDDB_FAILPOINTS, IndexedDbFailpointController } from './failpoints.js';
import {
  EditingPausedForStorageError,
  LOCAL_PERSISTENCE_PHASES,
  LocalPersistenceAdapter,
  LocalPersistenceError,
} from './local-persistence-adapter.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from './namespace.js';

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
  it('creates exactly the four named stores at the versioned database boundary', async () => {
    const database = await openSyncClientDatabase();
    const storeNames = [...database.objectStoreNames].sort();
    database.close();

    expect(SYNC_DATABASE_VERSION).toBe(1);
    expect(storeNames).toEqual(Object.values(SYNC_STORE_NAMES).sort());
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
    const adapter = await openAdapter(document, namespace());
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
      errorCode: null,
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
    expect(adapter.persistenceStatus()).toEqual({
      phase: LOCAL_PERSISTENCE_PHASES.SAVED,
      savedOnDevice: true,
      editingPaused: false,
      errorCode: null,
    });
  });

  it('persists ACK state and removes its outbox item atomically', async () => {
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, namespace(), failpoints);
    createNode(document, node('Acknowledged update'));
    await adapter.whenIdle();
    const firstOutbox = (await adapter.listTransportEligibleUpdates())[0]!;

    await adapter.acknowledgeUpdate(firstOutbox.updateId, FIRST_SERVER_SEQUENCE);
    const acknowledged = (await adapter.listLocalUpdates())[0]!;
    expect(acknowledged.acknowledgedServerSequence).toBe(FIRST_SERVER_SEQUENCE);
    expect(acknowledged.acknowledgedAt).toBe(FIXED_TIME.toISOString());
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);

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
  });

  it('proves A22 when the local update/outbox transaction fails', async () => {
    const document = createGraphDocument();
    const failpoints = new IndexedDbFailpointController();
    const adapter = await openAdapter(document, namespace(), failpoints);
    const inMemoryNode = node('Export after storage failure');
    failpoints.arm(INDEXEDDB_FAILPOINTS.AFTER_LOCAL_UPDATE_WRITE);

    createNode(document, inMemoryNode);
    await adapter.whenIdle();

    expect(adapter.persistenceStatus()).toEqual({
      phase: LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR,
      savedOnDevice: false,
      editingPaused: true,
      errorCode: ERROR_CODES.PERSISTENCE_FAILED,
    });
    expect(await adapter.listLocalUpdates()).toHaveLength(0);
    expect(await adapter.listTransportEligibleUpdates()).toHaveLength(0);
    expect(() => adapter.assertEditingAllowed()).toThrow(EditingPausedForStorageError);
    expect(adapter.exportInMemoryProjection().nodes).toContainEqual(inMemoryNode);
  });
});
