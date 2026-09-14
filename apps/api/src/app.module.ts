import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AuthModule } from './modules/auth/index.js';
import {
  WEBSOCKET_API_CONFIG,
  WebSocketUpgradeService,
} from './modules/collaboration/infrastructure/websocket/index.js';
import type { ApiConfig } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';

@Module({})
export class AppModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [AuthModule.register(config), DatabaseModule.register(config)],
      controllers: [AppController],
      providers: [{ provide: WEBSOCKET_API_CONFIG, useValue: config }, WebSocketUpgradeService],
    };
  }
}
