import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { createGraphDocument, validateGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import { DataSource, type QueryRunner } from 'typeorm';
import * as Y from 'yjs';

import { InitialDatabaseFoundation1789300000000 } from '../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { DATABASE_ENTITIES } from '../../../platform/database/database-entities.js';
import { BoardRepository, CommittedGraphRepository } from './board-repositories.js';
import { BoardTransaction } from './board-transaction.js';
import { createEmptyBoardSnapshot } from './empty-board-snapshot.js';
import {
  IdempotencyConflictError,
  IdempotencyService,
  canonicalRequestHash,
} from './idempotency.js';

const INTEGRATION_TIMEOUT_MS = 60_000;
const MAX_ACTIVE_OWNED_BOARDS = 100;
const PAGE_SIZE = 10;
jest.setTimeout(INTEGRATION_TIMEOUT_MS);

const schema = `archboard_p303_${process.pid}`;
const actor = `p303-user-${process.pid}`;

describe('board persistence on real PostgreSQL', () => {
  let admin: DataSource;
  let database: DataSource;

  beforeAll(async () => {
    const url = process.env.DATABASE_DIRECT_URL;
    if (!url) throw new Error('DATABASE_DIRECT_URL is required for board integration tests.');
    admin = new DataSource({ type: 'postgres', url, entities: [], synchronize: false });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    database = new DataSource({
      type: 'postgres',
      url,
      schema,
      entities: [...DATABASE_ENTITIES],
      migrations: [InitialDatabaseFoundation1789300000000],
      synchronize: false,
      migrationsRun: false,
      extra: { max: 6, options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.runMigrations({ transaction: 'all' });
    await database.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt")
       VALUES ($1, 'P303', $2, false, CURRENT_TIMESTAMP)`,
      [actor, `${actor}@example.test`],
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) await database.destroy();
    if (admin?.isInitialized) {
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.destroy();
      }
    }
  });

  async function createBoard(title: string) {
    return new BoardTransaction(database).run(async (runner) => {
      const board = await new BoardRepository(runner).create(actor, title, '');
      await new CommittedGraphRepository(runner).createInitialSnapshot(
        board.id,
        createEmptyBoardSnapshot(),
      );
      return board;
    });
  }

  it('creates a decodable, validated schema-1 snapshot with exact bytes and bigint strings', async () => {
    const board = await createBoard('Initial graph');
    const graph = await new BoardTransaction(database).run((runner) =>
      new CommittedGraphRepository(runner).load(board.id),
    );
    expect(board.latestSeq).toBe('0');
    expect(graph?.snapshot.schemaVersion).toBe(1);
    expect(graph?.snapshot.throughSeq).toBe('0');
    expect(graph?.snapshot.byteLength).toBe(graph?.snapshot.updateBytes.byteLength);
    expect(graph?.updates).toEqual([]);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, graph!.snapshot.updateBytes);
    validateGraphDocument(decoded);
    expect(Y.encodeStateAsUpdate(createGraphDocument()).byteLength).toBeGreaterThan(0);
  });

  it('canonicalizes object key order and replays identical independent callers with one effect', async () => {
    expect(canonicalRequestHash({ b: 2, a: { z: true, x: 1 } })).toEqual(
      canonicalRequestHash({ a: { x: 1, z: true }, b: 2 }),
    );
    const service = new IdempotencyService(database);
    const key = randomUUID();
    let effects = 0;
    const effect = async (runner: QueryRunner) => {
      effects += 1;
      await runner.query('SELECT pg_sleep(0.1)');
      const board = await new BoardRepository(runner).create(actor, 'Race', '');
      await new CommittedGraphRepository(runner).createInitialSnapshot(
        board.id,
        createEmptyBoardSnapshot(),
      );
      return { status: 201, body: { id: board.id, latestSeq: board.latestSeq } };
    };
    const [first, second] = await Promise.all([
      service.execute(actor, 'board.create', key, { title: 'Race' }, effect),
      service.execute(actor, 'board.create', key, { title: 'Race' }, effect),
    ]);
    expect(effects).toBe(1);
    expect(first.body).toEqual(second.body);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.body.latestSeq).toBe('0');
  });

  it('serializes different-payload same-key callers into one effect and one conflict', async () => {
    const service = new IdempotencyService(database);
    const key = randomUUID();
    let effects = 0;
    const invoke = (title: string) =>
      service.execute(actor, 'board.create', key, { title }, async (runner) => {
        effects += 1;
        await runner.query('SELECT pg_sleep(0.1)');
        const board = await new BoardRepository(runner).create(actor, title, '');
        return { status: 201, body: { id: board.id } };
      });
    const outcomes = await Promise.allSettled([invoke('A'), invoke('B')]);
    expect(effects).toBe(1);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(IdempotencyConflictError) });
  });

  it('rolls the effect and idempotency row back together after an injected failure', async () => {
    const key = randomUUID();
    const service = new IdempotencyService(database);
    await expect(
      service.execute(actor, 'board.create', key, { title: 'Rollback' }, async (runner) => {
        const board = await new BoardRepository(runner).create(actor, 'Rollback', '');
        await new CommittedGraphRepository(runner).createInitialSnapshot(
          board.id,
          createEmptyBoardSnapshot(),
        );
        throw new Error('injected before receipt');
      }),
    ).rejects.toThrow('injected before receipt');
    const boards = (await database.query('SELECT id FROM boards WHERE title = $1', [
      'Rollback',
    ])) as unknown[];
    const receipts = (await database.query('SELECT key FROM api_idempotency WHERE key = $1', [
      key,
    ])) as unknown[];
    expect(boards).toHaveLength(0);
    expect(receipts).toHaveLength(0);
  });

  it('rolls back a completed effect when storing its response fails', async () => {
    const key = randomUUID();
    await expect(
      new IdempotencyService(database).execute(
        actor,
        'board.create',
        key,
        { title: 'Receipt failure' },
        async (runner) => {
          await new BoardRepository(runner).create(actor, 'Receipt failure', '');
          return { status: 700, body: { ok: true } };
        },
      ),
    ).rejects.toThrow();
    expect(
      (await database.query('SELECT id FROM boards WHERE title = $1', [
        'Receipt failure',
      ])) as unknown[],
    ).toHaveLength(0);
  });

  it('stores only the replay-safe response and permits reuse after database expiry', async () => {
    const key = randomUUID();
    const service = new IdempotencyService(database);
    const effect = async () => ({
      status: 201,
      body: { id: 'a', oneTimeUrl: 'synthetic-secret' },
      replaySafeBody: { id: 'a' },
    });
    expect(
      (await service.execute(actor, 'invite.create', key, { role: 'viewer' }, effect)).body,
    ).toHaveProperty('oneTimeUrl');
    expect(
      (await service.execute(actor, 'invite.create', key, { role: 'viewer' }, effect)).body,
    ).toEqual({ id: 'a' });
    const rows = (await database.query(
      'SELECT response_json FROM api_idempotency WHERE actor_user_id = $1 AND operation = $2 AND key = $3',
      [actor, 'invite.create', key],
    )) as { response_json: unknown }[];
    expect(rows[0]!.response_json).toEqual({ id: 'a' });
    await database.query(
      `UPDATE api_idempotency SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE actor_user_id = $1 AND operation = $2 AND key = $3`,
      [actor, 'invite.create', key],
    );
    expect(
      (
        await service.execute(actor, 'invite.create', key, { role: 'editor' }, async () => ({
          status: 201,
          body: { id: 'b' },
        }))
      ).body,
    ).toEqual({ id: 'b' });
  });

  it('locks the user before active-owned count so concurrent creation cannot exceed 100', async () => {
    await database.query(
      `INSERT INTO boards (owner_user_id, title)
       SELECT $1, 'limit fixture' FROM generate_series(1, $2)`,
      [
        actor,
        MAX_ACTIVE_OWNED_BOARDS -
          Number(
            (
              (await database.query(
                'SELECT count(*)::integer AS count FROM boards WHERE owner_user_id = $1 AND archived_at IS NULL',
                [actor],
              )) as { count: number }[]
            )[0]!.count,
          ) -
          1,
      ],
    );
    const transaction = new BoardTransaction(database);
    const create = () =>
      transaction.run(async (runner) => {
        const count = await transaction.lockUserAndCountActiveOwnedBoards(runner, actor);
        if (count >= MAX_ACTIVE_OWNED_BOARDS) return false;
        await runner.query('SELECT pg_sleep(0.1)');
        await new BoardRepository(runner).create(actor, 'limit winner', '');
        return true;
      });
    expect((await Promise.all([create(), create()])).sort()).toEqual([false, true]);
    const rows = (await database.query(
      'SELECT count(*)::integer AS count FROM boards WHERE owner_user_id = $1 AND archived_at IS NULL',
      [actor],
    )) as { count: number }[];
    expect(rows[0]!.count).toBe(MAX_ACTIVE_OWNED_BOARDS);
  });

  it('lists owned and joined boards once in stable order and locks typed authority state', async () => {
    await database.query(
      `UPDATE boards SET archived_at = CURRENT_TIMESTAMP WHERE id =
       (SELECT id FROM boards WHERE owner_user_id = $1 AND title = 'limit fixture' LIMIT 1)`,
      [actor],
    );
    const other = `p303-other-${process.pid}`;
    await database.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt")
       VALUES ($1, 'Other', $2, false, CURRENT_TIMESTAMP)`,
      [other, `${other}@example.test`],
    );
    const joined = await new BoardTransaction(database).run(async (runner) =>
      new BoardRepository(runner).create(other, 'joined board', ''),
    );
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [joined.id, actor, 'editor'],
    );
    const owned = (
      (await database.query('SELECT id FROM boards WHERE owner_user_id = $1 ORDER BY id LIMIT 1', [
        actor,
      ])) as { id: string }[]
    )[0]!;
    const equalTimestamp = new Date('2026-01-01T00:00:00.000Z');
    await database.query('UPDATE boards SET content_updated_at = $1 WHERE id = ANY($2::uuid[])', [
      equalTimestamp,
      [joined.id, owned.id],
    ]);
    const result = await new BoardTransaction(database).run(async (runner) => {
      const repository = new BoardRepository(runner);
      const listed = await repository.listAccessible(actor, false, MAX_ACTIVE_OWNED_BOARDS);
      const locked = await new BoardTransaction(database).lockBoard(runner, joined.id, actor);
      return { listed, locked };
    });
    expect(result.listed.filter((board) => board.id === joined.id)).toHaveLength(1);
    expect(result.locked).toMatchObject({
      id: joined.id,
      ownerUserId: other,
      memberRole: 'editor',
      latestSeq: '0',
    });
    const sorted = [...result.listed].sort(
      (left, right) =>
        right.contentUpdatedAt.getTime() - left.contentUpdatedAt.getTime() ||
        right.id.localeCompare(left.id),
    );
    expect(result.listed.map((board) => board.id)).toEqual(sorted.map((board) => board.id));
    const nextPage = await new BoardTransaction(database).run(async (runner) =>
      new BoardRepository(runner).listAccessible(actor, false, PAGE_SIZE, {
        contentUpdatedAt: result.listed[PAGE_SIZE - 1]!.contentUpdatedAtCursor,
        id: result.listed[PAGE_SIZE - 1]!.id,
      }),
    );
    expect(nextPage[0]!.id).toBe(result.listed[PAGE_SIZE]!.id);
  });

  it('has no pending upgrade, uses synchronize:false, and supports rollback then fresh reapply', async () => {
    expect(database.options.synchronize).toBe(false);
    expect(await database.showMigrations()).toBe(false);
    await database.undoLastMigration({ transaction: 'all' });
    expect(await database.showMigrations()).toBe(true);
    await database.runMigrations({ transaction: 'all' });
    expect(await database.showMigrations()).toBe(false);
  });
});
