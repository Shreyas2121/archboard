import type { ApiConfig } from '../config/index.js';
import { DATABASE_ENTITIES } from './database-entities.js';

export function runtimeDataSourceOptions(config: ApiConfig) {
  return {
    type: 'postgres' as const,
    url: config.databaseUrl,
    entities: [...DATABASE_ENTITIES],
    synchronize: false,
    migrationsRun: false,
    extra: {
      max: config.typeormPoolMax,
      connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    },
  };
}

export function directDataSourceOptions(config: ApiConfig) {
  return {
    type: 'postgres' as const,
    url: config.databaseDirectUrl,
    entities: [],
    synchronize: false,
    migrationsRun: false,
    extra: {
      max: 1,
      connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    },
  };
}
