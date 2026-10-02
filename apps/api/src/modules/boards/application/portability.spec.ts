import {
  ERROR_CODES,
  MAX_ACTIVE_OWNED_BOARDS,
  type BoardDetail,
  type ImportBoard,
} from '@archboard/contracts';
import { TEMPLATE_CHOICES, resolveTemplate, allEntityGraphFixture } from '@archboard/fixtures';
import { projectGraphDocument } from '@archboard/document-model';
import * as Y from 'yjs';
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

describe('fixed template creation service', () => {
  it.each(TEMPLATE_CHOICES)(
    'initializes $id through the shared private-board path',
    async ({ id }) => {
      const persistence = { idempotent: jest.fn<BoardPersistence['idempotent']>() };
      persistence.idempotent.mockImplementation(
        async (_actor, _operation, _key, _request, work) => ({
          ...(await work({} as BoardWriteScope)),
          replayed: false,
        }),
      );
      const service = new BoardService(
        persistence as unknown as BoardPersistence,
        {} as BoardPermissionService,
      );
      const initialize = jest
        .spyOn(service, 'initializePrivateBoard')
        .mockResolvedValue({} as BoardDetail);
      await service.create('actor', crypto.randomUUID(), { title: 'Example', templateId: id });
      expect(persistence.idempotent.mock.calls[0]![3]).toEqual({
        title: 'Example',
        description: '',
        templateId: id,
      });
      const bytes = initialize.mock.calls[0]![4]!;
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, bytes);
        const graph = projectGraphDocument(doc);
        expect(graph.nodes.map((n) => n.title).sort()).toEqual(
          resolveTemplate(id)
            .nodes.map((n) => n.title)
            .sort(),
        );
        expect(graph.steps).toHaveLength(resolveTemplate(id).steps.length);
        expect(
          graph.nodes.every((n) => !resolveTemplate(id).nodes.some((source) => source.id === n.id)),
        ).toBe(true);
      } finally {
        doc.destroy();
      }
    },
  );
  it('rejects an unknown template before starting any transaction', async () => {
    const persistence = { idempotent: jest.fn<BoardPersistence['idempotent']>() };
    const service = new BoardService(
      persistence as unknown as BoardPersistence,
      {} as BoardPermissionService,
    );
    await expect(
      service.create('actor', crypto.randomUUID(), {
        title: 'Bad',
        templateId: '../module' as 'web-application',
      }),
    ).rejects.toThrow();
    expect(persistence.idempotent).not.toHaveBeenCalled();
  });
});
