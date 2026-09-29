import { LOCAL_DEMO_USER_KEY, SYNC_INDEX_NAMES, SYNC_STORE_NAMES } from '../config/index.js';
import { writerLockName } from '../locking/names.js';
import { openSyncClientDatabase } from './database.js';
import {
  accountStorageNamespacePrefix,
  boardStorageNamespaceKey,
  type AccountStorageNamespace,
  type BoardStorageNamespace,
} from './namespace.js';
import { deleteBoardStorageNamespace } from './namespace-storage.js';

export interface PendingAccountBoard {
  readonly namespace: BoardStorageNamespace;
  readonly pendingCount: number;
  readonly updateIds: readonly string[];
}

const NAMESPACE_PART_COUNT = 4;

function namespaceFromKey(key: string): BoardStorageNamespace {
  const value: unknown = JSON.parse(key);
  if (!Array.isArray(value) || value.length !== NAMESPACE_PART_COUNT)
    throw new Error('Invalid board namespace.');
  const [deploymentOrigin, userId, boardId, graphSchemaVersion] = value;
  if (
    typeof deploymentOrigin !== 'string' ||
    typeof userId !== 'string' ||
    typeof boardId !== 'string' ||
    typeof graphSchemaVersion !== 'number'
  )
    throw new Error('Invalid board namespace.');
  const namespace = { deploymentOrigin, userId, boardId, graphSchemaVersion };
  if (boardStorageNamespaceKey(namespace) !== key) throw new Error('Invalid board namespace.');
  return namespace;
}

export async function listAccountPendingBoards(
  account: AccountStorageNamespace,
): Promise<readonly PendingAccountBoard[]> {
  if (account.userId === LOCAL_DEMO_USER_KEY) throw new TypeError('The demo is not an account.');
  const prefix = accountStorageNamespacePrefix(account);
  const database = await openSyncClientDatabase();
  try {
    const records = await database.getAllFromIndex(
      SYNC_STORE_NAMES.OUTBOX,
      SYNC_INDEX_NAMES.BY_NAMESPACE,
      IDBKeyRange.bound(prefix, `${prefix}\uffff`),
    );
    const ids = new Map<string, string[]>();
    for (const record of records) {
      const updateIds = ids.get(record.namespace) ?? [];
      updateIds.push(record.updateId);
      ids.set(record.namespace, updateIds);
    }
    return [...ids].map(([key, updateIds]) => ({
      namespace: namespaceFromKey(key),
      pendingCount: updateIds.length,
      updateIds: updateIds.sort(),
    }));
  } finally {
    database.close();
  }
}

export async function clearAccountBoardNamespaces(
  account: AccountStorageNamespace,
  approved: readonly PendingAccountBoard[],
): Promise<void> {
  if (account.userId === LOCAL_DEMO_USER_KEY) throw new TypeError('The demo is not an account.');
  if (!('locks' in navigator)) throw new Error('Browser writer locks are unavailable.');
  const unique = new Map<string, BoardStorageNamespace>();
  for (const { namespace } of approved) {
    if (
      namespace.deploymentOrigin !== account.deploymentOrigin ||
      namespace.userId !== account.userId
    )
      throw new TypeError('A board is outside the selected account.');
    unique.set(boardStorageNamespaceKey(namespace), namespace);
  }
  const ordered = [...unique.values()].sort((left, right) =>
    writerLockName(left).localeCompare(writerLockName(right)),
  );
  async function withLocks(index: number): Promise<void> {
    if (index === ordered.length) {
      const current = await listAccountPendingBoards(account);
      const expected = new Map(
        approved.map((board) => [boardStorageNamespaceKey(board.namespace), board.updateIds]),
      );
      if (
        current.length !== expected.size ||
        current.some(
          (board) =>
            JSON.stringify(board.updateIds) !==
            JSON.stringify(expected.get(boardStorageNamespaceKey(board.namespace))),
        )
      )
        throw new Error('Pending changes changed during export. Local copies were retained.');
      for (const namespace of ordered) await deleteBoardStorageNamespace(namespace);
      return;
    }
    const namespace = ordered[index]!;
    await navigator.locks.request(
      writerLockName(namespace),
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock === null)
          throw new Error('Another tab is editing a board. Local copies were retained.');
        await withLocks(index + 1);
      },
    );
  }
  await withLocks(0);
}
