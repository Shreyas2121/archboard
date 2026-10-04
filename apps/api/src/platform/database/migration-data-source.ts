import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { loadApiConfig } from '../config/index.js';
import { DATABASE_ENTITIES } from './database-entities.js';
import { AiPersistenceFoundation1791072000000 } from '../../migrations/1791072000000-AiPersistenceFoundation.js';
import { AiAdmissionFoundation1791072000001 } from '../../migrations/1791072000001-AiAdmissionFoundation.js';

const config = loadApiConfig(process.env);

export default new DataSource({
  type: 'postgres',
  url: config.databaseDirectUrl,
  entities: [...DATABASE_ENTITIES],
  migrations: [
    InitialDatabaseFoundation1789300000000,
    RetainCompactedUpdateReceipts1790426800000,
    AiPersistenceFoundation1791072000000,
    AiAdmissionFoundation1791072000001,
  ],
  synchronize: false,
  migrationsRun: false,
  extra: {
    max: 1,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  },
});
