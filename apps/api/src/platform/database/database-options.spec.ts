import { loadApiConfig } from '../config/index.js';
import { BetterAuthRuntime } from '../../modules/auth/infrastructure/better-auth.runtime.js';
import { DATABASE_ENTITIES } from './database-entities.js';
import { directDataSourceOptions, runtimeDataSourceOptions } from './data-source-options.js';

const TEST_CONFIG = loadApiConfig({
  NODE_ENV: 'test',
  PUBLIC_API_ORIGIN: 'http://localhost:3000',
  ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:secret@pooled.example.com/archboard',
  DATABASE_DIRECT_URL: 'postgresql://user:secret@direct.example.com/archboard',
  BETTER_AUTH_SECRET: 'database-options-test-secret-32-characters',
});

describe('database configuration', () => {
  it('uses pooled runtime access, explicit entities, and disabled synchronization', () => {
    const options = runtimeDataSourceOptions(TEST_CONFIG);

    expect(options.url).toBe(TEST_CONFIG.databaseUrl);
    expect(options.entities).toEqual([...DATABASE_ENTITIES]);
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.extra).toMatchObject({
      max: TEST_CONFIG.typeormPoolMax,
      connectionTimeoutMillis: TEST_CONFIG.databaseConnectionTimeoutMs,
    });
  });

  it('uses a single direct connection for session-scoped infrastructure', () => {
    const options = directDataSourceOptions(TEST_CONFIG);

    expect(options.url).toBe(TEST_CONFIG.databaseDirectUrl);
    expect(options.entities).toEqual([]);
    expect(options.synchronize).toBe(false);
    expect(options.extra.max).toBe(1);
  });

  it('gives Better Auth its own bounded pg pool', async () => {
    const runtime = new BetterAuthRuntime(TEST_CONFIG);

    expect(runtime.pool.options.connectionString).toBe(TEST_CONFIG.databaseUrl);
    expect(runtime.pool.options.max).toBe(TEST_CONFIG.betterAuthPoolMax);
    expect(runtime.pool.options.connectionTimeoutMillis).toBe(
      TEST_CONFIG.databaseConnectionTimeoutMs,
    );
    expect(runtime.pool.options.idleTimeoutMillis).toBe(TEST_CONFIG.betterAuthIdleTimeoutMs);
    await runtime.onApplicationShutdown();
  });
});
