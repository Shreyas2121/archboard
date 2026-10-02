import 'reflect-metadata';
import { allEntityGraphFixture } from '@archboard/fixtures';
import { jest } from '@jest/globals';
import { ImportsController } from './imports.controller.js';
import type { BoardService } from './application/board-service.js';
import type { AuthenticatedSession } from '../auth/application/index.js';

const timestamp = '2026-10-02T00:00:00.000Z';
const session = { user: { id: 'actor' } } as AuthenticatedSession;
const file = {
  format: 'archboard',
  formatVersion: 1,
  exportedAt: timestamp,
  syncStatusAtExport: 'local-only',
  board: { title: 'Source', description: '' },
  graph: allEntityGraphFixture,
};

describe('canonical imports controller (no HTTP server/database)', () => {
  it('registers the plan route and delegates validated actor/key/file to private creation', async () => {
    expect(Reflect.getMetadata('path', ImportsController)).toBe('api/v1/imports');
    expect(Reflect.getMetadata('path', ImportsController.prototype.create)).toBe('/');
    const board = {
      id: crypto.randomUUID(),
      title: 'New',
      description: '',
      owner: { id: 'actor', name: 'Actor', image: null },
      effectiveRole: 'owner' as const,
      archivedAt: null,
      metadataVersion: 1,
      latestSeq: '0',
      contentUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      memberCount: 1,
    };
    const importBoard = jest
      .fn<BoardService['import']>()
      .mockResolvedValue({ board, replayed: false });
    const controller = new ImportsController({ import: importBoard } as unknown as BoardService);
    const key = crypto.randomUUID();
    const result = await controller.create(session, key, { title: ' New ', file });
    expect(importBoard).toHaveBeenCalledWith('actor', key, { title: 'New', file });
    expect(result.data.id).toBe(board.id);
    expect(result.data).not.toHaveProperty('memberCount');
  });
  it('rejects invalid keys and authority injection before creating anything', async () => {
    const importBoard = jest.fn<BoardService['import']>();
    const controller = new ImportsController({ import: importBoard } as unknown as BoardService);
    await expect(controller.create(session, 'invalid', { title: 'New', file })).rejects.toThrow();
    await expect(
      controller.create(session, crypto.randomUUID(), {
        title: 'New',
        file,
        ownerUserId: 'injected',
      }),
    ).rejects.toThrow();
    expect(importBoard).not.toHaveBeenCalled();
  });
});
