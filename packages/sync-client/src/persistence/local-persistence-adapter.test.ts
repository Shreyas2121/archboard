import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { COLOR_TOKENS, GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import {
  createGraphDocument,
  createNode,
  editGraphText,
  projectGraphDocument,
} from '@archboard/document-model';

import { SYNC_STORE_NAMES } from '../config/index.js';
import type * as SyncConfig from '../config/index.js';
import type * as DatabaseModule from './database.js';
import { LocalPersistenceAdapter } from './local-persistence-adapter.js';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./database.js', async (original) => ({
  ...(await original<typeof DatabaseModule>()),
  openSyncClientDatabase: mocks.open,
}));
vi.mock('../config/index.js', async (original) => ({
  ...(await original<typeof SyncConfig>()),
  LOCAL_SNAPSHOT_UPDATE_THRESHOLD: 1,
}));

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface StoredRecord {
  readonly namespace: string;
  readonly localSequence?: number;
  readonly updateId?: string | null;
}

// This model controls adapter awaits; it does not stand in for IndexedDB's
// transaction/rollback semantics, which remain covered by deferred browser tests.
function memoryDatabase() {
  const tables = new Map<string, Map<string, StoredRecord>>();
  let hook: (operation: string) => Promise<void> = async () => {};
  const table = (name: string) => {
    let records = tables.get(name);
    if (records === undefined) {
      records = new Map();
      tables.set(name, records);
    }
    return records;
  };
  const key = (name: string, record: StoredRecord) =>
    JSON.stringify(
      name === SYNC_STORE_NAMES.LOCAL_UPDATES
        ? [record.namespace, record.localSequence]
        : name === SYNC_STORE_NAMES.OUTBOX || name === SYNC_STORE_NAMES.OUTBOX_RECEIPTS
          ? [record.namespace, record.updateId]
          : record.namespace,
    );
  const store = (name: string) => ({
    async get(recordKey: unknown) {
      const result = structuredClone(table(name).get(JSON.stringify(recordKey)));
      await hook(`get:${name}`);
      return result;
    },
    async put(record: StoredRecord) {
      table(name).set(key(name, record), structuredClone(record));
      await hook(`put:${name}`);
    },
    async add(record: StoredRecord) {
      await hook(`add:${name}`);
      table(name).set(key(name, record), structuredClone(record));
    },
    async delete(recordKey: unknown) {
      table(name).delete(JSON.stringify(recordKey));
      await hook(`delete:${name}`);
    },
  });
  return {
    setHook(next: typeof hook) {
      hook = next;
    },
    close: vi.fn(),
    get: (name: string, recordKey: unknown) => store(name).get(recordKey),
    put: (name: string, record: StoredRecord) => store(name).put(record),
    async getAllFromIndex(name: string, _index: string, namespace: string) {
      const result = structuredClone(
        [...table(name).values()].filter((record) => record.namespace === namespace),
      );
      await hook(`getAll:${name}`);
      return result;
    },
    transaction(names: string | string[]) {
      const name = typeof names === 'string' ? names : names.join(',');
      return {
        objectStore: store,
        store: typeof names === 'string' ? store(names) : undefined,
        get done() {
          return hook(`done:${name}`);
        },
      };
    },
  };
}

const NODE_SIZE = { width: 240, height: 140 };

beforeEach(() => mocks.open.mockReset());

describe('committed snapshot frontier', () => {
  it.each(
    [
      `get:${SYNC_STORE_NAMES.LOCAL_SNAPSHOTS}`,
      `getAll:${SYNC_STORE_NAMES.LOCAL_UPDATES}`,
      `put:${SYNC_STORE_NAMES.LOCAL_SNAPSHOTS}`,
      `delete:${SYNC_STORE_NAMES.LOCAL_UPDATES}`,
      `done:${SYNC_STORE_NAMES.LOCAL_UPDATES}`,
    ].flatMap((stage) => [
      { stage, remote: false },
      { stage, remote: true },
    ]),
  )('keeps edits unsaved during $stage (remote=$remote)', async ({ stage, remote }) => {
    const database = memoryDatabase();
    mocks.open.mockResolvedValue(database);
    const namespace = {
      deploymentOrigin: 'https://example.test',
      userId: 'test-user',
      boardId: crypto.randomUUID(),
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    };
    const document = createGraphDocument();
    const peer = createGraphDocument();
    const timing = vi.fn((stage: 'local-queue' | 'local-write', durationMs: number) => {
      expect(['local-queue', 'local-write']).toContain(stage);
      expect(durationMs).toBeGreaterThanOrEqual(0);
      throw new Error('Synthetic diagnostic sink failure');
    });
    const adapter = await LocalPersistenceAdapter.open({ namespace, document, onTiming: timing });
    const paused = deferred();
    const resume = deferred();
    const nextWrite = deferred();
    const commit = deferred();
    let reached = false;
    database.setHook(async (operation) => {
      if (operation === stage && !reached) {
        reached = true;
        paused.resolve();
        await resume.promise;
      } else if (reached && operation === `add:${SYNC_STORE_NAMES.OUTBOX}`) {
        nextWrite.resolve();
        await commit.promise;
      }
    });
    const id = crypto.randomUUID();
    const target = { entity: 'node', id, field: 'title' } as const;
    try {
      createNode(remote ? peer : document, {
        id,
        kind: 'note',
        title: 'abc',
        color: COLOR_TOKENS.BLUE,
        position: { x: 0, y: 0 },
        size: NODE_SIZE,
        content: { body: '' },
      });
      const inbound = remote
        ? adapter.applyRemoteAndPersist(Y.encodeStateAsUpdate(peer), '1')
        : Promise.resolve();
      await paused.promise;
      editGraphText(document, target, { index: 'abc'.length, deleteCount: 0, insert: '#' });
      expect(adapter.getSnapshot().savedOnDevice).toBe(false);
      expect(adapter.getSnapshot().pendingWrites).toBe(1);
      resume.resolve();
      await nextWrite.promise;
      expect(adapter.getSnapshot().savedOnDevice).toBe(false);
      expect(adapter.getSnapshot().pendingWrites).toBe(1);

      // Recover at the snapshot boundary while the new edit has no outbox
      // entry yet. Only the previously committed graph may be in the snapshot.
      const snapshot = await adapter.localSnapshot();
      const recovered = createGraphDocument();
      try {
        if (snapshot !== null) Y.applyUpdate(recovered, snapshot.updateBytes);
        for (const record of await adapter.listLocalUpdates()) {
          if (record.localSequence <= (snapshot?.throughLocalSequence ?? 0)) continue;
          // The model exposes the staged local log; exclude its uncommitted row.
          if (record.localSequence > 1) continue;
          Y.applyUpdate(recovered, record.updateBytes);
        }
        expect(projectGraphDocument(recovered).nodes[0]?.title).toBe('abc');
        expect(snapshot?.throughLocalSequence).toBeLessThanOrEqual(1);
      } finally {
        recovered.destroy();
      }
      commit.resolve();
      await inbound;
      await adapter.whenIdle();
      expect(timing.mock.calls.map(([stage]) => stage)).toContain('local-queue');
      expect(timing.mock.calls.map(([stage]) => stage)).toContain('local-write');
      for (const [, durationMs] of timing.mock.calls) {
        expect(Number.isFinite(durationMs)).toBe(true);
        expect(durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(adapter.getSnapshot().savedOnDevice).toBe(true);
      expect(adapter.getSnapshot().pendingWrites).toBe(0);
      const pending = await adapter.listTransportEligibleUpdates();
      expect(pending.some((record) => record.localSequence > 1)).toBe(true);
      const finalSnapshot = await adapter.localSnapshot();
      const finalRecovered = createGraphDocument();
      try {
        expect(finalSnapshot).not.toBeNull();
        Y.applyUpdate(finalRecovered, finalSnapshot!.updateBytes);
        expect(projectGraphDocument(finalRecovered).nodes[0]?.title).toBe('abc#');
      } finally {
        finalRecovered.destroy();
      }
      const reloadedDocument = createGraphDocument();
      const reloaded = await LocalPersistenceAdapter.open({
        namespace,
        document: reloadedDocument,
      });
      try {
        expect(projectGraphDocument(reloadedDocument).nodes[0]?.title).toBe('abc#');
        expect(await reloaded.listTransportEligibleUpdates()).toEqual(pending);
      } finally {
        await reloaded.close();
        reloadedDocument.destroy();
      }
    } finally {
      resume.resolve();
      commit.resolve();
      await adapter.close();
      document.destroy();
      peer.destroy();
    }
  });
});
