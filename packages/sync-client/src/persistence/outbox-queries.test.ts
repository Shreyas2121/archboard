import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';
import type * as DatabaseModule from './database.js';

import { SYNC_INDEX_NAMES, SYNC_STORE_NAMES } from '../config/index.js';
import { LocalPersistenceAdapter } from './local-persistence-adapter.js';
import { boardStorageNamespaceKey } from './namespace.js';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./database.js', async (original) => ({
  ...(await original<typeof DatabaseModule>()),
  openSyncClientDatabase: mocks.open,
}));
const BACKLOG_SIZE = 1_000;
const PAYLOAD_BYTES = 1_024;

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.open.mockReset();
});

describe('focused outbox persistence queries', () => {
  it('counts without payload reads, fetches one oldest payload, and addresses receipts directly', async () => {
    const document = createGraphDocument();
    const namespace = {
      deploymentOrigin: 'https://example.test',
      userId: 'query-user',
      boardId: crypto.randomUUID(),
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    };
    const key = boardStorageNamespaceKey(namespace);
    const backlog = Array.from({ length: BACKLOG_SIZE }, (_, index) => ({
      namespace: key,
      localSequence: index + 1,
      updateId: crypto.randomUUID(),
      updateBytes: new Uint8Array(PAYLOAD_BYTES).fill(index),
      payloadHash: new Uint8Array(),
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    }));
    let payloadReads = 0;
    const database = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      close: vi.fn(),
      countFromIndex: vi.fn(async () => backlog.length),
      getAllFromIndex: vi.fn(
        async (store: string, index: string, _query: unknown, count?: number) => {
          if (store === SYNC_STORE_NAMES.LOCAL_UPDATES) return [];
          expect(store).toBe(SYNC_STORE_NAMES.OUTBOX);
          expect(index).toBe(SYNC_INDEX_NAMES.BY_NAMESPACE_AND_SEQUENCE);
          expect(count).toBe(1);
          payloadReads += Math.min(1, backlog.length);
          return backlog.slice(0, count).map((record) => structuredClone(record));
        },
      ),
    };
    vi.stubGlobal('IDBKeyRange', { bound: (lower: unknown, upper: unknown) => ({ lower, upper }) });
    mocks.open.mockResolvedValue(database);
    const adapter = await LocalPersistenceAdapter.open({ namespace, document });
    try {
      expect(await adapter.countPendingUpdates()).toBe(BACKLOG_SIZE);
      expect(payloadReads).toBe(0);
      expect(database.countFromIndex).toHaveBeenCalledWith(
        SYNC_STORE_NAMES.OUTBOX,
        SYNC_INDEX_NAMES.BY_NAMESPACE,
        key,
      );
      const original = backlog[0]!;
      const first = await adapter.oldestPendingUpdate();
      expect(first).toEqual(original);
      expect(first?.updateBytes).not.toBe(original.updateBytes);
      expect(database.getAllFromIndex).toHaveBeenLastCalledWith(
        SYNC_STORE_NAMES.OUTBOX,
        SYNC_INDEX_NAMES.BY_NAMESPACE_AND_SEQUENCE,
        { lower: [key, 0], upper: [key, Number.MAX_SAFE_INTEGER] },
        1,
      );
      const readId = original.updateId;
      await adapter.acknowledgedUpdate(readId);
      expect(database.get).toHaveBeenLastCalledWith(SYNC_STORE_NAMES.OUTBOX_RECEIPTS, [
        key,
        readId,
      ]);
      for (let remaining = BACKLOG_SIZE; remaining > 0; remaining -= 1) {
        expect(await adapter.countPendingUpdates()).toBe(remaining);
        expect((await adapter.oldestPendingUpdate())?.updateId).toBe(backlog[0]?.updateId);
        backlog.shift();
      }
      expect(await adapter.oldestPendingUpdate()).toBeNull();
      expect(payloadReads).toBe(BACKLOG_SIZE + 1);
    } finally {
      await adapter.close();
      document.destroy();
    }
  });
});
