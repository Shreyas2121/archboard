import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@archboard/contracts';
import { jest } from '@jest/globals';
import { DataSource, type QueryRunner } from 'typeorm';
import * as Y from 'yjs';
import type { BoardPermissionService } from '../../../boards/application/index.js';
import { createTypicalValidationFixture } from '../validation-worker/validation-worker.fixtures.js';
import { PostgresDurableUpdateHarness } from './postgres-durable-update-harness.js';

const ACCEPTED_DOCUMENTS_DISPOSED = 2;

function setup(duplicate = false) {
  const fixture = createTypicalValidationFixture();
  const document = new Y.Doc();
  Y.applyUpdate(document, fixture.acceptedState);
  const actor = randomUUID();
  const proposal = {
    boardId: randomUUID(),
    updateId: randomUUID(),
    sessionToken: 'test',
    updateBytes: fixture.update,
  };
  const receipt = {
    actor_user_id: actor,
    payload_hash: createHash('sha256').update(fixture.update).digest(),
    seq: '1',
    created_at: new Date(),
  };
  let active = false;
  const connect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const startTransaction = jest.fn<() => Promise<void>>().mockImplementation(async () => {
    active = true;
  });
  const commitTransaction = jest.fn<() => Promise<void>>().mockImplementation(async () => {
    active = false;
  });
  const rollbackTransaction = jest.fn<() => Promise<void>>().mockImplementation(async () => {
    active = false;
  });
  const release = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const query = jest.fn<(sql: string) => Promise<unknown[]>>().mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT')) return duplicate ? [receipt] : [];
    if (sql.includes('advanced_board')) return [{ sequence: '1', content_updated_at: new Date() }];
    return [receipt];
  });
  const runner = {
    connect,
    startTransaction,
    commitTransaction,
    rollbackTransaction,
    release,
    manager: { query },
    get isTransactionActive() {
      return active;
    },
  } as unknown as QueryRunner;
  const source = new DataSource({ type: 'postgres' });
  jest.spyOn(source, 'query').mockResolvedValue([]);
  jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);
  const permission = {
    previewEditGraph: async () => ({ allowed: true }),
    editGraph: async () => ({ allowed: true }),
  } as unknown as BoardPermissionService;
  const harness = new PostgresDurableUpdateHarness(
    proposal.boardId,
    document,
    source,
    { authenticate: async () => ({ userId: actor }) },
    permission,
  );
  document.destroy();
  return {
    harness,
    proposal,
    connect,
    startTransaction,
    commitTransaction,
    rollbackTransaction,
    release,
    source,
    receipt,
  };
}

describe('legacy compatibility harness resource ownership', () => {
  it.each(['connect', 'startTransaction', 'commitTransaction'] as const)(
    'releases exactly once and destroys the rejected candidate after %s fails',
    async (stage) => {
      const h = setup();
      h[stage].mockRejectedValue(new Error('Injected setup/commit failure'));
      const before = h.harness.acceptedStateAsUpdate();
      const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
      try {
        await expect(h.harness.accept(h.proposal)).rejects.toMatchObject({
          code: ERROR_CODES.PERSISTENCE_FAILED,
        });
        expect(h.release).toHaveBeenCalledTimes(1);
        expect(h.rollbackTransaction).toHaveBeenCalledTimes(stage === 'commitTransaction' ? 1 : 0);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(h.harness.acceptedStateAsUpdate()).toEqual(before);
      } finally {
        destroy.mockRestore();
        await h.harness.close();
      }
    },
  );
  it('disposes a validation rejection without starting a transaction', async () => {
    const h = setup();
    const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
    try {
      await expect(
        h.harness.accept({ ...h.proposal, updateBytes: Uint8Array.from([0]) }),
      ).rejects.toMatchObject({ code: ERROR_CODES.DOCUMENT_INVALID });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(h.connect).not.toHaveBeenCalled();
    } finally {
      destroy.mockRestore();
      await h.harness.close();
    }
  });
  it('disposes a candidate for a receipt found under the lock', async () => {
    const h = setup(true);
    const before = h.harness.acceptedStateAsUpdate();
    const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
    try {
      expect((await h.harness.accept(h.proposal)).broadcastEligible).toBe(false);
      expect(h.release).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(h.harness.acceptedStateAsUpdate()).toEqual(before);
    } finally {
      destroy.mockRestore();
      await h.harness.close();
    }
  });
  it('disposes the old accepted document after replacement and drains/idempotently closes the new one', async () => {
    const h = setup();
    const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
    try {
      const pending = h.harness.accept(h.proposal);
      const closing = h.harness.close();
      expect(h.harness.close()).toBe(closing);
      expect((await pending).broadcastEligible).toBe(true);
      await closing;
      expect(destroy).toHaveBeenCalledTimes(ACCEPTED_DOCUMENTS_DISPOSED);
      await expect(h.harness.accept(h.proposal)).rejects.toThrow('closed');
    } finally {
      destroy.mockRestore();
      await h.harness.close();
    }
  });
});
