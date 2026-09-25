import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { ERROR_CODES } from '@archboard/contracts';
import { jest } from '@jest/globals';
import { DataSource, type QueryRunner } from 'typeorm';

import { InitialDatabaseFoundation1789300000000 } from '../../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { DATABASE_ENTITIES } from '../../../../platform/database/database-entities.js';
import { BoardTransaction } from '../../infrastructure/board-transaction.js';
import { PostgresBoardAuthorityReader } from '../../infrastructure/postgres-board-authority-reader.js';
import { BoardPermissionService, type BoardPermissionDecision } from './board-permissions.js';

const TIMEOUT_MS = 60_000;
const OWNER = 'p304-owner';
const EDITOR = 'p304-editor';
const VIEWER = 'p304-viewer';
const OUTSIDER = 'p304-outsider';
const SCHEMA = `archboard_p304_${process.pid}`;

jest.setTimeout(TIMEOUT_MS);

describe('board permissions on real PostgreSQL', () => {
  let admin: DataSource;
  let database: DataSource;
  let boardId: string;
  let service: BoardPermissionService;
  let transaction: BoardTransaction;

  beforeAll(async () => {
    const url = process.env.DATABASE_DIRECT_URL;
    if (!url) throw new Error('DATABASE_DIRECT_URL is required for permission integration tests.');
    admin = new DataSource({ type: 'postgres', url, entities: [], synchronize: false });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    database = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: [...DATABASE_ENTITIES],
      migrations: [InitialDatabaseFoundation1789300000000],
      synchronize: false,
      migrationsRun: false,
      extra: { max: 6, options: `-c search_path=${SCHEMA}` },
    });
    await database.initialize();
    await database.runMigrations({ transaction: 'all' });
    service = new BoardPermissionService(new PostgresBoardAuthorityReader(database));
    transaction = new BoardTransaction(database);
  });

  beforeEach(async () => {
    await database.query('TRUNCATE boards, "user" CASCADE');
    for (const userId of [OWNER, EDITOR, VIEWER, OUTSIDER]) {
      await database.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt")
         VALUES ($1, $1, $2, false, CURRENT_TIMESTAMP)`,
        [userId, `${userId}@example.test`],
      );
    }
    boardId = randomUUID();
    await database.query('INSERT INTO boards (id, owner_user_id, title) VALUES ($1, $2, $3)', [
      boardId,
      OWNER,
      'Permission fixture',
    ]);
    await database.query(
      `INSERT INTO board_members (board_id, user_id, role) VALUES
       ($1, $2, 'editor'), ($1, $3, 'viewer')`,
      [boardId, EDITOR, VIEWER],
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      try {
        await admin.query(`DROP SCHEMA "${SCHEMA}" CASCADE`);
      } finally {
        await admin.destroy();
      }
    }
  });

  function locked(check: (runner: QueryRunner) => Promise<BoardPermissionDecision>) {
    return transaction.run(check);
  }

  it('derives every active role from owner and membership and hides unrelated boards', async () => {
    for (const [userId, role] of [
      [OWNER, 'owner'],
      [EDITOR, 'editor'],
      [VIEWER, 'viewer'],
    ] as const) {
      expect(await service.read(boardId, userId)).toMatchObject({ allowed: true, role });
    }
    const denied = { allowed: false, code: ERROR_CODES.NOT_FOUND };
    expect(await service.read(boardId, OUTSIDER)).toEqual(denied);
    expect(await service.read(randomUUID(), OUTSIDER)).toEqual(denied);
    expect(await locked((runner) => service.editGraph(runner, boardId, OUTSIDER))).toEqual(denied);
    expect(await locked((runner) => service.editGraph(runner, randomUUID(), OWNER))).toEqual(
      denied,
    );
  });

  it('enforces active write and access roles while holding the board row lock', async () => {
    for (const userId of [OWNER, EDITOR]) {
      expect(await locked((runner) => service.editMetadata(runner, boardId, userId))).toMatchObject(
        { allowed: true },
      );
      expect(await locked((runner) => service.editGraph(runner, boardId, userId))).toMatchObject({
        allowed: true,
      });
    }
    expect(await locked((runner) => service.manageAccess(runner, boardId, OWNER))).toMatchObject({
      allowed: true,
      role: 'owner',
    });
    for (const userId of [EDITOR, VIEWER]) {
      expect(await locked((runner) => service.manageAccess(runner, boardId, userId))).toEqual({
        allowed: false,
        code: ERROR_CODES.FORBIDDEN,
      });
    }
    expect(await locked((runner) => service.editMetadata(runner, boardId, VIEWER))).toEqual({
      allowed: false,
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(await locked((runner) => service.editGraph(runner, boardId, VIEWER))).toEqual({
      allowed: false,
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('permits archived reads and owner restore but blocks all other active-only writes', async () => {
    await database.query('UPDATE boards SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [
      boardId,
    ]);
    for (const userId of [OWNER, EDITOR, VIEWER]) {
      expect(await service.read(boardId, userId)).toMatchObject({ allowed: true });
    }
    for (const userId of [OWNER, EDITOR]) {
      expect(await locked((runner) => service.editMetadata(runner, boardId, userId))).toEqual({
        allowed: false,
        code: ERROR_CODES.BOARD_ARCHIVED,
      });
      expect(await locked((runner) => service.editGraph(runner, boardId, userId))).toEqual({
        allowed: false,
        code: ERROR_CODES.BOARD_ARCHIVED,
      });
    }
    expect(await locked((runner) => service.manageAccess(runner, boardId, OWNER))).toEqual({
      allowed: false,
      code: ERROR_CODES.BOARD_ARCHIVED,
    });
    expect(await locked((runner) => service.manageLifecycle(runner, boardId, OWNER))).toMatchObject(
      { allowed: true, role: 'owner' },
    );
    expect(await locked((runner) => service.editGraph(runner, boardId, OUTSIDER))).toEqual({
      allowed: false,
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('rechecks changed membership under lock after an optimistic preflight', async () => {
    expect(await service.previewEditGraph(boardId, EDITOR)).toMatchObject({ allowed: true });
    await database.query('DELETE FROM board_members WHERE board_id = $1 AND user_id = $2', [
      boardId,
      EDITOR,
    ]);
    expect(await locked((runner) => service.editGraph(runner, boardId, EDITOR))).toEqual({
      allowed: false,
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('serializes archive and graph authority on the same board row', async () => {
    const archive = database.createQueryRunner();
    const graph = database.createQueryRunner();
    try {
      await archive.connect();
      await graph.connect();
      await archive.startTransaction();
      expect(await service.manageLifecycle(archive, boardId, OWNER)).toMatchObject({
        allowed: true,
      });
      await graph.startTransaction();
      await graph.query("SET LOCAL lock_timeout = '250ms'");
      await expect(service.editGraph(graph, boardId, EDITOR)).rejects.toMatchObject({
        driverError: { code: '55P03' },
      });
      await graph.rollbackTransaction();
      await archive.query('UPDATE boards SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [
        boardId,
      ]);
      await archive.commitTransaction();
      expect(await locked((runner) => service.editGraph(runner, boardId, EDITOR))).toEqual({
        allowed: false,
        code: ERROR_CODES.BOARD_ARCHIVED,
      });
    } finally {
      if (graph.isTransactionActive) await graph.rollbackTransaction();
      if (archive.isTransactionActive) await archive.rollbackTransaction();
      await graph.release();
      await archive.release();
    }
  });
});
