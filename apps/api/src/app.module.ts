import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AuthModule } from './modules/auth/index.js';
import { BoardService } from './modules/boards/application/board-service.js';
import { BoardsController } from './modules/boards/boards.controller.js';
import { PostgresBoardAuthorityReader } from './modules/boards/infrastructure/postgres-board-authority-reader.js';
import { PostgresBoardPersistence } from './modules/boards/infrastructure/postgres-board-persistence.js';
import { BoardPermissionService } from './modules/boards/application/index.js';
import {
  WEBSOCKET_API_CONFIG,
  WebSocketUpgradeService,
} from './modules/collaboration/infrastructure/websocket/index.js';
import type { ApiConfig } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { DataSource } from 'typeorm';

@Module({})
export class AppModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [AuthModule.register(config), DatabaseModule.register(config)],
      controllers: [AppController, BoardsController],
      providers: [
        { provide: WEBSOCKET_API_CONFIG, useValue: config },
        WebSocketUpgradeService,
        {
          provide: BoardService,
          inject: [DataSource],
          useFactory: (dataSource: DataSource) =>
            new BoardService(
              new PostgresBoardPersistence(dataSource),
              new BoardPermissionService(new PostgresBoardAuthorityReader(dataSource)),
            ),
        },
      ],
    };
  }
}
