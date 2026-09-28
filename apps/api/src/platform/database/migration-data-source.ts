import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { loadApiConfig } from '../config/index.js';
import { DATABASE_ENTITIES } from './database-entities.js';

const config = loadApiConfig(process.env);

export default new DataSource({
  type: 'postgres',
  url: config.databaseDirectUrl,
  entities: [...DATABASE_ENTITIES],
  migrations: [InitialDatabaseFoundation1789300000000, RetainCompactedUpdateReceipts1790426800000],
  synchronize: false,
  migrationsRun: false,
  extra: {
    max: 1,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  },
});
