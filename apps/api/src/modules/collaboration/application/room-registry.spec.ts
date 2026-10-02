import { randomUUID } from 'node:crypto';

import {
  ERROR_CODES,
  MAX_ACTIVE_ROOMS,
  MAX_BOARD_CONNECTIONS,
  ROOM_IDLE_EVICTION_MS,
  SNAPSHOT_COMPACTION_INTERVAL_MS,
  SNAPSHOT_COMPACTION_UPDATES,
} from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';

import { CollaborationRoomRegistry, type LoadedRoom, type RoomLoader } from './room-registry.js';
import { MAX_PENDING_ROOM_UPDATE_BYTES, MAX_PENDING_ROOM_UPDATES } from './collaboration-limits.js';

const TWO_RESERVATIONS = 2;

function loaded(): LoadedRoom {
  return { document: createGraphDocument(), latestSeq: '0', compactedSeq: '0' };
}

describe('bounded collaboration room registry', () => {
  it('serializes checkpoint work behind an active room operation and never opens a room for REST alone', async () => {
    let loads = 0;
    const registry = new CollaborationRoomRegistry({
      load: async () => {
        loads++;
        return loaded();
      },
    });
    expect(await registry.runForBoard(randomUUID(), async () => 'closed')).toBe('closed');
    expect(loads).toBe(0);
    const id = randomUUID();
    const reservation = await registry.reserve(id);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const graphWrite = reservation.room.run(async () => {
      await barrier;
      events.push('graph committed');
    });
    const capture = registry.runForBoard(id, async () => {
      events.push('checkpoint captured');
      return '1';
    });
    await Promise.resolve();
    expect(events).toEqual([]);
    release();
    await graphWrite;
    expect(await capture).toBe('1');
    expect(events).toEqual(['graph committed', 'checkpoint captured']);
    reservation.release();
    await registry.close();
    await expect(registry.runForBoard(id, async () => 'late')).rejects.toMatchObject({
      code: ERROR_CODES.SERVER_BUSY,
    });
  });
  it.each(['bytes', 'count'] as const)(
    'bounds inactive subscriber %s and isolates a throwing teardown',
    async (limit) => {
      const registry = new CollaborationRoomRegistry({ load: async () => loaded() });
      const reservation = await registry.reserve(randomUUID());
      const delivered: string[] = [];
      let failed = 0;
      const inactive = reservation.room.subscribe(
        () => {
          throw new Error('Must stay inactive');
        },
        () => {
          failed += 1;
          throw new Error('Teardown failed');
        },
      );
      const healthy = reservation.room.subscribe((update) => delivered.push(update.seq));
      healthy.activate();
      const updateBase64 = limit === 'bytes' ? 'A'.repeat(MAX_PENDING_ROOM_UPDATE_BYTES) : 'AQ==';
      const count = limit === 'bytes' ? 1 : MAX_PENDING_ROOM_UPDATES + 1;
      for (let index = 0; index < count; index += 1)
        reservation.room.publishCommittedUpdate({ seq: String(index + 1), updateBase64 });
      expect(failed).toBe(1);
      expect(delivered).toHaveLength(count);
      expect(() => inactive.activate()).not.toThrow();
      reservation.release();
      await registry.close();
    },
  );

  it.each([true, false])('isolates delivery failures with active=%s', async (active) => {
    const registry = new CollaborationRoomRegistry({ load: async () => loaded() });
    const reservation = await registry.reserve(randomUUID());
    let failures = 0;
    const bad = reservation.room.subscribe(
      () => {
        throw new Error('Failed send');
      },
      () => {
        failures += 1;
      },
    );
    const received: string[] = [];
    const good = reservation.room.subscribe((update) => received.push(update.seq));
    good.activate();
    if (active) bad.activate();
    reservation.room.publishCommittedUpdate({ seq: '1', updateBase64: 'AQ==' });
    if (!active) bad.activate();
    reservation.room.publishCommittedUpdate({ seq: '2', updateBase64: 'AQ==' });
    expect(failures).toBe(1);
    expect(received).toEqual(['1', '2']);
    reservation.release();
    await registry.close();
  });

  it('drains a late loader and destroys its document without admitting reservations after close', async () => {
    let resolve!: (value: LoadedRoom) => void;
    const registry = new CollaborationRoomRegistry({
      load: () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    });
    const admitted = registry.reserve(randomUUID());
    const rejected = expect(admitted).rejects.toMatchObject({ code: ERROR_CODES.SERVER_BUSY });
    const closing = registry.close();
    const room = loaded();
    let destroyed = false;
    room.document.on('destroy', () => {
      destroyed = true;
    });
    resolve(room);
    await Promise.all([closing, rejected]);
    expect(destroyed).toBe(true);
    expect(registry.activeRoomCount).toBe(0);
    expect(registry.close()).toBe(closing);
    await expect(registry.reserve(randomUUID())).rejects.toMatchObject({
      code: ERROR_CODES.SERVER_BUSY,
    });
  });
  it('loads a board once for concurrent reservations and releases exactly once', async () => {
    let finish: ((room: LoadedRoom) => void) | undefined;
    let loads = 0;
    const loader: RoomLoader = {
      load: () => {
        loads += 1;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    };
    const registry = new CollaborationRoomRegistry(loader);
    const boardId = randomUUID();
    const first = registry.reserve(boardId);
    const second = registry.reserve(boardId);
    expect(loads).toBe(1);
    finish?.(loaded());
    const [one, two] = await Promise.all([first, second]);
    expect(one.room).toBe(two.room);
    expect(one.room.connectionCount).toBe(TWO_RESERVATIONS);
    one.release();
    one.release();
    two.release();
    expect(one.room.connectionCount).toBe(0);
  });

  it('fails a corrupt opening atomically and permits a later repaired load', async () => {
    let attempts = 0;
    const loader: RoomLoader = {
      load: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('corrupt');
        return loaded();
      },
    };
    const registry = new CollaborationRoomRegistry(loader);
    const boardId = randomUUID();
    await expect(registry.reserve(boardId)).rejects.toThrow('corrupt');
    expect(registry.activeRoomCount).toBe(0);
    const reservation = await registry.reserve(boardId);
    expect(attempts).toBe(TWO_RESERVATIONS);
    reservation.release();
  });

  it('caps board connections and active or opening rooms', async () => {
    const registry = new CollaborationRoomRegistry({ load: async () => loaded() });
    const boardId = randomUUID();
    const reservations = await Promise.all(
      Array.from({ length: MAX_BOARD_CONNECTIONS }, () => registry.reserve(boardId)),
    );
    await expect(registry.reserve(boardId)).rejects.toMatchObject({ code: ERROR_CODES.ROOM_FULL });
    const others = await Promise.all(
      Array.from({ length: MAX_ACTIVE_ROOMS - 1 }, () => registry.reserve(randomUUID())),
    );
    expect(registry.activeRoomCount).toBe(MAX_ACTIVE_ROOMS);
    await expect(registry.reserve(randomUUID())).rejects.toMatchObject({
      code: ERROR_CODES.SERVER_BUSY,
    });
    for (const reservation of [...reservations, ...others]) reservation.release();
  });

  it('evicts eligible idle rooms before applying the active-room admission cap', async () => {
    let now = 0;
    const registry = new CollaborationRoomRegistry({ load: async () => loaded() }, () => now);
    const reservations = await Promise.all(
      Array.from({ length: MAX_ACTIVE_ROOMS }, () => registry.reserve(randomUUID())),
    );
    for (const reservation of reservations) reservation.release();
    now = ROOM_IDLE_EVICTION_MS;
    const next = await registry.reserve(randomUUID());
    expect(registry.activeRoomCount).toBe(1);
    next.release();
  });

  it('serializes work and evicts only fully durable, idle rooms with no queued work', async () => {
    let now = 0;
    const registry = new CollaborationRoomRegistry({ load: async () => loaded() }, () => now);
    const reservation = await registry.reserve(randomUUID());
    const order: string[] = [];
    let finish: (() => void) | undefined;
    const first = reservation.room.run(async () => {
      order.push('first');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const second = reservation.room.run(async () => {
      order.push('second');
    });
    await Promise.resolve();
    reservation.release();
    now = ROOM_IDLE_EVICTION_MS;
    expect(registry.evictIdle()).toBe(0);
    finish?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
    reservation.room.setDurable(false);
    expect(registry.evictIdle()).toBe(0);
    reservation.room.setDurable(true);
    expect(registry.evictIdle()).toBe(0);
    now += ROOM_IDLE_EVICTION_MS;
    expect(registry.evictIdle()).toBe(1);
  });

  it('buffers commits after a queued join snapshot until ready has been sent', async () => {
    const registry = new CollaborationRoomRegistry({ load: async () => loaded() });
    const { room, release } = await registry.reserve(randomUUID());
    const delivered: string[] = [];
    let activate: (() => void) | undefined;
    const join = room.run(async () => {
      const subscriber = room.subscribe((update) => delivered.push(update.seq));
      activate = subscriber.activate;
      delivered.push(`ready:${room.latestSeq}`);
    });
    const laterCommit = room.run(async () => {
      room.publishCommittedUpdate({ seq: '1', updateBase64: 'AQ==' });
    });
    await Promise.all([join, laterCommit]);
    expect(delivered).toEqual(['ready:0']);
    activate?.();
    expect(delivered).toEqual(['ready:0', '1']);
    await room.run(async () => {
      room.publishCommittedUpdate({ seq: '2', updateBase64: 'Ag==' });
    });
    expect(delivered).toEqual(['ready:0', '1', '2']);
    release();
  });

  it('compacts after the update threshold or dirty interval and retries a failed transaction', async () => {
    let now = 0;
    const registry = new CollaborationRoomRegistry({ load: async () => loaded() }, () => now);
    const { room, release } = await registry.reserve(randomUUID());
    const sequences: string[] = [];
    const compactor = {
      compact: async (_boardId: string, sequence: string) => {
        sequences.push(sequence);
        if (sequences.length === 1) throw new Error('Database unavailable.');
      },
    };
    room.installCommittedCandidate(createGraphDocument(), '1');
    expect(await registry.compactDue(compactor)).toBe(0);
    now = SNAPSHOT_COMPACTION_INTERVAL_MS;
    await expect(registry.compactDue(compactor)).rejects.toThrow('Database unavailable.');
    expect(await registry.compactDue(compactor)).toBe(1);
    expect(sequences).toEqual(['1', '1']);
    expect(await registry.compactDue(compactor)).toBe(0);
    room.installCommittedCandidate(createGraphDocument(), String(SNAPSHOT_COMPACTION_UPDATES + 1));
    expect(await registry.compactDue(compactor)).toBe(1);
    expect(sequences).toEqual(['1', '1', String(SNAPSHOT_COMPACTION_UPDATES + 1)]);
    release();
  });
});
