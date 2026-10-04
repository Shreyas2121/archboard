import { AiConfigurationError, loadAiConfig } from './ai-config.js';
import {
  FIXTURE_AI_ENVIRONMENT,
  FIXTURE_MODEL_PROFILE,
  fixtureApiConfig,
} from '../../modules/ai/infrastructure/testing/fixture-config.js';
const DEFAULT_GLOBAL_CONCURRENCY = 2;

describe('server-owned AI operator configuration', () => {
  it('defaults off and permits ordinary API configuration without provider credentials', () => {
    expect(loadAiConfig({})).toEqual({ enabled: false });
    expect(
      loadAiConfig({ AI_ENABLED: '', AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'invalid' }),
    ).toEqual({ enabled: false });
    expect(fixtureApiConfig().ai).toEqual({ enabled: false });
  });
  it.each(['TRUE', '1', 'yes', ' true '])('rejects ambiguous enablement %j', (value) => {
    expect(() => loadAiConfig({ AI_ENABLED: value })).toThrow(AiConfigurationError);
  });
  it.each([
    'AI_PROVIDER',
    'AI_MODEL',
    'AI_MODEL_PROFILES',
    'AI_CONFIG_VERSION',
    'AI_DEPLOYMENT_NAMESPACE',
    'AI_CONTENT_KEY_VERSION',
    'OPENAI_API_KEY',
    'AI_CACHE_KEY_SECRET',
    'AI_CONTENT_ENCRYPTION_KEY',
  ])('requires %s when enabled', (name) => {
    expect(() => loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, [name]: undefined })).toThrow(name);
  });
  it.each([undefined, ''])('uses finite defaults when optional ceilings are %j', (value) => {
    const optionalNames = [
      'AI_DAILY_BUDGET_MICRO_USD',
      'AI_MONTHLY_BUDGET_MICRO_USD',
      'AI_GLOBAL_BUDGET_MICRO_USD',
      'AI_ACTOR_DAILY_BUDGET_MICRO_USD',
      'AI_PROVIDER_RPM',
      'AI_PROVIDER_INPUT_TPM',
      'AI_PROVIDER_OUTPUT_TPM',
    ];
    const config = loadAiConfig({
      ...FIXTURE_AI_ENVIRONMENT,
      ...Object.fromEntries(optionalNames.map((name) => [name, value])),
    });
    if (!config.enabled) throw new Error('Expected enabled config.');
    expect(config.policy.budgets).toEqual({
      dailyMicroUsd: '1000000',
      monthlyMicroUsd: '5000000',
      globalMicroUsd: '10000000',
      actorDailyMicroUsd: null,
    });
    expect(config.policy.limits).toMatchObject({
      providerRequestsPerMinute: 3,
      providerInputTokensPerMinute: 60000,
      providerOutputTokensPerMinute: 10000,
    });
  });
  it('honors optional overrides and fingerprints them while retaining profile admission checks', () => {
    const config = loadAiConfig({
      ...FIXTURE_AI_ENVIRONMENT,
      AI_ACTOR_DAILY_BUDGET_MICRO_USD: '25',
    });
    if (!config.enabled) throw new Error('Expected enabled config.');
    expect(config.policy.budgets).toEqual({
      dailyMicroUsd: '100',
      monthlyMicroUsd: '1000',
      globalMicroUsd: '10000',
      actorDailyMicroUsd: '25',
    });
    expect(config.policy.limits).toMatchObject({
      providerRequestsPerMinute: 10,
      providerInputTokensPerMinute: 2000,
      providerOutputTokensPerMinute: 2000,
    });
    const changed = loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, AI_GLOBAL_BUDGET_MICRO_USD: '9999' });
    if (!changed.enabled) throw new Error('Expected enabled config.');
    expect(changed.policy.fingerprint).not.toBe(config.policy.fingerprint);
    expect(() => loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, AI_PROVIDER_RPM: '0' })).toThrow(
      'AI_PROVIDER_RPM',
    );
    expect(() =>
      loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, AI_PROVIDER_INPUT_TPM: 'not-an-integer' }),
    ).toThrow('AI_PROVIDER_INPUT_TPM');
  });
  it.each(['anthropic', 'fixture', 'claude', 'gemini', 'azure', 'openai-compatible', 'OPENAI'])(
    'rejects unimplemented provider %s',
    (provider) => {
      expect(() => loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, AI_PROVIDER: provider })).toThrow(
        'AI_PROVIDER',
      );
    },
  );
  it.each(['development', 'test', 'production'] as const)(
    'does not enable an unimplemented provider with credentials in %s',
    (mode) => {
      const environment = {
        ...FIXTURE_AI_ENVIRONMENT,
        NODE_ENV: mode,
        PUBLIC_API_ORIGIN: 'https://api.example.com',
        ALLOWED_WEB_ORIGINS: 'https://api.example.com',
        GITHUB_CLIENT_ID: 'Ov23liExampleClientId1234567890',
        GITHUB_CLIENT_SECRET: '0123456789abcdef0123456789abcdef01234567',
      };
      expect(fixtureApiConfig(environment).ai.enabled).toBe(true);
      expect(() =>
        fixtureApiConfig({
          ...environment,
          AI_PROVIDER: 'anthropic',
          ANTHROPIC_API_KEY: 'fixture-key-not-a-real-credential',
        }),
      ).toThrow(AiConfigurationError);
      expect(() => fixtureApiConfig({ ...environment, AI_PROVIDER: 'fixture' })).toThrow(
        AiConfigurationError,
      );
    },
  );
  it('validates local key format without exposing rejected values or claiming account validity', () => {
    const secret = 'private-invalid-value-with-newline\nnever-log';
    try {
      loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, OPENAI_API_KEY: secret });
      throw new Error('Expected invalid config.');
    } catch (error) {
      expect(error).toBeInstanceOf(AiConfigurationError);
      expect(String(error)).toContain('OPENAI_API_KEY');
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain('never-log');
    }
    expect(() =>
      loadAiConfig({
        ...FIXTURE_AI_ENVIRONMENT,
        AI_CONTENT_ENCRYPTION_KEY: FIXTURE_AI_ENVIRONMENT.AI_CACHE_KEY_SECRET,
      }),
    ).toThrow('AI_CONTENT_ENCRYPTION_KEY');
  });
  it.each(['-1', '1.2', '1e6', '01', '0', '9223372036854775808', 'private-secret'])(
    'rejects invalid money %s safely',
    (value) => {
      try {
        loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, AI_DAILY_BUDGET_MICRO_USD: value });
        throw new Error('Expected invalid money.');
      } catch (error) {
        expect(error).toBeInstanceOf(AiConfigurationError);
        expect(String(error)).toContain('AI_DAILY_BUDGET_MICRO_USD');
        expect(String(error)).not.toContain(`: ${value}`);
      }
    },
  );
  it('keeps bigint money exact and freezes snapshots while omitting secrets from JSON', () => {
    const config = loadAiConfig({
      ...FIXTURE_AI_ENVIRONMENT,
      AI_GLOBAL_BUDGET_MICRO_USD: '9007199254740993',
    });
    expect(config.enabled).toBe(true);
    if (!config.enabled) return;
    expect(config.policy.budgets.globalMicroUsd).toBe('9007199254740993');
    expect(Object.isFrozen(config.policy.profiles[0]?.prices)).toBe(true);
    expect(Object.isFrozen(config.policy.limits)).toBe(true);
    expect(Object.isFrozen(config.secrets)).toBe(true);
    expect(config.secrets.openaiApiKey).toBe(FIXTURE_AI_ENVIRONMENT.OPENAI_API_KEY);
    for (const secret of [
      FIXTURE_AI_ENVIRONMENT.OPENAI_API_KEY,
      FIXTURE_AI_ENVIRONMENT.AI_CACHE_KEY_SECRET,
      FIXTURE_AI_ENVIRONMENT.AI_CONTENT_ENCRYPTION_KEY,
    ])
      expect(JSON.stringify(config)).not.toContain(secret);
    expect(() => Object.assign(config.policy.limits, { globalConcurrency: 100 })).toThrow();
  });
  it('fingerprints canonical operator policy, not secrets, and leaves existing snapshots fixed', () => {
    const first = loadAiConfig(FIXTURE_AI_ENVIRONMENT);
    const { prices, ...fields } = FIXTURE_MODEL_PROFILE;
    const reorderedProfile = { prices, ...fields };
    const second = loadAiConfig({
      ...FIXTURE_AI_ENVIRONMENT,
      OPENAI_API_KEY: 'other-fixture-only-unused-key-never-send',
      AI_MODEL_PROFILES: JSON.stringify([reorderedProfile]),
    });
    const changed = loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, AI_GLOBAL_CONCURRENCY: '3' });
    if (!first.enabled || !second.enabled || !changed.enabled)
      throw new Error('Expected enabled fixtures.');
    expect(second.policy.fingerprint).toBe(first.policy.fingerprint);
    expect(changed.policy.fingerprint).not.toBe(first.policy.fingerprint);
    expect(first.policy.limits.globalConcurrency).toBe(DEFAULT_GLOBAL_CONCURRENCY);
  });
  it.each([
    { AI_MODEL: 'not-in-profile' },
    { AI_MODEL_PROFILES: '{broken-secret' },
    {
      AI_MODEL_PROFILES: JSON.stringify([
        { ...FIXTURE_MODEL_PROFILE, endpoint: 'https://private.example' },
      ]),
    },
    { AI_MODEL_PROFILES: JSON.stringify([{ ...FIXTURE_MODEL_PROFILE, prices: {} }]) },
    { AI_MODEL_PROFILES: JSON.stringify([{ ...FIXTURE_MODEL_PROFILE, maximumInputTokens: 2000 }]) },
    { AI_MODEL_PROFILES: JSON.stringify([FIXTURE_MODEL_PROFILE, FIXTURE_MODEL_PROFILE]) },
    { AI_ACTOR_CONCURRENCY: '3' },
    { AI_CREATE_BURST: '11' },
    { AI_FRESH_PER_MINUTE: '21' },
    { AI_REPAIRS: '2' },
    { AI_REJECTION_RETRIES: '2' },
    { AI_DEADLINE_MS: '120001' },
    { AI_PROVIDER_INPUT_TPM: '999' },
    { AI_CACHE_ACTOR_ENTRIES: '129' },
    { AI_CACHE_BYTES: '1' },
    { AI_CACHE_TTL_MS: '900001' },
  ])('rejects invalid pricing/model/budget relationships %j', (overrides) => {
    expect(() => loadAiConfig({ ...FIXTURE_AI_ENVIRONMENT, ...overrides })).toThrow(
      AiConfigurationError,
    );
  });
  it.each([
    'VITE_AI_ENABLED',
    'VITE_OPENAI_API_KEY',
    'VITE_CUSTOM_AI_MODEL',
    'VITE_ANTHROPIC_API_KEY',
  ])('rejects public AI variable %s even when disabled', (name) => {
    expect(() => loadAiConfig({ [name]: 'secret-not-to-print' })).toThrow(name);
  });
  it('sanitizes malformed profile/pricing errors and requires no inactive provider credential', () => {
    try {
      loadAiConfig({
        ...FIXTURE_AI_ENVIRONMENT,
        AI_MODEL_PROFILES: JSON.stringify([
          {
            ...FIXTURE_MODEL_PROFILE,
            prices: {
              ...FIXTURE_MODEL_PROFILE.prices,
              outputMicroUsdPerMillion: 'private-pricing-secret',
            },
          },
        ]),
      });
      throw new Error('Expected invalid profile.');
    } catch (error) {
      expect(String(error)).toContain('AI_MODEL_PROFILES');
      expect(String(error)).not.toContain('private-pricing-secret');
    }
    expect(loadAiConfig(FIXTURE_AI_ENVIRONMENT).enabled).toBe(true);
    expect(fixtureApiConfig(FIXTURE_AI_ENVIRONMENT).ai.enabled).toBe(true);
  });
});
