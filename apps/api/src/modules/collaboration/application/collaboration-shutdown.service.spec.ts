import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import {
  ValidationWorkerPool,
  VALIDATION_WORKER_DIRECTIVES,
} from '../infrastructure/validation-worker/index.js';
import { createTypicalValidationFixture } from '../infrastructure/validation-worker/validation-worker.fixtures.js';
import { CollaborationGateway } from '../infrastructure/websocket/collaboration.gateway.js';
import { CollaborationUpgradeService } from '../infrastructure/websocket/collaboration-upgrade.service.js';
import { CollaborationShutdownService } from './collaboration-shutdown.service.js';
import { RoomMaintenanceService } from './room-maintenance.service.js';
import { CollaborationRoomRegistry } from './room-registry.js';

const SHUTDOWN_TEST_TIMEOUT_MS = 15_000;
const DESTROYED_DOCUMENTS = 2;

describe('Nest collaboration shutdown', () => {
  it(
    'settles workers, drains admitted work and disposes documents before database shutdown',
    async () => {
      let databaseClosed = false;
      let admissionStopped = false;
      let socketsStopped = false;
      let destroyed = 0;
      const document = () => {
        const value = createGraphDocument();
        value.on('destroy', () => {
          destroyed += 1;
        });
        return value;
      };
      const workers = new ValidationWorkerPool({ maxWorkers: 1, maxQueueDepth: 1 });
      const rooms = new CollaborationRoomRegistry({
        load: async () => ({
          document: document(),
          latestSeq: '0',
          compactedSeq: '0',
        }),
      });
      const maintenance = new RoomMaintenanceService(rooms, {
        compact: async () => {
          expect(databaseClosed).toBe(false);
        },
      });
      const upgrades = {
        stopAdmission: () => {
          admissionStopped = true;
        },
        drain: async () => undefined,
      };
      const gateway = {
        stopAdmission: () => {
          socketsStopped = true;
        },
        drain: async () => undefined,
      };
      @Module({
        providers: [
          { provide: ValidationWorkerPool, useFactory: () => workers },
          { provide: CollaborationRoomRegistry, useValue: rooms },
          { provide: RoomMaintenanceService, useValue: maintenance },
          { provide: CollaborationUpgradeService, useValue: upgrades },
          { provide: CollaborationGateway, useValue: gateway },
          CollaborationShutdownService,
          {
            provide: 'database',
            useValue: {
              onApplicationShutdown: () => {
                expect(workers.activeWorkerCount).toBe(0);
                expect(rooms.activeRoomCount).toBe(0);
                expect(destroyed).toBe(DESTROYED_DOCUMENTS);
                databaseClosed = true;
              },
            },
          },
        ],
      })
      class ShutdownTestModule {}
      const application = await NestFactory.createApplicationContext(ShutdownTestModule, {
        logger: false,
      });
      const reservation = await rooms.reserve(randomUUID());
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const update = reservation.room.run(async () => {
        await held;
        expect(databaseClosed).toBe(false);
        reservation.room.installCommittedCandidate(document(), '1');
      });
      workers.injectNextWorkerDirective(VALIDATION_WORKER_DIRECTIVES.HANG);
      const results = Promise.allSettled([
        workers.validate(createTypicalValidationFixture()),
        workers.validate(createTypicalValidationFixture()),
      ]);
      const closing = application.close();
      try {
        expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
        expect(admissionStopped).toBe(true);
        expect(socketsStopped).toBe(true);
        expect(databaseClosed).toBe(false);
        expect(destroyed).toBe(0);
        await expect(rooms.reserve(randomUUID())).rejects.toMatchObject({
          code: ERROR_CODES.SERVER_BUSY,
        });
        release();
        await update;
        reservation.release();
        await closing;
        expect(databaseClosed).toBe(true);
        await application.get(CollaborationShutdownService).onModuleDestroy();
      } finally {
        release();
        await closing;
      }
    },
    SHUTDOWN_TEST_TIMEOUT_MS,
  );
});
