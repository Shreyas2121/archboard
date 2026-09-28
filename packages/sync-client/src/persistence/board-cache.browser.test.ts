import { BOARD_ROLES, GRAPH_SCHEMA_VERSION, type BoardSummary } from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import * as Y from 'yjs';

import { LOCAL_DEMO_USER_KEY, SYNC_DATABASE_NAME, SYNC_STORE_NAMES } from '../config/index.js';
import {
  clearLocalSignOutPending,
  forgetSelectedLocalAccount,
  markLocalSignOutPending,
  selectLocalAccount,
} from './account-selection.js';
import {
  cacheBoardSummary,
  listSelectedCachedBoards,
  readSelectedCachedBoard,
} from './board-cache.js';
import { openSyncClientDatabase } from './database.js';
import { LocalPersistenceAdapter } from './local-persistence-adapter.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from './namespace.js';

const ORIGIN = 'https://app.archboard.example';
const OTHER_ORIGIN = 'https://preview.archboard.example';
const USER_A = 'cached-user-a';
const USER_B = 'cached-user-b';
const FETCHED_AT = new Date('2026-09-28T10:00:00.000Z');
const COMMITTED_AT = '2026-09-28T09:30:00.000Z';
const GAP_LOCAL_SEQUENCE = 3;

function namespace(userId: string, boardId = crypto.randomUUID()): BoardStorageNamespace {
  return { deploymentOrigin: ORIGIN, userId, boardId, graphSchemaVersion: GRAPH_SCHEMA_VERSION };
}

function summary(boardId: string, title: string): BoardSummary {
  return {
    id: boardId,
    title,
    description: 'Safe board description',
    owner: { id: USER_A, name: 'Synthetic owner', image: null },
    effectiveRole: BOARD_ROLES.EDITOR,
    archivedAt: null,
    metadataVersion: 1,
    latestSeq: '9',
    contentUpdatedAt: FETCHED_AT.toISOString(),
    createdAt: FETCHED_AT.toISOString(),
    updatedAt: FETCHED_AT.toISOString(),
  };
}

async function storeSnapshot(storageNamespace: BoardStorageNamespace): Promise<void> {
  const database = await openSyncClientDatabase();
  try {
    await database.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
      namespace: boardStorageNamespaceKey(storageNamespace),
      throughLocalSequence: 1,
      updateBytes: Y.encodeStateAsUpdate(createGraphDocument()),
      updatedAt: COMMITTED_AT,
    });
  } finally {
    database.close();
  }
}

afterEach(async () => {
  forgetSelectedLocalAccount(ORIGIN);
  forgetSelectedLocalAccount(OTHER_ORIGIN);
  clearLocalSignOutPending(ORIGIN, USER_A);
  clearLocalSignOutPending(ORIGIN, USER_B);
  await deleteDB(SYNC_DATABASE_NAME);
});

describe('account-scoped board cache in a real browser', () => {
  it('selects only a previously authenticated account when auth is unavailable and blocks pending sign-out', () => {
    expect(selectLocalAccount(ORIGIN, { kind: 'network-unavailable' })).toBeNull();
    expect(selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_A })).toEqual({
      deploymentOrigin: ORIGIN,
      userId: USER_A,
      source: 'session',
    });
    expect(selectLocalAccount(ORIGIN, { kind: 'network-unavailable' })?.source).toBe(
      'previous-session',
    );
    expect(selectLocalAccount(ORIGIN, { kind: 'signed-out' })).toBeNull();
    expect(selectLocalAccount(ORIGIN, { kind: 'pending' })).toBeNull();
    markLocalSignOutPending(ORIGIN, USER_A);
    expect(selectLocalAccount(ORIGIN, { kind: 'network-unavailable' })).toBeNull();
    expect(selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_A })).toBeNull();
    expect(selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_B })?.userId).toBe(
      USER_B,
    );
    clearLocalSignOutPending(ORIGIN, USER_A);
    expect(selectLocalAccount(OTHER_ORIGIN, { kind: 'network-unavailable' })).toBeNull();
    expect(() =>
      selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: LOCAL_DEMO_USER_KEY }),
    ).toThrow();
  });

  it('isolates account, origin, board, and schema records and checks local availability', async () => {
    const first = namespace(USER_A);
    const second = namespace(USER_B);
    const uncached = namespace(USER_A);
    const otherOrigin = { ...namespace(USER_A), deploymentOrigin: OTHER_ORIGIN };
    const otherSchema = {
      ...namespace(USER_A),
      boardId: first.boardId,
      graphSchemaVersion: GRAPH_SCHEMA_VERSION + 1,
    };
    for (const item of [first, second, uncached, otherOrigin, otherSchema]) {
      await cacheBoardSummary(item, summary(item.boardId, `Board ${item.userId}`), FETCHED_AT);
    }
    await storeSnapshot(first);
    await storeSnapshot(second);
    await storeSnapshot(otherOrigin);
    await storeSnapshot(otherSchema);

    selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_A });
    const selected = await listSelectedCachedBoards(ORIGIN);
    expect(selected.map((item) => item.boardId).sort()).toEqual(
      [first.boardId, uncached.boardId].sort(),
    );
    expect(selected.find((item) => item.boardId === first.boardId)).toMatchObject({
      locallyAvailable: true,
      fetchedAt: FETCHED_AT.toISOString(),
      lastLocalCommitAt: COMMITTED_AT,
      lastReceivedServerSequence: '0',
    });
    expect(selected.find((item) => item.boardId === uncached.boardId)?.locallyAvailable).toBe(
      false,
    );
    expect(await readSelectedCachedBoard(ORIGIN, second.boardId)).toBeNull();
    expect((await readSelectedCachedBoard(ORIGIN, first.boardId))?.summary).toMatchObject({
      title: `Board ${USER_A}`,
    });

    const database = await openSyncClientDatabase();
    await database.put(SYNC_STORE_NAMES.LOCAL_UPDATES, {
      namespace: boardStorageNamespaceKey(first),
      localSequence: GAP_LOCAL_SEQUENCE,
      updateId: null,
      updateBytes: Y.encodeStateAsUpdate(createGraphDocument()),
      direction: 'remote',
      createdAt: COMMITTED_AT,
      acknowledgedServerSequence: '1',
    });
    expect((await readSelectedCachedBoard(ORIGIN, first.boardId))?.locallyAvailable).toBe(false);
    await database.delete(SYNC_STORE_NAMES.LOCAL_UPDATES, [
      boardStorageNamespaceKey(first),
      GAP_LOCAL_SEQUENCE,
    ]);
    await database.delete(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, boardStorageNamespaceKey(first));
    database.close();
    expect((await readSelectedCachedBoard(ORIGIN, first.boardId))?.locallyAvailable).toBe(false);
    selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_B });
    expect((await listSelectedCachedBoards(ORIGIN)).map((item) => item.boardId)).toEqual([
      second.boardId,
    ]);
    expect(await readSelectedCachedBoard(ORIGIN, first.boardId)).toBeNull();
    expect(await listSelectedCachedBoards(OTHER_ORIGIN)).toEqual([]);
    expect(await listSelectedCachedBoards(ORIGIN)).not.toContainEqual(
      expect.objectContaining({ boardId: otherSchema.boardId, locallyAvailable: true }),
    );
  });

  it('stores a safe summary and uses received state instead of the server latest sequence', async () => {
    const storageNamespace = namespace(USER_A);
    const database = await openSyncClientDatabase();
    await database.put(SYNC_STORE_NAMES.RECEIVED_STATE, {
      namespace: boardStorageNamespaceKey(storageNamespace),
      lastServerSequence: '3',
    });
    database.close();
    await cacheBoardSummary(
      storageNamespace,
      summary(storageNamespace.boardId, 'Cached title'),
      FETCHED_AT,
    );
    selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_A });
    const cached = await readSelectedCachedBoard(ORIGIN, storageNamespace.boardId);
    expect(cached?.lastReceivedServerSequence).toBe('3');
    expect(cached?.summary).not.toHaveProperty('owner');
    expect(cached?.summary).not.toHaveProperty('latestSeq');
    const advanced = await openSyncClientDatabase();
    await advanced.put(SYNC_STORE_NAMES.RECEIVED_STATE, {
      namespace: boardStorageNamespaceKey(storageNamespace),
      lastServerSequence: '4',
    });
    advanced.close();
    expect(
      (await readSelectedCachedBoard(ORIGIN, storageNamespace.boardId))?.lastReceivedServerSequence,
    ).toBe('4');
    await expect(
      cacheBoardSummary(storageNamespace, summary(crypto.randomUUID(), 'Wrong board')),
    ).rejects.toThrow();
    await expect(
      cacheBoardSummary(
        { ...storageNamespace, userId: LOCAL_DEMO_USER_KEY },
        summary(storageNamespace.boardId, 'Demo'),
      ),
    ).rejects.toThrow();
  });

  it('retains cached metadata when the persistence adapter updates access', async () => {
    const storageNamespace = namespace(USER_A);
    await cacheBoardSummary(storageNamespace, summary(storageNamespace.boardId, 'Preserved title'));
    const adapter = await LocalPersistenceAdapter.open({
      namespace: storageNamespace,
      document: createGraphDocument(),
    });
    await adapter.cacheBoardAccess({ role: BOARD_ROLES.VIEWER, archived: true });
    await adapter.close();
    selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_A });
    expect(await readSelectedCachedBoard(ORIGIN, storageNamespace.boardId)).toMatchObject({
      summary: { title: 'Preserved title' },
      role: BOARD_ROLES.VIEWER,
      archived: true,
    });
  });

  it('does not treat an initial empty snapshot as a ready offline board', async () => {
    const storageNamespace = namespace(USER_A);
    await cacheBoardSummary(storageNamespace, summary(storageNamespace.boardId, 'Not hydrated'));
    const database = await openSyncClientDatabase();
    await database.put(SYNC_STORE_NAMES.LOCAL_SNAPSHOTS, {
      namespace: boardStorageNamespaceKey(storageNamespace),
      throughLocalSequence: 0,
      updateBytes: Y.encodeStateAsUpdate(createGraphDocument()),
      updatedAt: COMMITTED_AT,
    });
    database.close();
    selectLocalAccount(ORIGIN, { kind: 'authenticated', userId: USER_A });
    expect(
      (await readSelectedCachedBoard(ORIGIN, storageNamespace.boardId))?.locallyAvailable,
    ).toBe(false);
  });
});
