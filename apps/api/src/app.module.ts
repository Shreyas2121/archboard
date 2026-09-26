import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AppController } from './app.controller.js';
import { AuthModule } from './modules/auth/index.js';
import { BoardService } from './modules/boards/application/board-service.js';
import { BoardsController } from './modules/boards/boards.controller.js';
import { PostgresBoardAuthorityReader } from './modules/boards/infrastructure/postgres-board-authority-reader.js';
import { PostgresBoardPersistence } from './modules/boards/infrastructure/postgres-board-persistence.js';
import { BoardPermissionService } from './modules/boards/application/index.js';
import { InviteService } from './modules/boards/application/invite-service.js';
import { InvitesController } from './modules/boards/invites.controller.js';
import { PostgresInvitePersistence } from './modules/boards/infrastructure/postgres-invite-persistence.js';
import { CollaborationRoomRegistry } from './modules/collaboration/application/room-registry.js';
import { PostgresRoomLoader } from './modules/collaboration/infrastructure/room/postgres-room-loader.js';
import {
  WEBSOCKET_API_CONFIG,
  CollaborationGateway,
  CollaborationUpgradeService,
} from './modules/collaboration/infrastructure/websocket/index.js';
import type { ApiConfig } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { DataSource } from 'typeorm';
import { ApiExceptionFilter } from './platform/http/api-exception.filter.js';
import { HealthController, ReadinessService } from './platform/http/health.controller.js';
import { OpenApiController } from './platform/http/openapi.controller.js';

@Module({})
export class AppModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [AuthModule.register(config), DatabaseModule.register(config)],
      controllers: [
        AppController,
        BoardsController,
        InvitesController,
        HealthController,
        OpenApiController,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        ReadinessService,
        { provide: WEBSOCKET_API_CONFIG, useValue: config },
        CollaborationGateway,
        CollaborationUpgradeService,
        PostgresRoomLoader,
        {
          provide: BoardPermissionService,
          inject: [DataSource],
          useFactory: (dataSource: DataSource) =>
            new BoardPermissionService(new PostgresBoardAuthorityReader(dataSource)),
        },
        {
          provide: CollaborationRoomRegistry,
          inject: [PostgresRoomLoader],
          useFactory: (loader: PostgresRoomLoader) => new CollaborationRoomRegistry(loader),
        },
        {
          provide: BoardService,
          inject: [DataSource, BoardPermissionService],
          useFactory: (dataSource: DataSource, permissions: BoardPermissionService) =>
            new BoardService(new PostgresBoardPersistence(dataSource), permissions),
        },
        {
          provide: InviteService,
          inject: [DataSource, BoardPermissionService],
          useFactory: (dataSource: DataSource, permissions: BoardPermissionService) =>
            new InviteService(
              new PostgresInvitePersistence(dataSource, config.allowedWebOrigins[0]!),
              permissions,
            ),
        },
      ],
    };
  }
}
