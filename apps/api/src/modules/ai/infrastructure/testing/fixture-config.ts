import { loadApiConfig, type ApiConfig } from '../../../../platform/config/index.js';
import { loadAiConfig } from '../../../../platform/config/ai-config.js';

/** Synthetic configuration for database-free tests; not a production model profile. */
const HEX_KEY_CHARACTERS = 64;
export const FIXTURE_MODEL_PROFILE = {
  quality: 'standard',
  model: 'fixture-model-v1',
  pricingVersion: 'fixture-pricing-v1',
  tokenCountingVersion: 'fixture-counter-v1',
  contextWindowTokens: 2_000,
  maximumInputTokens: 1_000,
  maximumOutputTokens: 100,
  structuredOutput: true,
  prices: {
    uncachedInputMicroUsdPerMillion: '1',
    cacheReadMicroUsdPerMillion: '0',
    cacheWrites: [],
    outputMicroUsdPerMillion: '2',
    separateReasoningMicroUsdPerMillion: null,
  },
};
export const FIXTURE_AI_ENVIRONMENT: NodeJS.ProcessEnv = {
  AI_ENABLED: 'true',
  AI_PROVIDER: 'openai',
  AI_MODEL: FIXTURE_MODEL_PROFILE.model,
  AI_CONFIG_VERSION: 'fixture-config-v1',
  AI_DEPLOYMENT_NAMESPACE: 'fixture-deployment',
  AI_CONTENT_KEY_VERSION: 'fixture-key-v1',
  OPENAI_API_KEY: 'fixture-only-unused-key-never-send-to-provider',
  AI_CACHE_KEY_SECRET: 'a'.repeat(HEX_KEY_CHARACTERS),
  AI_CONTENT_ENCRYPTION_KEY: 'b'.repeat(HEX_KEY_CHARACTERS),
  AI_DAILY_BUDGET_MICRO_USD: '100',
  AI_MONTHLY_BUDGET_MICRO_USD: '1000',
  AI_GLOBAL_BUDGET_MICRO_USD: '10000',
  AI_PROVIDER_RPM: '10',
  AI_PROVIDER_INPUT_TPM: '2000',
  AI_PROVIDER_OUTPUT_TPM: '2000',
  AI_MODEL_PROFILES: JSON.stringify([FIXTURE_MODEL_PROFILE]),
};
export function fixtureAiPolicy(overrides: NodeJS.ProcessEnv = {}) {
  const config = loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, ...overrides });
  if (!config.enabled) throw new Error('Fixture policy requires enabled config.');
  return config.policy;
}
export function fixtureApiConfig(overrides: NodeJS.ProcessEnv = {}): ApiConfig {
  return loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: 'http://localhost:3000',
    ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
    PORT: '3000',
    DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
    DATABASE_DIRECT_URL: 'postgresql://unused:unused@localhost/unused',
    BETTER_AUTH_SECRET: 'unused-fixture-secret-at-least-32-characters',
    ...overrides,
  });
}
