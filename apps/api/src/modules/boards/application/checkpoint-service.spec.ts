import {
  ERROR_CODES,
  MAX_CHECKPOINTS_PER_BOARD,
  decodePageCursor,
  type CheckpointSummary,
  type BoardDetail,
} from '@archboard/contracts';
import { allEntityGraphFixture } from '@archboard/fixtures';
import { hydrateGraphDocument, projectGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import * as Y from 'yjs';
import {
  CheckpointService,
  type CheckpointPersistence,
  type CheckpointScope,
} from './checkpoint-service.js';
import type { BoardService, BoardWriteScope } from './board-service.js';
import type {
  BoardPermissionService,
  BoardAuthorityState,
  BoardPermissionDecision,
} from './permissions/index.js';
import { canonicalRequestHash, IdempotencyConflictError } from '../infrastructure/idempotency.js';

const boardId = crypto.randomUUID();
const checkpointId = crypto.randomUUID();
const metadata: CheckpointSummary = {
  id: checkpointId,
  boardId,
  name: 'Checkpoint',
  createdBy: { id: 'actor', name: 'Actor', image: null },
  createdAt: '2026-10-02T00:00:00.123456Z',
  throughSeq: '1',
  schemaVersion: 1,
};
const board: BoardAuthorityState = {
  id: boardId,
  ownerUserId: 'actor',
  memberRole: null,
  archivedAt: null,
  metadataVersion: 1,
  latestSeq: '1',
};

function harness() {
  let authority: BoardPermissionDecision = { allowed: true, role: 'owner', board };
  let insideQueue = false;
  const document = hydrateGraphDocument(allEntityGraphFixture);
  const bytes = Y.encodeStateAsUpdate(document);
  document.destroy();
  const scope = {
    permissionTransaction: { isTransactionActive: true },
    boards: {
      lockOwnerAndCount: jest.fn<BoardWriteScope['lockOwnerAndCount']>().mockResolvedValue(0),
      load: jest.fn<BoardWriteScope['load']>().mockResolvedValue(null),
    } as unknown as BoardWriteScope,
    count: jest.fn<CheckpointScope['count']>().mockResolvedValue(0),
    capture: jest.fn<CheckpointScope['capture']>().mockResolvedValue(bytes),
    insert: jest.fn<CheckpointScope['insert']>().mockResolvedValue(metadata),
    summary: jest.fn<CheckpointScope['summary']>().mockResolvedValue(metadata),
    project: jest.fn<CheckpointScope['project']>().mockResolvedValue(allEntityGraphFixture),
    list: jest.fn<CheckpointScope['list']>().mockResolvedValue([metadata]),
  } satisfies CheckpointScope;
  const receipts = new Map<string, { hash: Buffer; body: unknown }>();
  const persistence: CheckpointPersistence = {
    run: (work) => work(scope),
    idempotent: async (actorUserId, operation, key, request, authorize, effect) => {
      const authorized = await authorize(scope);
      const receiptKey = JSON.stringify([actorUserId, operation, key]);
      const hash = canonicalRequestHash(request);
      const stored = receipts.get(receiptKey);
      if (stored) {
        if (!stored.hash.equals(hash)) throw new IdempotencyConflictError();
        return { body: stored.body as Awaited<ReturnType<typeof effect>>, replayed: true };
      }
      const body = await effect(scope, authorized);
      receipts.set(receiptKey, { hash, body });
      return { body, replayed: false };
    },
  };
  const actor = {
    userId: 'actor',
    requireCurrentSession: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const initialize = jest
    .fn<BoardService['initializePrivateBoard']>()
    .mockResolvedValue({ id: crypto.randomUUID() } as BoardDetail);
  const notify = jest
    .fn<(id: string, resources: readonly string[]) => Promise<void>>()
    .mockImplementation(async () => {
      expect(insideQueue).toBe(false);
    });
  const queue = {
    run: async <T>(_id: string, work: () => Promise<T>) => {
      insideQueue = true;
      try {
        return await work();
      } finally {
        insideQueue = false;
      }
    },
  };
  const service = new CheckpointService(
    persistence,
    {
      editGraph: async () => authority,
      readLocked: async () => authority,
    } as unknown as BoardPermissionService,
    { initializePrivateBoard: initialize } as unknown as BoardService,
    queue,
    notify,
  );
  return {
    service,
    scope,
    actor,
    initialize,
    notify,
    receipts,
    setAuthority: (value: BoardPermissionDecision) => {
      authority = value;
    },
  };
}

describe('immutable committed checkpoint rules (in-memory boundaries)', () => {
  it('captures only the checked committed sequence and notifies after queue/commit, once', async () => {
    const h = harness();
    const key = crypto.randomUUID();
    expect(
      await h.service.create(h.actor, boardId, key, { name: ' Checkpoint ', expectedSeq: '1' }),
    ).toEqual({ checkpoint: metadata, replayed: false });
    expect(h.scope.capture).toHaveBeenCalledWith(boardId, '1');
    expect(h.scope.insert).toHaveBeenCalledWith(
      boardId,
      'actor',
      'Checkpoint',
      '1',
      expect.any(Uint8Array),
    );
    h.setAuthority({ allowed: true, role: 'editor', board: { ...board, latestSeq: '2' } });
    expect(
      (await h.service.create(h.actor, boardId, key, { name: 'Checkpoint', expectedSeq: '1' }))
        .replayed,
    ).toBe(true);
    expect(h.scope.capture).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(boardId, ['checkpoints']);
    await expect(
      h.service.create(h.actor, boardId, key, { name: 'Changed', expectedSeq: '1' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });
  it('conflicts on stale expectedSeq without capture, receipt or notification', async () => {
    const h = harness();
    await expect(
      h.service.create(h.actor, boardId, crypto.randomUUID(), {
        name: 'Snapshot',
        expectedSeq: '0',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VERSION_CONFLICT });
    expect(h.scope.capture).not.toHaveBeenCalled();
    expect(h.scope.insert).not.toHaveBeenCalled();
    expect(h.receipts.size).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it('enforces cap on new effects while allowing existing receipt replay', async () => {
    const h = harness();
    const key = crypto.randomUUID();
    await h.service.create(h.actor, boardId, key, { name: 'Snapshot', expectedSeq: '1' });
    h.scope.count.mockResolvedValue(MAX_CHECKPOINTS_PER_BOARD);
    expect(
      (await h.service.create(h.actor, boardId, key, { name: 'Snapshot', expectedSeq: '1' }))
        .replayed,
    ).toBe(true);
    await expect(
      h.service.create(h.actor, boardId, crypto.randomUUID(), { name: 'Other', expectedSeq: '1' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYLOAD_TOO_LARGE });
    expect(h.scope.insert).toHaveBeenCalledTimes(1);
  });
  it.each([ERROR_CODES.FORBIDDEN, ERROR_CODES.NOT_FOUND, ERROR_CODES.BOARD_ARCHIVED])(
    'denies %s before effects and before disclosing a receipt',
    async (code) => {
      const h = harness();
      const key = crypto.randomUUID();
      await h.service.create(h.actor, boardId, key, { name: 'Snapshot', expectedSeq: '1' });
      h.setAuthority({ allowed: false, code });
      await expect(
        h.service.create(h.actor, boardId, key, { name: 'Snapshot', expectedSeq: '1' }),
      ).rejects.toMatchObject({ code });
      expect(h.scope.insert).toHaveBeenCalledTimes(1);
      expect(h.notify).toHaveBeenCalledTimes(1);
    },
  );
  it('rechecks session after waiting for authority and after worker capture', async () => {
    const h = harness();
    h.actor.requireCurrentSession
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Expired'));
    await expect(
      h.service.create(h.actor, boardId, crypto.randomUUID(), {
        name: 'Snapshot',
        expectedSeq: '1',
      }),
    ).rejects.toThrow('Expired');
    expect(h.scope.insert).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
  it('does not emit hints or retain a receipt when capture or persistence fails', async () => {
    const h = harness();
    h.scope.insert.mockRejectedValue(new Error('Rollback'));
    await expect(
      h.service.create(h.actor, boardId, crypto.randomUUID(), {
        name: 'Snapshot',
        expectedSeq: '1',
      }),
    ).rejects.toThrow('Rollback');
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.receipts.size).toBe(0);
  });
  it('preserves microsecond cursor pagination and metadata-only lists', async () => {
    const h = harness();
    const second = { ...metadata, id: crypto.randomUUID() };
    h.scope.list.mockResolvedValue([metadata, second]);
    const result = await h.service.list(h.actor, boardId, { limit: 1 });
    expect(result.data).toEqual([metadata]);
    expect(decodePageCursor(result.nextCursor!)).toEqual({
      timestamp: metadata.createdAt,
      id: metadata.id,
    });
    expect(h.scope.project).not.toHaveBeenCalled();
  });
  it('scopes detail and restore IDs through the board and rejects unavailable checkpoints', async () => {
    const h = harness();
    h.scope.summary.mockResolvedValue(null);
    await expect(h.service.detail(h.actor, boardId, checkpointId)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(
      h.service.restore(h.actor, boardId, checkpointId, crypto.randomUUID(), { title: 'Restored' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(h.scope.summary).toHaveBeenCalledWith(boardId, checkpointId);
    expect(h.initialize).not.toHaveBeenCalled();
  });
  it('restores archived reader content through fresh private initialization and replays once', async () => {
    const h = harness();
    const key = crypto.randomUUID();
    h.setAuthority({ allowed: true, role: 'viewer', board: { ...board, archivedAt: new Date() } });
    await h.service.restore(h.actor, boardId, checkpointId, key, { title: 'Restored' });
    const bytes = h.initialize.mock.calls[0]![4]!;
    const document = new Y.Doc();
    Y.applyUpdate(document, bytes);
    const projection = projectGraphDocument(document);
    document.destroy();
    const original = new Set(
      [
        ...allEntityGraphFixture.nodes,
        ...allEntityGraphFixture.edges,
        ...allEntityGraphFixture.boundaries,
        ...allEntityGraphFixture.steps,
      ].map(({ id }) => id),
    );
    expect(
      [
        ...projection.nodes,
        ...projection.edges,
        ...projection.boundaries,
        ...projection.steps,
      ].some(({ id }) => original.has(id)),
    ).toBe(false);
    expect(
      (await h.service.restore(h.actor, boardId, checkpointId, key, { title: 'Restored' }))
        .replayed,
    ).toBe(true);
    expect(h.initialize).toHaveBeenCalledTimes(1);
    expect(h.notify).not.toHaveBeenCalled();
    h.setAuthority({ allowed: false, code: ERROR_CODES.NOT_FOUND });
    await expect(
      h.service.restore(h.actor, boardId, checkpointId, key, { title: 'Restored' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});
