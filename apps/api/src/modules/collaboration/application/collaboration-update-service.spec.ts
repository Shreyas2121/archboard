import { createHash, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@archboard/contracts';
import { jest } from '@jest/globals';
import * as Y from 'yjs';
import type { BoardPermissionService } from '../../boards/application/index.js';
import type { ValidationWorkerPool } from '../infrastructure/validation-worker/index.js';
import { createTypicalValidationFixture } from '../infrastructure/validation-worker/validation-worker.fixtures.js';
import { CollaborationUpdateService } from './collaboration-update-service.js';
import { CollaborationRoom } from './room-registry.js';
import type {
  DurableUpdatePersistence,
  DurableUpdateWriteScope,
} from './durable-update-persistence.js';
import type { DurableUpdateReceipt } from './durable-update.js';

function harness() {
  const fixture = createTypicalValidationFixture();
  const document = new Y.Doc();
  Y.applyUpdate(document, fixture.acceptedState);
  const candidate = new Y.Doc();
  Y.applyUpdate(candidate, fixture.acceptedState);
  Y.applyUpdate(candidate, fixture.update);
  const candidateState = Y.encodeStateAsUpdate(candidate);
  candidate.destroy();
  const boardId = randomUUID();
  const actorUserId = randomUUID();
  const updateId = randomUUID();
  const room = new CollaborationRoom(boardId, document, '0', '0', Date.now);
  const decision = { allowed: true, role: 'owner', board: { latestSeq: '0' } } as const;
  const preview = jest
    .fn<BoardPermissionService['previewEditGraph']>()
    .mockResolvedValue(decision as Awaited<ReturnType<BoardPermissionService['previewEditGraph']>>);
  const locked = jest
    .fn<BoardPermissionService['editGraph']>()
    .mockResolvedValue(decision as Awaited<ReturnType<BoardPermissionService['editGraph']>>);
  const validate = jest
    .fn<ValidationWorkerPool['validate']>()
    .mockResolvedValue({ ok: true, candidateState, elapsedMs: 0, heapUsedBytes: 0 });
  const append = jest.fn<DurableUpdateWriteScope['append']>().mockResolvedValue('1');
  const find = jest.fn<DurableUpdatePersistence['findReceipt']>().mockResolvedValue(null);
  const transactionalFind = jest
    .fn<DurableUpdateWriteScope['findReceipt']>()
    .mockResolvedValue(null);
  const transaction = { isTransactionActive: true };
  let failCommit = false;
  const persistence: DurableUpdatePersistence = {
    findReceipt: find,
    run: async (_boardId, work) => {
      const result = await work({
        permissionTransaction: transaction,
        findReceipt: transactionalFind,
        append,
      });
      expect(room.document).toBe(document);
      expect(room.latestSeq).toBe('0');
      if (failCommit) throw new Error('Commit failed');
      return result;
    },
  };
  const receipt: DurableUpdateReceipt = {
    boardId,
    updateId,
    actorUserId,
    payloadHash: createHash('sha256').update(fixture.update).digest(),
    sequence: '1',
    createdAt: new Date(),
  };
  const service = new CollaborationUpdateService(
    persistence,
    { previewEditGraph: preview, editGraph: locked } as unknown as BoardPermissionService,
    { validate } as unknown as ValidationWorkerPool,
  );
  return {
    room,
    service,
    append,
    find,
    transactionalFind,
    preview,
    locked,
    validate,
    transaction,
    receipt,
    proposal: { actorUserId, updateId, updateBytes: fixture.update },
    fail: () => {
      failCommit = true;
    },
  };
}

describe('durable update orchestration through persistence port', () => {
  it('authorizes within the transaction and installs only after commit', async () => {
    const h = harness();
    try {
      expect(await h.service.accept(h.room, h.proposal)).toEqual({
        sequence: '1',
        duplicate: false,
      });
      expect(h.locked).toHaveBeenCalledWith(h.transaction, h.room.boardId, h.proposal.actorUserId);
      expect(h.append).toHaveBeenCalledWith(
        '0',
        expect.objectContaining({
          updateId: h.proposal.updateId,
          updateBytes: h.proposal.updateBytes,
        }),
      );
      expect(h.room.latestSeq).toBe('1');
    } finally {
      h.room.destroy();
    }
  });
  it('does not install a candidate when commit fails', async () => {
    const h = harness();
    h.fail();
    const original = h.room.document;
    try {
      await expect(h.service.accept(h.room, h.proposal)).rejects.toMatchObject({
        code: ERROR_CODES.PERSISTENCE_FAILED,
      });
      expect(h.room.document).toBe(original);
      expect(h.room.latestSeq).toBe('0');
    } finally {
      h.room.destroy();
    }
  });
  it.each(['preview', 'locked'] as const)(
    'rejects permission loss at %s without appending',
    async (stage) => {
      const h = harness();
      h[stage].mockResolvedValue({ allowed: false, code: ERROR_CODES.FORBIDDEN });
      try {
        await expect(h.service.accept(h.room, h.proposal)).rejects.toMatchObject({
          code: ERROR_CODES.FORBIDDEN,
        });
        expect(h.append).not.toHaveBeenCalled();
        if (stage === 'preview') expect(h.find).not.toHaveBeenCalled();
      } finally {
        h.room.destroy();
      }
    },
  );
  it.each(['preflight', 'transaction'] as const)(
    'returns original sequence for %s retries without installing',
    async (stage) => {
      const h = harness();
      (stage === 'preflight' ? h.find : h.transactionalFind).mockResolvedValue(h.receipt);
      const original = h.room.document;
      try {
        expect(await h.service.accept(h.room, h.proposal)).toEqual({
          sequence: '1',
          duplicate: true,
        });
        expect(h.append).not.toHaveBeenCalled();
        expect(h.room.document).toBe(original);
        if (stage === 'preflight') expect(h.validate).not.toHaveBeenCalled();
      } finally {
        h.room.destroy();
      }
    },
  );
  it.each(['actor', 'hash'] as const)('rejects a retry with a different %s', async (field) => {
    const h = harness();
    h.find.mockResolvedValue({
      ...h.receipt,
      ...(field === 'actor' ? { actorUserId: randomUUID() } : { payloadHash: new Uint8Array() }),
    });
    try {
      await expect(h.service.accept(h.room, h.proposal)).rejects.toMatchObject({
        code: ERROR_CODES.UPDATE_ID_REUSED,
      });
      expect(h.validate).not.toHaveBeenCalled();
    } finally {
      h.room.destroy();
    }
  });
});
