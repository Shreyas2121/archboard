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
import { AI_RUN_COORDINATOR, AiRunCoordinator } from './application/run-coordinator.js';
import { AiRunSubscriptions } from './application/run-subscriptions.js';
import { AiPrivateIdentity } from './application/private-identity.js';
import { AiResultCache } from './application/result-cache.js';
import { AiRunApplication } from './application/run-application.js';
import { AiHttpService } from './application/http-service.js';
import { AiController } from './ai.controller.js';
import { AiEvents } from './ai-events.js';
import { AI_ADMISSION_SERVICE, AiAdmissionService } from './application/admission-service.js';
import { AI_CONNECTION_GATE, AiConnectionGate } from './application/connection-gate.js';
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
    auth?: DynamicModule,
  ): DynamicModule {
    const durableProviders: Provider[] =
      config.ai.enabled && persistence
        ? [
            {
              provide: AiPrivateIdentity,
              useFactory: () => {
                if (!config.ai.enabled) throw new Error('AI disabled.');
                return new AiPrivateIdentity(config.ai.secrets.cacheKeySecret);
              },
            },
            {
              provide: AiResultCache,
              inject: [AI_PAYLOAD_CIPHER],
              useFactory: (cipher: AiPayloadCipher) => {
                if (!config.ai.enabled) throw new Error('AI disabled.');
                return new AiResultCache(cipher, config.ai.policy.cache);
              },
            },
            {
              provide: AiRunApplication,
              inject: [AiPrivateIdentity, AI_PROVIDER_REGISTRY, AI_RUN_COORDINATOR],
              useFactory: (
                identity: AiPrivateIdentity,
                registry: AiProviderRegistry,
                runs: AiRunCoordinator,
              ) => new AiRunApplication(identity, registry, runs),
            },
            {
              provide: AiRunSubscriptions,
              inject: [AI_RUN_COORDINATOR, AI_CONNECTION_GATE],
              useFactory: (runs: AiRunCoordinator, gate: AiConnectionGate) =>
                new AiRunSubscriptions(runs, gate),
            },
            {
              provide: AI_RUN_COORDINATOR,
              inject: [AI_INTENT_SERVICE, RuntimeAdmission],
              useFactory: (intents: AiIntentService, runtime: RuntimeAdmission) => {
                if (!config.ai.enabled) throw new Error('AI disabled.');
                return new AiRunCoordinator(intents, runtime, config.ai.policy);
              },
            },
            {
              provide: AI_CONNECTION_GATE,
              useFactory: () => new AiConnectionGate(config.ai.enabled ? config.ai.policy : null),
            },
            {
              provide: AI_ADMISSION_SERVICE,
              useFactory: () => new AiAdmissionService(config.ai.enabled ? config.ai.policy : null),
            },
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
              inject: [AI_PERSISTENCE, AI_PAYLOAD_CIPHER, AI_ADMISSION_SERVICE, AiResultCache],
              useFactory: (
                store: AiPersistence,
                cipher: AiPayloadCipher,
                admission: AiAdmissionService,
                cache: AiResultCache,
              ) => new AiIntentService(store, cipher, admission, cache),
            },
          ]
        : [];
    return {
      module: AiModule,
      imports: [
        ...(auth ? [auth] : []),
        ...(config.ai.enabled && persistence ? [persistence.database, persistence.authority] : []),
      ],
      controllers: auth ? [AiController] : [],
      providers: [
        AiEvents,
        {
          provide: AiHttpService,
          inject: durableProviders.length
            ? [
                AiRunApplication,
                AI_RUN_COORDINATOR,
                AiRunSubscriptions,
                AI_ADMISSION_SERVICE,
                AI_PERSISTENCE,
              ]
            : [],
          useFactory: (
            application?: AiRunApplication,
            runs?: AiRunCoordinator,
            subscriptions?: AiRunSubscriptions,
            admission?: AiAdmissionService,
            store?: AiPersistence,
          ) =>
            new AiHttpService(
              config.ai.enabled ? config.ai.policy : null,
              application && runs && subscriptions && admission && store
                ? { application, runs, subscriptions, admission, persistence: store }
                : undefined,
            ),
        },
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
        ...(durableProviders.length
          ? [
              AI_PERSISTENCE,
              AI_INTENT_SERVICE,
              AI_ADMISSION_SERVICE,
              AI_CONNECTION_GATE,
              AI_RUN_COORDINATOR,
              AiRunSubscriptions,
              AiRunApplication,
            ]
          : []),
      ],
    };
  }
}
