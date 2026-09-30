import { Module, type DynamicModule } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ApiConfig } from '../../platform/config/index.js';
import { BoardAuthorityModule } from '../boards/board-authority.module.js';
import { BoardPermissionService } from '../boards/application/index.js';
import { BOARD_ACCESS_NOTIFICATION } from '../boards/application/board-access-notification.js';
import { CollaborationRoomRegistry } from './application/room-registry.js';
import { RoomMaintenanceService } from './application/room-maintenance.service.js';
import { CollaborationShutdownService } from './application/collaboration-shutdown.service.js';
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
  ): DynamicModule {
    return {
      module: CollaborationModule,
      imports: [auth, database, BoardAuthorityModule],
      providers: [
        { provide: WEBSOCKET_API_CONFIG, useValue: config },
        CollaborationGateway,
        CollaborationUpgradeService,
        PostgresRoomLoader,
        CompactionFailpointController,
        PostgresRoomCompactor,
        RoomMaintenanceService,
        CollaborationShutdownService,
        DurableUpdateFailpointController,
        { provide: ValidationWorkerPool, useFactory: () => new ValidationWorkerPool() },
        {
          provide: CollaborationRoomRegistry,
          inject: [PostgresRoomLoader],
          useFactory: (loader: PostgresRoomLoader) => new CollaborationRoomRegistry(loader),
        },
        {
          provide: DURABLE_UPDATE_PERSISTENCE,
          inject: [DataSource],
          useFactory: (dataSource: DataSource) => new PostgresDurableUpdatePersistence(dataSource),
        },
        {
          provide: CollaborationUpdateService,
          inject: [
            DURABLE_UPDATE_PERSISTENCE,
            BoardPermissionService,
            ValidationWorkerPool,
            DurableUpdateFailpointController,
          ],
          useFactory: (
            persistence: DurableUpdatePersistence,
            permissions: BoardPermissionService,
            validator: ValidationWorkerPool,
            failpoints: DurableUpdateFailpointController,
          ) => new CollaborationUpdateService(persistence, permissions, validator, failpoints),
        },
        {
          provide: BOARD_ACCESS_NOTIFICATION,
          inject: [CollaborationGateway],
          useFactory: (gateway: CollaborationGateway) => (boardId: string, userId?: string) =>
            gateway.accessChanged(boardId, userId),
        },
      ],
      exports: [BOARD_ACCESS_NOTIFICATION, ValidationWorkerPool, CollaborationUpgradeService],
    };
  }
}
