import {
  GRAPH_SCHEMA_VERSION,
  boardSummarySchema,
  type BoardRole,
  type BoardSummary,
  type ServerSequence,
} from '@archboard/contracts';

import { LOCAL_DEMO_USER_KEY, SYNC_INDEX_NAMES, SYNC_STORE_NAMES } from '../config/index.js';
import { selectLocalAccount } from './account-selection.js';
import {
  openSyncClientDatabase,
  type BoardCacheRecord,
  type SyncClientDatabaseConnection,
} from './database.js';
import {
  accountStorageNamespacePrefix,
  boardStorageNamespaceKey,
  type BoardStorageNamespace,
} from './namespace.js';

export interface CachedBoardEntry {
  readonly boardId: string;
  readonly summary: BoardCacheRecord['metadata']['summary'] | null;
  readonly role: BoardRole;
  readonly archived: boolean;
  readonly fetchedAt: string;
  readonly lastLocalCommitAt: string | null;
  readonly locallyAvailable: boolean;
  readonly lastReceivedServerSequence: ServerSequence;
}

const NAMESPACE_PART_COUNT = 4;

function safeSummary(summary: BoardSummary): NonNullable<BoardCacheRecord['metadata']['summary']> {
  const parsed = boardSummarySchema.parse(summary);
  return {
    id: parsed.id,
    title: parsed.title,
    description: parsed.description,
    archivedAt: parsed.archivedAt,
    metadataVersion: parsed.metadataVersion,
    contentUpdatedAt: parsed.contentUpdatedAt,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

export async function cacheBoardSummary(
  namespace: BoardStorageNamespace,
  summary: BoardSummary,
  now: Date = new Date(),
): Promise<void> {
  if (namespace.userId === LOCAL_DEMO_USER_KEY)
    throw new TypeError('Demo boards cannot enter an account cache.');
  const key = boardStorageNamespaceKey(namespace);
  if (summary.id !== namespace.boardId)
    throw new TypeError('Board summary does not match its storage namespace.');
  const metadata = safeSummary(summary);
  const database = await openSyncClientDatabase();
  try {
    const transaction = database.transaction(
      [SYNC_STORE_NAMES.BOARD_CACHE, SYNC_STORE_NAMES.RECEIVED_STATE],
      'readwrite',
    );
    const received = await transaction.objectStore(SYNC_STORE_NAMES.RECEIVED_STATE).get(key);
    await transaction.objectStore(SYNC_STORE_NAMES.BOARD_CACHE).put({
      namespace: key,
      role: summary.effectiveRole,
      metadata: { archived: summary.archivedAt !== null, summary: metadata },
      cachedAt: now.toISOString(),
      lastServerSequence: received?.lastServerSequence ?? '0',
    });
    await transaction.done;
  } finally {
    database.close();
  }
}

function namespaceFromKey(key: string): BoardStorageNamespace | null {
  try {
    const values: unknown = JSON.parse(key);
    if (!Array.isArray(values) || values.length !== NAMESPACE_PART_COUNT) return null;
    const [deploymentOrigin, userId, boardId, graphSchemaVersion] = values;
    if (
      typeof deploymentOrigin !== 'string' ||
      typeof userId !== 'string' ||
      typeof boardId !== 'string' ||
      typeof graphSchemaVersion !== 'number'
    )
      return null;
    const namespace = { deploymentOrigin, userId, boardId, graphSchemaVersion };
    return boardStorageNamespaceKey(namespace) === key ? namespace : null;
  } catch {
    return null;
  }
}

async function projectCachedBoard(
  database: SyncClientDatabaseConnection,
  record: BoardCacheRecord,
): Promise<CachedBoardEntry | null> {
  const namespace = namespaceFromKey(record.namespace);
  if (namespace === null || namespace.graphSchemaVersion !== GRAPH_SCHEMA_VERSION) return null;
  const [snapshot, updates, received] = await Promise.all([
    database.get(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, record.namespace),
    database.getAllFromIndex(
      SYNC_STORE_NAMES.LOCAL_UPDATES,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      record.namespace,
    ),
    database.get(SYNC_STORE_NAMES.RECEIVED_STATE, record.namespace),
  ]);
  const sortedUpdates = updates.sort((left, right) => left.localSequence - right.localSequence);
  let nextSequence = (snapshot?.throughLocalSequence ?? 0) + 1;
  let contiguous = true;
  for (const update of sortedUpdates) {
    if (update.localSequence < nextSequence) continue;
    if (update.localSequence !== nextSequence) {
      contiguous = false;
      break;
    }
    nextSequence += 1;
  }
  const lastLocalCommitAt =
    [snapshot?.updatedAt, sortedUpdates.at(-1)?.createdAt]
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1) ?? null;
  const hasCommittedGraphState =
    (snapshot?.throughLocalSequence ?? 0) > 0 ||
    sortedUpdates.length > 0 ||
    BigInt(received?.lastServerSequence ?? record.lastServerSequence) > BigInt(0);
  return {
    boardId: namespace.boardId,
    summary: record.metadata.summary ?? null,
    role: record.role,
    archived: record.metadata.archived === true,
    fetchedAt: record.cachedAt,
    lastLocalCommitAt,
    locallyAvailable:
      snapshot !== undefined &&
      snapshot.updateBytes.byteLength > 0 &&
      contiguous &&
      hasCommittedGraphState,
    lastReceivedServerSequence: received?.lastServerSequence ?? record.lastServerSequence,
  };
}

export async function listSelectedCachedBoards(
  deploymentOrigin: string,
): Promise<readonly CachedBoardEntry[]> {
  const selected = selectLocalAccount(deploymentOrigin, { kind: 'network-unavailable' });
  if (selected === null) return [];
  const prefix = accountStorageNamespacePrefix(selected);
  const database = await openSyncClientDatabase();
  try {
    const records = await database.getAll(
      SYNC_STORE_NAMES.BOARD_CACHE,
      IDBKeyRange.bound(prefix, `${prefix}\uffff`),
    );
    const entries = await Promise.all(
      records.map((record) => projectCachedBoard(database, record)),
    );
    return entries.filter((entry): entry is CachedBoardEntry => entry !== null);
  } finally {
    database.close();
  }
}

export async function readSelectedCachedBoard(
  deploymentOrigin: string,
  boardId: string,
): Promise<CachedBoardEntry | null> {
  const selected = selectLocalAccount(deploymentOrigin, { kind: 'network-unavailable' });
  if (selected === null) return null;
  const key = boardStorageNamespaceKey({
    ...selected,
    boardId,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
  });
  const database = await openSyncClientDatabase();
  try {
    const record = await database.get(SYNC_STORE_NAMES.BOARD_CACHE, key);
    return record === undefined ? null : projectCachedBoard(database, record);
  } finally {
    database.close();
  }
}
