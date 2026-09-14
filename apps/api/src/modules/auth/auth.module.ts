import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { ApiConfig } from '../../platform/config/index.js';
import { BetterAuthRuntime } from './infrastructure/better-auth.runtime.js';

@Module({})
export class AuthModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        {
          provide: BetterAuthRuntime,
          useFactory: () => new BetterAuthRuntime(config),
        },
      ],
      exports: [BetterAuthRuntime],
    };
  }
}
