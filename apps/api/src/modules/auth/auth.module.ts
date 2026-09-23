import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { ApiConfig } from '../../platform/config/index.js';
import { AUTH_REQUEST_ACTOR, AUTH_SESSION_LOOKUP } from './application/index.js';
import { BetterAuthRequestActor } from './infrastructure/better-auth-request-actor.js';
import { BetterAuthSessionLookup } from './infrastructure/better-auth-session-lookup.js';
import { BetterAuthRuntime } from './infrastructure/better-auth.runtime.js';
import { MeController } from './me.controller.js';

@Module({})
export class AuthModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AuthModule,
      controllers: [MeController],
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
        {
          provide: AUTH_REQUEST_ACTOR,
          useClass: BetterAuthRequestActor,
        },
      ],
      exports: [BetterAuthRuntime, AUTH_SESSION_LOOKUP, AUTH_REQUEST_ACTOR],
    };
  }
}
