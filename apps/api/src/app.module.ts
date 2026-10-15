import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AuthModule } from './modules/auth/index.js';
import { BoardsModule } from './modules/boards/boards.module.js';
import { BoardAuthorityModule } from './modules/boards/board-authority.module.js';
import { CollaborationModule } from './modules/collaboration/collaboration.module.js';
import type { ApiConfig } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { ApiExceptionFilter } from './platform/http/api-exception.filter.js';
import { HealthController, ReadinessService } from './platform/http/health.controller.js';
import { OpenApiController } from './platform/http/openapi.controller.js';
import { RuntimeAdmissionModule } from './platform/lifecycle/runtime-admission.js';

@Module({})
export class AppModule {
  public static register(config: ApiConfig): DynamicModule {
    // Reuse these registrations so every feature shares the same auth/database runtime.
    const auth = AuthModule.register(config);
    const database = DatabaseModule.register(config);
    const collaboration = CollaborationModule.register(
      config,
      auth,
      database,
      BoardAuthorityModule,
    );
    return {
      module: AppModule,
      imports: [
        RuntimeAdmissionModule,
        auth,
        database,
        collaboration,
        BoardsModule.register(config, auth, collaboration),
      ],
      controllers: [AppController, HealthController, OpenApiController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }, ReadinessService],
    };
  }
}
