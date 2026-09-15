import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { ApiConfig } from '../../platform/config/index.js';
import { AUTH_SESSION_LOOKUP } from './application/index.js';
import { BetterAuthSessionLookup } from './infrastructure/better-auth-session-lookup.js';
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
        {
          provide: AUTH_SESSION_LOOKUP,
          useFactory: (runtime: BetterAuthRuntime) => new BetterAuthSessionLookup(runtime),
          inject: [BetterAuthRuntime],
        },
      ],
      exports: [BetterAuthRuntime, AUTH_SESSION_LOOKUP],
    };
  }
}
