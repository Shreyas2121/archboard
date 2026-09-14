import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { AppController } from './app.controller.js';
import type { ApiConfig } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';

@Module({})
export class AppModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.register(config)],
      controllers: [AppController],
    };
  }
}
