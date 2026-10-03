import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import {
  AI_POLICY,
  AI_PROVIDER_ADAPTERS,
  AI_PROVIDER_REGISTRY,
  AiProviderRegistry,
  type AiProvider,
} from './application/index.js';

export const AI_OPERATOR_SECRETS = Symbol('AI_OPERATOR_SECRETS');

@Module({})
export class AiModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: AiModule,
      providers: [
        { provide: AI_POLICY, useValue: config.ai.enabled ? config.ai.policy : null },
        { provide: AI_OPERATOR_SECRETS, useValue: config.ai.enabled ? config.ai.secrets : null },
        // C03 registers the real adapter. There is no fixture fallback or paid endpoint.
        { provide: AI_PROVIDER_ADAPTERS, useValue: [] },
        {
          provide: AI_PROVIDER_REGISTRY,
          inject: [AI_PROVIDER_ADAPTERS],
          useFactory: (adapters: readonly AiProvider[]) =>
            new AiProviderRegistry(
              config.mode,
              config.ai.enabled ? config.ai.policy : null,
              adapters,
            ),
        },
      ],
      exports: [AI_POLICY, AI_PROVIDER_REGISTRY],
    };
  }
}
