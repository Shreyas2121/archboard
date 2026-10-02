import 'reflect-metadata';
import { jest } from '@jest/globals';
import { boardSummaryResponseSchema } from '@archboard/contracts';
import { BoardsController } from './boards.controller.js';
import type { BoardService } from './application/board-service.js';
import type { InviteService } from './application/invite-service.js';
import type { AuthenticatedSession } from '../auth/application/index.js';

const timestamp = '2026-10-02T00:00:00.000Z';
const actor = { user: { id: 'owner' } } as AuthenticatedSession;
function harness(replayed: boolean) {
  const board = {
    id: crypto.randomUUID(),
    title: 'Architecture',
    description: '',
    owner: { id: 'owner', name: 'Owner', image: null },
    effectiveRole: 'owner' as const,
    archivedAt: null,
    metadataVersion: 1,
    latestSeq: '0' as const,
    contentUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    memberCount: 1,
  };
  const create = jest.fn<BoardService['create']>().mockResolvedValue({ board, replayed });
  const controller = new BoardsController(
    { create } as unknown as BoardService,
    {} as InviteService,
  );
  return { board, create, controller };
}

describe('board creation summary contract', () => {
  it.each([false, true])(
    'serializes a strict summary on creation/replay=%s without mutating the service result',
    async (replayed) => {
      const { controller, board, create } = harness(replayed);
      const key = crypto.randomUUID();
      const response = await controller.create(actor, key, {
        title: ' Architecture ',
        templateId: 'web-application',
      });
      expect(create).toHaveBeenCalledWith('owner', key, {
        title: 'Architecture',
        templateId: 'web-application',
      });
      expect(boardSummaryResponseSchema.parse(response).data.id).toBe(board.id);
      expect(response.data).not.toHaveProperty('memberCount');
      expect(board.memberCount).toBe(1);
    },
  );
  it('rejects malformed keys and injected ownership before the creation service', async () => {
    const { controller, create } = harness(false);
    await expect(controller.create(actor, 'invalid', { title: 'Architecture' })).rejects.toThrow();
    await expect(
      controller.create(actor, crypto.randomUUID(), {
        title: 'Architecture',
        ownerUserId: 'other',
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
