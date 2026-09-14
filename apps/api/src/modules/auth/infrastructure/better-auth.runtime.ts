import type { OnApplicationShutdown } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

import type { ApiConfig } from '../../../platform/config/index.js';

function createAuth(config: ApiConfig, pool: Pool) {
  return betterAuth({
    appName: 'Archboard',
    baseURL: config.publicApiOrigin,
    trustedOrigins: [...config.allowedWebOrigins],
    secret: config.betterAuthSecret,
    database: pool,
    advanced: { database: { joins: true } },
  });
}

type ArchboardAuth = ReturnType<typeof createAuth>;

export class BetterAuthRuntime implements OnApplicationShutdown {
  public readonly pool: Pool;
  public readonly auth: ArchboardAuth;

  public constructor(config: ApiConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.betterAuthPoolMax,
      connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
      idleTimeoutMillis: config.betterAuthIdleTimeoutMs,
    });
    this.auth = createAuth(config, this.pool);
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
