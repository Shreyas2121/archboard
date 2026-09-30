import { ERROR_CODES, type BoardRole } from '@archboard/contracts';
import { jest } from '@jest/globals';

import { InviteService, type InvitePersistence, type InviteScope } from './invite-service.js';
import type { BoardPermissionService } from './permissions/index.js';
import type { BoardAccessNotification } from './board-access-notification.js';

function harness(previous: BoardRole | null = 'viewer') {
  let committed = false;
  let replayed = false;
  let role = previous;
  const notify = jest.fn<BoardAccessNotification>().mockImplementation(async () => {
    expect(committed).toBe(true);
  });
  const scope = {
    candidate: async () => ({ id: 'invite', boardId: 'board' }),
    board: async () => ({ id: 'board', title: 'Board', ownerUserId: 'owner', archivedAt: null }),
    getByToken: async () => ({
      id: 'invite',
      boardId: 'board',
      role: 'editor',
      revokedAt: null,
      acceptedBy: replayed ? 'actor' : null,
      createdBy: 'owner',
      expiresAt: new Date('2099-01-01'),
    }),
    now: async () => new Date('2026-01-01'),
    effectiveRole: async () => role,
    applyMembership: async () => {
      role = 'editor';
      return role;
    },
    markAccepted: async () => {
      replayed = true;
    },
  } as unknown as InviteScope;
  let failCommit = false;
  const persistence = {
    run: async <T>(work: (value: InviteScope) => Promise<T>) => {
      committed = false;
      const value = await work(scope);
      if (failCommit) throw new Error('Commit failed');
      committed = true;
      return value;
    },
  } as InvitePersistence;
  return {
    service: new InviteService(persistence, {} as BoardPermissionService, notify),
    notify,
    fail: () => {
      failCommit = true;
    },
    scope,
  };
}

describe('invite access notifications', () => {
  it.each([null, 'viewer'] as const)(
    'notifies committed membership change from %s once',
    async (role) => {
      const h = harness(role);
      expect(await h.service.accept('actor', 'token')).toEqual({
        boardId: 'board',
        effectiveRole: 'editor',
      });
      expect(h.notify).toHaveBeenCalledWith('board', 'actor');
      await h.service.accept('actor', 'token');
      expect(h.notify).toHaveBeenCalledTimes(1);
    },
  );
  it('does not announce an unchanged editor membership', async () => {
    const h = harness('editor');
    await h.service.accept('actor', 'token');
    expect(h.notify).not.toHaveBeenCalled();
  });
  it('emits nothing when commit rolls back', async () => {
    const h = harness();
    h.fail();
    await expect(h.service.accept('actor', 'token')).rejects.toThrow('Commit failed');
    expect(h.notify).not.toHaveBeenCalled();
  });
  it('emits nothing for an unavailable invite', async () => {
    const h = harness();
    h.scope.candidate = async () => null;
    await expect(h.service.accept('actor', 'token')).rejects.toMatchObject({
      code: ERROR_CODES.INVITE_UNAVAILABLE,
    });
    expect(h.notify).not.toHaveBeenCalled();
  });
});
