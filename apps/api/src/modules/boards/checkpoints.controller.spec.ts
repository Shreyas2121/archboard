import 'reflect-metadata';
import { jest } from '@jest/globals';
import { CheckpointsController } from './checkpoints.controller.js';
import type { CheckpointService } from './application/checkpoint-service.js';
import type { AuthenticatedSession, RequestActor } from '../auth/application/index.js';
import type { IncomingMessage } from 'node:http';

describe('checkpoint restore controller response', () => {
  it('returns a strict summary from private detail without mutating the result', async () => {
    const timestamp = '2026-10-02T00:00:00.000Z';
    const board = {
      id: crypto.randomUUID(),
      title: 'Restored',
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
    const restore = jest
      .fn<CheckpointService['restore']>()
      .mockResolvedValue({ board, replayed: false });
    const controller = new CheckpointsController(
      { restore } as unknown as CheckpointService,
      {} as RequestActor,
    );
    const id = crypto.randomUUID();
    const checkpointId = crypto.randomUUID();
    const key = crypto.randomUUID();
    const result = await controller.restore(
      { headers: {} } as IncomingMessage,
      { user: { id: 'actor' } } as AuthenticatedSession,
      { id, checkpointId },
      key,
      { title: 'Restored' },
    );
    expect(Reflect.getMetadata('path', CheckpointsController.prototype.restore)).toBe(
      ':id/checkpoints/:checkpointId/duplicate',
    );
    expect(result.data.id).toBe(board.id);
    expect(result.data).not.toHaveProperty('memberCount');
    expect(board.memberCount).toBe(1);
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor' }),
      id,
      checkpointId,
      key,
      { title: 'Restored' },
    );
  });
});
