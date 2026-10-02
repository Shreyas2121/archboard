import { ERROR_CODES, MAX_ACTIVE_OWNED_BOARDS, type ImportBoard } from '@archboard/contracts';
import { allEntityGraphFixture } from '@archboard/fixtures';
import { jest } from '@jest/globals';
import { BoardService, type BoardPersistence, type BoardWriteScope } from './board-service.js';
import type { BoardPermissionService } from './permissions/index.js';

const input: ImportBoard = {
  title: 'Private import',
  file: {
    format: 'archboard',
    formatVersion: 1,
    exportedAt: '2026-10-02T00:00:00.000Z',
    syncStatusAtExport: 'local-only',
    board: { title: 'Source', description: 'Preserved' },
    graph: allEntityGraphFixture,
  },
};

describe('portable board service', () => {
  it('rejects malformed graphs before invoking persistence', async () => {
    const idempotent = jest.fn<BoardPersistence['idempotent']>();
    const service = new BoardService(
      { idempotent } as unknown as BoardPersistence,
      {} as BoardPermissionService,
    );
    const bad = {
      ...input,
      file: {
        ...input.file,
        graph: {
          ...input.file.graph,
          edges: [{ ...input.file.graph.edges[0]!, targetId: crypto.randomUUID() }],
        },
      },
    };
    await expect(service.import('actor', crypto.randomUUID(), bad)).rejects.toThrow();
    expect(idempotent).not.toHaveBeenCalled();
  });
  it('checks the active board cap before creating any private effect', async () => {
    const create = jest.fn<BoardWriteScope['create']>();
    const scope = {
      lockOwnerAndCount: async () => MAX_ACTIVE_OWNED_BOARDS,
      create,
    } as unknown as BoardWriteScope;
    const service = new BoardService({} as BoardPersistence, {} as BoardPermissionService);
    await expect(service.initializePrivateBoard(scope, 'actor', 'Title', '')).rejects.toMatchObject(
      { code: ERROR_CODES.RATE_LIMITED },
    );
    expect(create).not.toHaveBeenCalled();
  });
  it('passes current source authorization into receipt replay and denies revoked readers', async () => {
    const readLocked = jest
      .fn<BoardPermissionService['readLocked']>()
      .mockResolvedValue({ allowed: false, code: ERROR_CODES.NOT_FOUND });
    const lockOwnerAndCount = jest.fn<BoardWriteScope['lockOwnerAndCount']>().mockResolvedValue(0);
    const persistence = {
      idempotent: async (
        _actor: string,
        _operation: string,
        _key: string,
        _request: unknown,
        _effect: unknown,
        authorize?: (scope: BoardWriteScope) => Promise<void>,
      ) => {
        expect(authorize).toBeDefined();
        await authorize!({
          lockOwnerAndCount,
          permissionTransaction: {},
        } as unknown as BoardWriteScope);
        throw new Error('Must not disclose receipt');
      },
    } as unknown as BoardPersistence;
    const service = new BoardService(persistence, {
      readLocked,
    } as unknown as BoardPermissionService);
    await expect(
      service.duplicate('actor', crypto.randomUUID(), crypto.randomUUID(), { title: 'Copy' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(lockOwnerAndCount).toHaveBeenCalledTimes(1);
    expect(readLocked).toHaveBeenCalledTimes(1);
  });
});
