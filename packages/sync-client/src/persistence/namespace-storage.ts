import { SYNC_INDEX_NAMES, SYNC_STORE_NAMES } from '../config/index.js';
import {
  copyLocalSnapshot,
  copyLocalUpdate,
  copyOutboxRecord,
  openSyncClientDatabase,
  type BoardCacheRecord,
  type LocalSnapshotRecord,
  type LocalUpdateRecord,
  type OutboxRecord,
} from './database.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from './namespace.js';

export interface BoardStorageNamespaceRecords {
  readonly snapshot: LocalSnapshotRecord | null;
  readonly localUpdates: readonly LocalUpdateRecord[];
  readonly outbox: readonly OutboxRecord[];
  readonly boardCache: BoardCacheRecord | null;
}

export async function listBoardStorageNamespaceRecords(
  namespace: BoardStorageNamespace,
): Promise<BoardStorageNamespaceRecords> {
  const key = boardStorageNamespaceKey(namespace);
  const database = await openSyncClientDatabase();
  try {
    const [snapshot, localUpdates, outbox, boardCache] = await Promise.all([
      database.get(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, key),
      database.getAllFromIndex(SYNC_STORE_NAMES.LOCAL_UPDATES, SYNC_INDEX_NAMES.BY_NAMESPACE, key),
      database.getAllFromIndex(SYNC_STORE_NAMES.OUTBOX, SYNC_INDEX_NAMES.BY_NAMESPACE, key),
      database.get(SYNC_STORE_NAMES.BOARD_CACHE, key),
    ]);
    return {
      snapshot: snapshot === undefined ? null : copyLocalSnapshot(snapshot),
      localUpdates: localUpdates
        .sort((left, right) => left.localSequence - right.localSequence)
        .map(copyLocalUpdate),
      outbox: outbox
        .sort((left, right) => left.localSequence - right.localSequence)
        .map(copyOutboxRecord),
      boardCache: boardCache ?? null,
    };
  } finally {
    database.close();
  }
}

export async function deleteBoardStorageNamespace(namespace: BoardStorageNamespace): Promise<void> {
  const key = boardStorageNamespaceKey(namespace);
  const database = await openSyncClientDatabase();
  try {
    const transaction = database.transaction(
      [
        SYNC_STORE_NAMES.LOCAL_SNAPSHOTS,
        SYNC_STORE_NAMES.LOCAL_UPDATES,
        SYNC_STORE_NAMES.OUTBOX,
        SYNC_STORE_NAMES.BOARD_CACHE,
      ],
      'readwrite',
    );
    const localUpdateKeys = await transaction
      .objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES)
      .index(SYNC_INDEX_NAMES.BY_NAMESPACE)
      .getAllKeys(key);
    const outboxKeys = await transaction
      .objectStore(SYNC_STORE_NAMES.OUTBOX)
      .index(SYNC_INDEX_NAMES.BY_NAMESPACE)
      .getAllKeys(key);
    await Promise.all([
      transaction.objectStore(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS).delete(key),
      transaction.objectStore(SYNC_STORE_NAMES.BOARD_CACHE).delete(key),
      ...localUpdateKeys.map((recordKey) =>
        transaction.objectStore(SYNC_STORE_NAMES.LOCAL_UPDATES).delete(recordKey),
      ),
      ...outboxKeys.map((recordKey) =>
        transaction.objectStore(SYNC_STORE_NAMES.OUTBOX).delete(recordKey),
      ),
    ]);
    await transaction.done;
  } finally {
    database.close();
  }
}
