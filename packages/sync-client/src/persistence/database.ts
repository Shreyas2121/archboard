import type { BoardRole, ServerSequence } from '@archboard/contracts';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import {
  SYNC_DATABASE_NAME,
  SYNC_DATABASE_VERSION,
  SYNC_INDEX_NAMES,
  SYNC_STORE_NAMES,
} from '../config/index.js';
import type { LOCAL_UPDATE_DIRECTIONS, OUTBOX_STATUSES } from '../config/index.js';

export type LocalUpdateDirection =
  (typeof LOCAL_UPDATE_DIRECTIONS)[keyof typeof LOCAL_UPDATE_DIRECTIONS];

export interface LocalUpdateRecord {
  readonly namespace: string;
  readonly localSequence: number;
  readonly updateId: string | null;
  readonly updateBytes: Uint8Array;
  readonly direction: LocalUpdateDirection;
  readonly createdAt: string;
  readonly acknowledgedServerSequence?: ServerSequence;
  readonly acknowledgedAt?: string;
}

export interface OutboxRecord {
  readonly namespace: string;
  readonly updateId: string;
  readonly localSequence: number;
  readonly updateBytes: Uint8Array;
  readonly payloadHash: Uint8Array;
  readonly createdAt: string;
  readonly status: (typeof OUTBOX_STATUSES)['PENDING'];
}

export interface LocalSnapshotRecord {
  readonly namespace: string;
  readonly throughLocalSequence: number;
  readonly updateBytes: Uint8Array;
  readonly updatedAt: string;
}

export interface BoardCacheRecord {
  readonly namespace: string;
  readonly role: BoardRole;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly cachedAt: string;
  readonly lastServerSequence: ServerSequence;
}

export interface SyncClientDatabase extends DBSchema {
  localSnapshots: {
    key: string;
    value: LocalSnapshotRecord;
  };
  localUpdates: {
    key: [string, number];
    value: LocalUpdateRecord;
    indexes: { byNamespace: string };
  };
  outbox: {
    key: [string, string];
    value: OutboxRecord;
    indexes: {
      byNamespace: string;
      byNamespaceAndSequence: [string, number];
    };
  };
  boardCache: {
    key: string;
    value: BoardCacheRecord;
  };
}

export type SyncClientDatabaseConnection = IDBPDatabase<SyncClientDatabase>;

export async function openSyncClientDatabase(): Promise<SyncClientDatabaseConnection> {
  return openDB<SyncClientDatabase>(SYNC_DATABASE_NAME, SYNC_DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS)) {
        database.createObjectStore(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
          keyPath: 'namespace',
        });
      }
      if (!database.objectStoreNames.contains(SYNC_STORE_NAMES.LOCAL_UPDATES)) {
        const store = database.createObjectStore(SYNC_STORE_NAMES.LOCAL_UPDATES, {
          keyPath: ['namespace', 'localSequence'],
        });
        store.createIndex(SYNC_INDEX_NAMES.BY_NAMESPACE, 'namespace');
      }
      if (!database.objectStoreNames.contains(SYNC_STORE_NAMES.OUTBOX)) {
        const store = database.createObjectStore(SYNC_STORE_NAMES.OUTBOX, {
          keyPath: ['namespace', 'updateId'],
        });
        store.createIndex(SYNC_INDEX_NAMES.BY_NAMESPACE, 'namespace');
        store.createIndex(SYNC_INDEX_NAMES.BY_NAMESPACE_AND_SEQUENCE, [
          'namespace',
          'localSequence',
        ]);
      }
      if (!database.objectStoreNames.contains(SYNC_STORE_NAMES.BOARD_CACHE)) {
        database.createObjectStore(SYNC_STORE_NAMES.BOARD_CACHE, {
          keyPath: 'namespace',
        });
      }
    },
  });
}

export function copyLocalUpdate(record: LocalUpdateRecord): LocalUpdateRecord {
  return { ...record, updateBytes: Uint8Array.from(record.updateBytes) };
}

export function copyOutboxRecord(record: OutboxRecord): OutboxRecord {
  return {
    ...record,
    updateBytes: Uint8Array.from(record.updateBytes),
    payloadHash: Uint8Array.from(record.payloadHash),
  };
}
