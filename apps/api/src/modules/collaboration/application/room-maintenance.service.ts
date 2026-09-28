import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PostgresRoomCompactor } from '../infrastructure/room/postgres-room-compactor.js';
import { CollaborationRoomRegistry, type RoomCompactor } from './room-registry.js';

const MAINTENANCE_INTERVAL_MS = 1_000;

@Injectable()
export class RoomMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  public constructor(
    @Inject(CollaborationRoomRegistry) private readonly rooms: CollaborationRoomRegistry,
    @Inject(PostgresRoomCompactor) private readonly compactor: RoomCompactor,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.maintain().catch(() => {
        // Keep the previous snapshot/log pair and retry on the next interval.
        console.error('Collaboration room maintenance failed.');
      });
    }, MAINTENANCE_INTERVAL_MS);
    this.timer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  public maintain(): Promise<void> {
    if (this.running !== undefined) return this.running;
    const operation = this.rooms
      .compactDue(this.compactor)
      .then(() => undefined)
      .finally(() => {
        this.rooms.evictIdle();
      });
    this.running = operation;
    void operation
      .finally(() => {
        this.running = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
}
