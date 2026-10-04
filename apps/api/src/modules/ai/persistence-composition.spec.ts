import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { BoardPermissionService } from '../boards/application/index.js';
import { RuntimeAdmission } from '../../platform/lifecycle/runtime-admission.js';
import { AiModule } from './ai.module.js';
import { AI_PERSISTENCE, AI_INTENT_SERVICE, AI_PAYLOAD_CIPHER } from './application/persistence.js';
import { AiIntentService } from './application/intent-service.js';
import { PostgresAiPersistence } from './infrastructure/persistence/postgres-ai-persistence.js';
import {
  fixtureApiConfig,
  FIXTURE_AI_ENVIRONMENT,
} from './infrastructure/testing/fixture-config.js';
const source = {
  createQueryRunner: jest.fn(() => {
    throw new Error('Database I/O forbidden in composition test');
  }),
  initialize: jest.fn(),
};
@Module({})
class FixtureDatabase {}
@Module({
  providers: [{ provide: BoardPermissionService, useValue: {} }],
  exports: [BoardPermissionService],
})
class FixtureAuthority {}
describe('AI durable Nest composition without database or provider I/O', () => {
  it.each([true, false])('constructs persistence only with AI enabled=%s', async (enabled) => {
    source.createQueryRunner.mockClear();
    source.initialize.mockClear();
    const registration = AiModule.register(
      fixtureApiConfig(enabled ? FIXTURE_AI_ENVIRONMENT : {}),
      {
        database: {
          module: FixtureDatabase,
          providers: [
            { provide: DataSource, useValue: source },
            { provide: RuntimeAdmission, useValue: new RuntimeAdmission() },
          ],
          exports: [DataSource, RuntimeAdmission],
        },
        authority: FixtureAuthority,
      },
    );
    const context = await NestFactory.createApplicationContext(registration, {
      logger: false,
      abortOnError: false,
    });
    try {
      if (enabled) {
        expect(context.get(AI_PERSISTENCE)).toBeInstanceOf(PostgresAiPersistence);
        expect(context.get(AI_INTENT_SERVICE)).toBeInstanceOf(AiIntentService);
        expect(JSON.stringify(context.get(AI_PAYLOAD_CIPHER))).not.toContain(
          FIXTURE_AI_ENVIRONMENT.AI_CONTENT_ENCRYPTION_KEY,
        );
      } else expect(() => context.get(AI_INTENT_SERVICE)).toThrow();
      expect(source.createQueryRunner).not.toHaveBeenCalled();
      expect(source.initialize).not.toHaveBeenCalled();
    } finally {
      await context.close();
    }
  });
});
