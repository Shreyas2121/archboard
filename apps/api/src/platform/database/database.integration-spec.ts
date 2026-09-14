import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { BoardEntity } from '../../modules/boards/infrastructure/entities/board.entity.js';
import { BoardSnapshotEntity } from '../../modules/collaboration/infrastructure/entities/board-snapshot.entity.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { loadApiConfig } from '../config/index.js';
import {
  CollaborationWriterLockService,
  CollaborationWriterLockUnavailableError,
} from './collaboration-writer-lock.service.js';
import { DATABASE_ENTITIES } from './database-entities.js';
import { directDataSourceOptions } from './data-source-options.js';

const TEST_USER_ID = 'database-integration-user';
const UNSAFE_JAVASCRIPT_BIGINT = '9007199254740993';
const SNAPSHOT_BYTES = Buffer.from('000102ff', 'hex');
const EXPECTED_APPLICATION_TABLE_COUNT = 10;
const EXPECTED_AUTH_TABLE_COUNT = 4;
const DATABASE_INTEGRATION_TIMEOUT_MS = 30_000;

jest.setTimeout(DATABASE_INTEGRATION_TIMEOUT_MS);

function integrationConfig() {
  return loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: 'http://localhost:3000',
    ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
    PORT: '3000',
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  });
}

function integrationDataSource(): DataSource {
  const config = integrationConfig();
  return new DataSource({
    type: 'postgres',
    url: config.databaseDirectUrl,
    entities: [...DATABASE_ENTITIES],
    migrations: [InitialDatabaseFoundation1789300000000],
    synchronize: false,
    migrationsRun: false,
    extra: { max: config.typeormPoolMax },
  });
}

describe('real PostgreSQL database foundation', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = integrationDataSource();
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('applies the complete auth-first migration to an empty database', async () => {
    const tables = (await dataSource.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `)) as { table_name: string }[];
    const names = new Set(tables.map(({ table_name: name }) => name));
    for (const authTable of ['user', 'session', 'account', 'verification']) {
      expect(names).toContain(authTable);
    }
    for (const applicationTable of [
      'boards',
      'board_members',
      'board_invites',
      'board_snapshots',
      'board_updates',
      'update_receipts',
      'checkpoints',
      'comment_threads',
      'comments',
      'api_idempotency',
    ]) {
      expect(names).toContain(applicationTable);
    }
    expect(names.size).toBeGreaterThanOrEqual(
      EXPECTED_AUTH_TABLE_COUNT + EXPECTED_APPLICATION_TABLE_COUNT,
    );
  });

  it('preserves Better Auth text IDs, bigint sequences, and bytea values', async () => {
    await dataSource.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
       VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP)`,
      [TEST_USER_ID, 'Database Test', 'database-test@example.com'],
    );
    const now = new Date();
    const boardRepository = dataSource.getRepository(BoardEntity);
    const board = await boardRepository.save({
      id: randomUUID(),
      ownerUserId: TEST_USER_ID,
      title: 'Database foundation',
      description: '',
      archivedAt: null,
      metadataVersion: 1,
      latestSeq: UNSAFE_JAVASCRIPT_BIGINT,
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await dataSource.getRepository(BoardSnapshotEntity).save({
      boardId: board.id,
      schemaVersion: 1,
      throughSeq: UNSAFE_JAVASCRIPT_BIGINT,
      updateBytes: SNAPSHOT_BYTES,
      byteLength: SNAPSHOT_BYTES.byteLength,
      updatedAt: now,
    });

    const loadedBoard = await boardRepository.findOneByOrFail({ id: board.id });
    const loadedSnapshot = await dataSource
      .getRepository(BoardSnapshotEntity)
      .findOneByOrFail({ boardId: board.id });
    expect(loadedBoard.latestSeq).toBe(UNSAFE_JAVASCRIPT_BIGINT);
    expect(typeof loadedBoard.latestSeq).toBe('string');
    expect(loadedSnapshot.throughSeq).toBe(UNSAFE_JAVASCRIPT_BIGINT);
    expect(loadedSnapshot.updateBytes).toEqual(SNAPSHOT_BYTES);
  });

  it('holds one direct-session writer lock, fails a second owner, and permits reacquisition after release', async () => {
    const config = integrationConfig();
    const first = new CollaborationWriterLockService(
      new DataSource(directDataSourceOptions(config)),
    );
    const second = new CollaborationWriterLockService(
      new DataSource(directDataSourceOptions(config)),
    );
    await first.onModuleInit();
    expect(await first.isReady()).toBe(true);
    await expect(second.onModuleInit()).rejects.toBeInstanceOf(
      CollaborationWriterLockUnavailableError,
    );

    await first.onApplicationShutdown();
    expect(await first.isReady()).toBe(false);

    const replacement = new CollaborationWriterLockService(
      new DataSource(directDataSourceOptions(config)),
    );
    await replacement.onModuleInit();
    expect(await replacement.isReady()).toBe(true);
    await replacement.onApplicationShutdown();
  });
});
