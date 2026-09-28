import { randomUUID } from 'node:crypto';

import { ROOM_IDLE_EVICTION_MS } from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';

import { RoomMaintenanceService } from './room-maintenance.service.js';
import { CollaborationRoomRegistry } from './room-registry.js';

describe('collaboration room maintenance', () => {
  it('evicts unrelated idle rooms even when a dirty room fails compaction', async () => {
    let now = 0;
    const registry = new CollaborationRoomRegistry(
      {
        load: async () => ({ document: createGraphDocument(), latestSeq: '0', compactedSeq: '0' }),
      },
      () => now,
    );
    const dirty = await registry.reserve(randomUUID());
    dirty.room.installCommittedCandidate(createGraphDocument(), '1');
    const idle = await registry.reserve(randomUUID());
    idle.release();
    now = ROOM_IDLE_EVICTION_MS;
    const maintenance = new RoomMaintenanceService(registry, {
      compact: async () => {
        throw new Error('Compaction failed.');
      },
    });
    await expect(maintenance.maintain()).rejects.toThrow('Compaction failed.');
    expect(registry.activeRoomCount).toBe(1);
    dirty.release();
  });
});
