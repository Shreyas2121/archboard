import {
  ConfigurationError,
  loadApiConfig,
  MAX_ACTIVE_ROOMS_PER_PROCESS,
  MAX_CONNECTIONS_PER_ROOM,
  MAX_VALIDATION_QUEUE_DEPTH,
  MAX_VALIDATION_WORKERS,
  VALIDATION_TIMEOUT_MS,
  WS_HANDSHAKE_TIMEOUT_MS,
  WS_PING_INTERVAL_MS,
  WS_PONG_TIMEOUT_MS,
} from './index.js';

const VALID_ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PUBLIC_API_ORIGIN: 'https://api.example.com',
  ALLOWED_WEB_ORIGINS: 'https://app.example.com, https://preview.example.com',
  PORT: '10000',
  DATABASE_URL: 'postgresql://user:secret@pooled.example.com/archboard',
  DATABASE_DIRECT_URL: 'postgresql://user:other-secret@direct.example.com/archboard',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
  GITHUB_CLIENT_ID: 'Ov23liExampleClientId1234567890',
  GITHUB_CLIENT_SECRET: '0123456789abcdef0123456789abcdef01234567',
};

const EXPECTED_VALIDATION_TIMEOUT_MS = 2_000;
const EXPECTED_MAX_VALIDATION_WORKERS = 2;
const EXPECTED_MAX_VALIDATION_QUEUE_DEPTH = 20;
const EXPECTED_MAX_CONNECTIONS_PER_ROOM = 10;
const EXPECTED_MAX_ACTIVE_ROOMS_PER_PROCESS = 20;
const EXPECTED_WS_HANDSHAKE_TIMEOUT_MS = 5_000;
const EXPECTED_WS_PING_INTERVAL_MS = 15_000;
const EXPECTED_WS_PONG_TIMEOUT_MS = 45_000;

describe('API runtime configuration', () => {
  it('parses and normalizes the complete environment', () => {
    const config = loadApiConfig(VALID_ENVIRONMENT);

    expect(config).toEqual({
      mode: 'production',
      publicApiOrigin: 'https://api.example.com',
      allowedWebOrigins: ['https://app.example.com', 'https://preview.example.com'],
      port: 10_000,
      databaseUrl: VALID_ENVIRONMENT.DATABASE_URL,
      databaseDirectUrl: VALID_ENVIRONMENT.DATABASE_DIRECT_URL,
      typeormPoolMax: 10,
      betterAuthPoolMax: 5,
      databaseConnectionTimeoutMs: 10_000,
      betterAuthIdleTimeoutMs: 30_000,
      betterAuthSecret: VALID_ENVIRONMENT.BETTER_AUTH_SECRET,
      githubClientId: VALID_ENVIRONMENT.GITHUB_CLIENT_ID,
      githubClientSecret: VALID_ENVIRONMENT.GITHUB_CLIENT_SECRET,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedWebOrigins)).toBe(true);
  });

  it.each([
    ['missing pooled database URL', { DATABASE_URL: undefined }, 'DATABASE_URL'],
    ['missing GitHub client ID', { GITHUB_CLIENT_ID: undefined }, 'GITHUB_CLIENT_ID'],
    ['missing GitHub client secret', { GITHUB_CLIENT_SECRET: undefined }, 'GITHUB_CLIENT_SECRET'],
    [
      'malformed GitHub client ID',
      { GITHUB_CLIENT_ID: 'replace-with-a-client-id' },
      'GITHUB_CLIENT_ID',
    ],
    [
      'malformed GitHub client secret',
      { GITHUB_CLIENT_SECRET: 'too-short' },
      'GITHUB_CLIENT_SECRET',
    ],
    ['malformed port', { PORT: 'ten-thousand' }, 'PORT'],
    [
      'API origin with a path',
      { PUBLIC_API_ORIGIN: 'https://api.example.com/v1' },
      'PUBLIC_API_ORIGIN',
    ],
    [
      'wildcard web origin',
      { ALLOWED_WEB_ORIGINS: 'https://*.example.com' },
      'ALLOWED_WEB_ORIGINS',
    ],
    [
      'duplicate web origin',
      { ALLOWED_WEB_ORIGINS: 'https://app.example.com,https://app.example.com' },
      'duplicate',
    ],
    [
      'non-PostgreSQL URL',
      { DATABASE_DIRECT_URL: 'https://database.example.com' },
      'DATABASE_DIRECT_URL',
    ],
  ])('rejects %s with an actionable error', (_caseName, overrides, expectedMessage) => {
    const environment = { ...VALID_ENVIRONMENT, ...overrides };

    expect(() => loadApiConfig(environment)).toThrow(expectedMessage);
  });

  it('allows insecure origins only for local hosts outside production', () => {
    expect(() =>
      loadApiConfig({
        ...VALID_ENVIRONMENT,
        NODE_ENV: 'development',
        PUBLIC_API_ORIGIN: 'http://localhost:3000',
        ALLOWED_WEB_ORIGINS: 'http://127.0.0.1:5173',
      }),
    ).not.toThrow();

    expect(() =>
      loadApiConfig({
        ...VALID_ENVIRONMENT,
        PUBLIC_API_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow('HTTPS in production');
  });

  it('does not disclose database credentials in validation errors', () => {
    const secret = 'do-not-log-this-secret';

    expect(() =>
      loadApiConfig({
        ...VALID_ENVIRONMENT,
        DATABASE_URL: `https://user:${secret}@example.com/db`,
      }),
    ).toThrow(ConfigurationError);

    try {
      loadApiConfig({
        ...VALID_ENVIRONMENT,
        DATABASE_URL: `https://user:${secret}@example.com/db`,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('keeps GitHub credentials optional only outside production and never prints a rejected secret', () => {
    const testConfig = loadApiConfig({
      ...VALID_ENVIRONMENT,
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    });
    expect(testConfig.githubClientId).toBeNull();
    expect(testConfig.githubClientSecret).toBeNull();

    const rejectedSecret = 'invalid!github!secret!that!must!not!appear';
    try {
      loadApiConfig({ ...VALID_ENVIRONMENT, GITHUB_CLIENT_SECRET: rejectedSecret });
      throw new Error('Expected invalid GitHub configuration to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).toContain('GITHUB_CLIENT_SECRET');
      expect(String(error)).not.toContain(rejectedSecret);
    }
  });

  it('publishes the agreed bounded validation and room defaults', () => {
    expect(VALIDATION_TIMEOUT_MS).toBe(EXPECTED_VALIDATION_TIMEOUT_MS);
    expect(MAX_VALIDATION_WORKERS).toBe(EXPECTED_MAX_VALIDATION_WORKERS);
    expect(MAX_VALIDATION_QUEUE_DEPTH).toBe(EXPECTED_MAX_VALIDATION_QUEUE_DEPTH);
    expect(MAX_CONNECTIONS_PER_ROOM).toBe(EXPECTED_MAX_CONNECTIONS_PER_ROOM);
    expect(MAX_ACTIVE_ROOMS_PER_PROCESS).toBe(EXPECTED_MAX_ACTIVE_ROOMS_PER_PROCESS);
  });

  it('publishes the specified WebSocket handshake and heartbeat timings', () => {
    expect(WS_HANDSHAKE_TIMEOUT_MS).toBe(EXPECTED_WS_HANDSHAKE_TIMEOUT_MS);
    expect(WS_PING_INTERVAL_MS).toBe(EXPECTED_WS_PING_INTERVAL_MS);
    expect(WS_PONG_TIMEOUT_MS).toBe(EXPECTED_WS_PONG_TIMEOUT_MS);
  });
});
