import { Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BoardPermissionService } from '../boards/application/index.js';
import { RuntimeAdmission } from '../../platform/lifecycle/runtime-admission.js';
import { PostgresAiPersistence } from './infrastructure/persistence/postgres-ai-persistence.js';
import { AesGcmAiPayloadCipher } from './infrastructure/persistence/payload-cipher.js';
import {
  AI_PERSISTENCE,
  AI_PAYLOAD_CIPHER,
  AI_INTENT_SERVICE,
  type AiPersistence,
  type AiPayloadCipher,
} from './application/persistence.js';
import { AiIntentService } from './application/intent-service.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { OpenAiProvider } from './infrastructure/providers/openai/openai-provider.js';
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
  public static register(
    config: ApiConfig,
    persistence?: { database: DynamicModule; authority: Type<object> },
  ): DynamicModule {
    const durableProviders: Provider[] =
      config.ai.enabled && persistence
        ? [
            {
              provide: AI_PERSISTENCE,
              inject: [DataSource, BoardPermissionService, RuntimeAdmission],
              useFactory: (
                source: DataSource,
                authority: BoardPermissionService,
                admission: RuntimeAdmission,
              ) => new PostgresAiPersistence(source, authority, admission),
            },
            {
              provide: AI_PAYLOAD_CIPHER,
              useFactory: () => {
                if (!config.ai.enabled) throw new Error('AI disabled.');
                return new AesGcmAiPayloadCipher(
                  config.ai.secrets.contentEncryptionKey,
                  config.ai.contentKeyVersion,
                  config.ai.policy.cache.payloadBytes,
                );
              },
            },
            {
              provide: AI_INTENT_SERVICE,
              inject: [AI_PERSISTENCE, AI_PAYLOAD_CIPHER],
              useFactory: (store: AiPersistence, cipher: AiPayloadCipher) =>
                new AiIntentService(store, cipher),
            },
          ]
        : [];
    return {
      module: AiModule,
      imports:
        config.ai.enabled && persistence ? [persistence.database, persistence.authority] : [],
      providers: [
        ...durableProviders,
        { provide: AI_POLICY, useValue: config.ai.enabled ? config.ai.policy : null },
        { provide: AI_OPERATOR_SECRETS, useValue: config.ai.enabled ? config.ai.secrets : null },
        {
          provide: AI_PROVIDER_ADAPTERS,
          useFactory: (): readonly AiProvider[] =>
            config.ai.enabled
              ? [new OpenAiProvider(config.ai.secrets.openaiApiKey, config.ai.policy.profiles)]
              : [],
        },
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
      exports: [
        AI_POLICY,
        AI_PROVIDER_REGISTRY,
        ...(durableProviders.length ? [AI_PERSISTENCE, AI_INTENT_SERVICE] : []),
      ],
    };
  }
}
