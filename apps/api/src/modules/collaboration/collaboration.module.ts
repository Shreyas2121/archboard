import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ApiConfig } from '../../platform/config/index.js';
import {
  BoardPermissionService,
  BOARD_RESOURCE_NOTIFICATION,
  type BoardResource,
  BOARD_ACCESS_NOTIFICATION,
  BoardSequenceAccess,
} from '../boards/application/index.js';
import { CollaborationRoomRegistry } from './application/room-registry.js';
import { CommittedAnchorReader } from './application/committed-anchor-reader.js';
import {
  BoardOperationQueue,
  CommittedGraphReader,
  CommittedGraphCopier,
} from './application/committed-graph-reader.js';
import { CandidateValidator } from './application/candidate-validator.js';
import { PostgresCommittedGraphReader } from './infrastructure/room/postgres-committed-graph-reader.js';
import { PostgresCommittedAnchorReader } from './infrastructure/room/postgres-committed-anchor-reader.js';
import { RoomMaintenanceService } from './infrastructure/lifecycle/room-maintenance.service.js';
import { CollaborationShutdownService } from './infrastructure/lifecycle/collaboration-shutdown.service.js';
import { CollaborationUpdateService } from './application/collaboration-update-service.js';
import {
  DURABLE_UPDATE_PERSISTENCE,
  type DurableUpdatePersistence,
} from './application/durable-update-persistence.js';
import { DurableUpdateFailpointController } from './application/durable-update.js';
import { PostgresDurableUpdatePersistence } from './infrastructure/persistence/postgres-durable-update-persistence.js';
import { PostgresRoomLoader } from './infrastructure/room/postgres-room-loader.js';
import {
  CompactionFailpointController,
  PostgresRoomCompactor,
} from './infrastructure/room/postgres-room-compactor.js';
import { ValidationWorkerPool } from './infrastructure/validation-worker/index.js';
import {
  WEBSOCKET_API_CONFIG,
  CollaborationGateway,
  CollaborationUpgradeService,
} from './infrastructure/websocket/index.js';

@Module({})
export class CollaborationModule {
  public static register(
    config: ApiConfig,
    auth: DynamicModule,
    database: DynamicModule,
    authority: Type<unknown>,
  ): DynamicModule {
    return {
      module: CollaborationModule,
      imports: [auth, database, authority],
      providers: [
        { provide: CandidateValidator, useExisting: ValidationWorkerPool },
        { provide: CommittedGraphCopier, useExisting: CommittedGraphReader },
        {
          provide: CommittedGraphReader,
          inject: [ValidationWorkerPool],
          useFactory: (workers: ValidationWorkerPool) => new PostgresCommittedGraphReader(workers),
        },
        {
          provide: BoardOperationQueue,
          inject: [CollaborationRoomRegistry],
          useFactory: (rooms: CollaborationRoomRegistry) => ({
            run: <T>(boardId: string, work: () => Promise<T>) => rooms.runForBoard(boardId, work),
          }),
        },
        {
          provide: BOARD_RESOURCE_NOTIFICATION,
          inject: [CollaborationGateway],
          useFactory:
            (gateway: CollaborationGateway) =>
            (boardId: string, resources: readonly BoardResource[]) =>
              gateway.resourcesChanged(boardId, resources),
        },
        { provide: WEBSOCKET_API_CONFIG, useValue: config },
        CollaborationGateway,
        CollaborationUpgradeService,
        PostgresRoomLoader,
        CompactionFailpointController,
        {
          provide: PostgresRoomCompactor,
          inject: [DataSource, CompactionFailpointController, BoardSequenceAccess],
          useFactory: (
            source: DataSource,
            failpoints: CompactionFailpointController,
            sequences: BoardSequenceAccess,
          ) => new PostgresRoomCompactor(source, failpoints, sequences),
        },
        RoomMaintenanceService,
        CollaborationShutdownService,
        DurableUpdateFailpointController,
        { provide: ValidationWorkerPool, useFactory: () => new ValidationWorkerPool() },
        {
          provide: CommittedAnchorReader,
          inject: [ValidationWorkerPool],
          useFactory: (workers: ValidationWorkerPool) => new PostgresCommittedAnchorReader(workers),
        },
        {
          provide: CollaborationRoomRegistry,
          inject: [PostgresRoomLoader],
          useFactory: (loader: PostgresRoomLoader) => new CollaborationRoomRegistry(loader),
        },
        {
          provide: DURABLE_UPDATE_PERSISTENCE,
          inject: [DataSource, BoardSequenceAccess],
          useFactory: (dataSource: DataSource, sequences: BoardSequenceAccess) =>
            new PostgresDurableUpdatePersistence(dataSource, sequences),
        },
        {
          provide: CollaborationUpdateService,
          inject: [
            DURABLE_UPDATE_PERSISTENCE,
            BoardPermissionService,
            CandidateValidator,
            DurableUpdateFailpointController,
          ],
          useFactory: (
            persistence: DurableUpdatePersistence,
            permissions: BoardPermissionService,
            validator: CandidateValidator,
            failpoints: DurableUpdateFailpointController,
          ) => new CollaborationUpdateService(persistence, permissions, validator, failpoints),
        },
        {
          provide: BOARD_ACCESS_NOTIFICATION,
          inject: [CollaborationGateway],
          useFactory:
            (gateway: CollaborationGateway) => async (boardId: string, userId?: string) => {
              await gateway.accessChanged(boardId, userId);
              await gateway.resourcesChanged(
                boardId,
                userId === undefined ? ['metadata'] : ['members', 'metadata'],
              );
            },
        },
      ],
      exports: [
        CommittedGraphReader,
        CommittedGraphCopier,
        CandidateValidator,
        BoardOperationQueue,
        BOARD_ACCESS_NOTIFICATION,
        BOARD_RESOURCE_NOTIFICATION,
        ValidationWorkerPool,
        CollaborationUpgradeService,
        CommittedAnchorReader,
      ],
    };
  }
}
