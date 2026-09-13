import {
  ConfigurationError,
  loadApiConfig,
  MAX_ACTIVE_ROOMS_PER_PROCESS,
  MAX_CONNECTIONS_PER_ROOM,
  MAX_VALIDATION_QUEUE_DEPTH,
  MAX_VALIDATION_WORKERS,
  VALIDATION_TIMEOUT_MS,
} from './index.js';

const VALID_ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PUBLIC_API_ORIGIN: 'https://api.example.com',
  ALLOWED_WEB_ORIGINS: 'https://app.example.com, https://preview.example.com',
  PORT: '10000',
  DATABASE_URL: 'postgresql://user:secret@pooled.example.com/archboard',
  DATABASE_DIRECT_URL: 'postgresql://user:other-secret@direct.example.com/archboard',
};

const EXPECTED_VALIDATION_TIMEOUT_MS = 2_000;
const EXPECTED_MAX_VALIDATION_WORKERS = 2;
const EXPECTED_MAX_VALIDATION_QUEUE_DEPTH = 32;
const EXPECTED_MAX_CONNECTIONS_PER_ROOM = 10;
const EXPECTED_MAX_ACTIVE_ROOMS_PER_PROCESS = 20;

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
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedWebOrigins)).toBe(true);
  });

  it.each([
    ['missing pooled database URL', { DATABASE_URL: undefined }, 'DATABASE_URL'],
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

  it('publishes the agreed bounded validation and room defaults', () => {
    expect(VALIDATION_TIMEOUT_MS).toBe(EXPECTED_VALIDATION_TIMEOUT_MS);
    expect(MAX_VALIDATION_WORKERS).toBe(EXPECTED_MAX_VALIDATION_WORKERS);
    expect(MAX_VALIDATION_QUEUE_DEPTH).toBe(EXPECTED_MAX_VALIDATION_QUEUE_DEPTH);
    expect(MAX_CONNECTIONS_PER_ROOM).toBe(EXPECTED_MAX_CONNECTIONS_PER_ROOM);
    expect(MAX_ACTIVE_ROOMS_PER_PROCESS).toBe(EXPECTED_MAX_ACTIVE_ROOMS_PER_PROCESS);
  });
});
