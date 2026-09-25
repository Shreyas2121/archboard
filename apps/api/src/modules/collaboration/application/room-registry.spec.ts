import { randomUUID } from 'node:crypto';

import {
  ERROR_CODES,
  MAX_ACTIVE_ROOMS,
  MAX_BOARD_CONNECTIONS,
  ROOM_IDLE_EVICTION_MS,
} from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';

import { CollaborationRoomRegistry, type LoadedRoom, type RoomLoader } from './room-registry.js';

const TWO_RESERVATIONS = 2;

function loaded(): LoadedRoom {
  return { document: createGraphDocument(), latestSeq: '0' };
}

describe('bounded collaboration room registry', () => {
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
});
