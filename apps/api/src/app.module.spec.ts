import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { AppModule } from './app.module.js';
import {
  fixtureApiConfig,
  FIXTURE_AI_ENVIRONMENT,
} from './modules/ai/infrastructure/testing/fixture-config.js';

describe('application composition without hosted AI', () => {
  it('registers no hosted AI module even when a legacy configuration is explicitly enabled', () => {
    const config = fixtureApiConfig(FIXTURE_AI_ENVIRONMENT);
    expect(config.ai.enabled).toBe(true);
    const registration = AppModule.register(config);
    const hasAi = registration.imports?.some(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'module' in entry &&
        entry.module.name === 'AiModule',
    );
    expect(hasAi).toBe(false);
  });
});
