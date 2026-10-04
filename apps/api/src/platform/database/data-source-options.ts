import type { ApiConfig } from '../config/index.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { DATABASE_ENTITIES } from './database-entities.js';
import { AiPersistenceFoundation1791072000000 } from '../../migrations/1791072000000-AiPersistenceFoundation.js';
import { AiAdmissionFoundation1791072000001 } from '../../migrations/1791072000001-AiAdmissionFoundation.js';
import { AiResultCache1791072000002 } from '../../migrations/1791072000002-AiResultCache.js';

export function runtimeDataSourceOptions(config: ApiConfig) {
  return {
    type: 'postgres' as const,
    url: config.databaseUrl,
    entities: [...DATABASE_ENTITIES],
    migrations: [
      InitialDatabaseFoundation1789300000000,
      RetainCompactedUpdateReceipts1790426800000,
      AiPersistenceFoundation1791072000000,
      AiAdmissionFoundation1791072000001,
      AiResultCache1791072000002,
    ],
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
