import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';

const SCHEMA_SUFFIX_LENGTH = 8;
const TEST_TIMEOUT_MS = 90_000;
const OWNED_ACTIVE_ROWS = 100;
const OWNED_ARCHIVED_ROWS = 100;
const JOINED_ACTIVE_ROWS = 200;
const JOINED_ARCHIVED_ROWS = 100;
const UNRELATED_ACTIVE_ROWS = 200;
const MEMBER_ROWS = 20;
const INVITE_ROWS = 200;
const OTHER_INVITE_ROWS = 1_000;
const IDEMPOTENCY_ROWS = 3_000;
const PAGE_SIZE = 30;
const PLAN_DECIMAL_PLACES = 3;
const schema = `archboard_p312_plans_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, SCHEMA_SUFFIX_LENGTH)}`;
const actor = `p312-actor-${process.pid}`;
const other = `p312-other-${process.pid}`;

jest.setTimeout(TEST_TIMEOUT_MS);

interface PlanNode {
  readonly 'Node Type': string;
  readonly 'Index Name'?: string;
  readonly 'Actual Rows': number;
  readonly 'Shared Hit Blocks'?: number;
  readonly Plans?: readonly PlanNode[];
}

interface PlanResult {
  readonly Plan: PlanNode;
  readonly 'Execution Time': number;
}

function summarize(plan: PlanNode): string[] {
  return [
    `${plan['Node Type']}${plan['Index Name'] ? `(${plan['Index Name']})` : ''}`,
    ...(plan.Plans?.flatMap(summarize) ?? []),
  ];
}

describe('Phase 3 representative PostgreSQL query plans', () => {
  let admin: DataSource;
  let database: DataSource;

  beforeAll(async () => {
    const url = process.env.DATABASE_DIRECT_URL;
    if (!url) throw new Error('DATABASE_DIRECT_URL is required for query-plan evidence.');
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
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.runMigrations({ transaction: 'all' });
    for (const id of [actor, other]) {
      await database.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt")
         VALUES ($1, 'Synthetic plan user', $2, false, CURRENT_TIMESTAMP)`,
        [id, `${id}@example.test`],
      );
    }
    await database.query(
      `INSERT INTO boards (owner_user_id, title, content_updated_at)
       SELECT $1, 'owned-active-' || n, CURRENT_TIMESTAMP - make_interval(mins => n)
       FROM generate_series(1, $2) AS n`,
      [actor, OWNED_ACTIVE_ROWS],
    );
    await database.query(
      `INSERT INTO boards (owner_user_id, title, archived_at, content_updated_at)
       SELECT $1, 'owned-archived-' || n, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP - make_interval(mins => n)
       FROM generate_series(1, $2) AS n`,
      [actor, OWNED_ARCHIVED_ROWS],
    );
    for (const [prefix, count, archived] of [
      ['joined-active-', JOINED_ACTIVE_ROWS, false],
      ['joined-archived-', JOINED_ARCHIVED_ROWS, true],
      ['unrelated-active-', UNRELATED_ACTIVE_ROWS, false],
    ] as const) {
      await database.query(
        `INSERT INTO boards (owner_user_id, title, archived_at, content_updated_at)
         SELECT $1, $2 || n, CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
           CURRENT_TIMESTAMP - make_interval(mins => n)
         FROM generate_series(1, $4) AS n`,
        [other, prefix, archived, count],
      );
    }
    await database.query(
      `INSERT INTO board_members (board_id, user_id, role)
       SELECT id, $1, 'editor' FROM boards
       WHERE title LIKE 'joined-%'`,
      [actor],
    );
    const boardId = (
      (await database.query("SELECT id FROM boards WHERE title = 'owned-active-1'")) as {
        id: string;
      }[]
    )[0]!.id;
    await database.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt")
       SELECT 'p312-member-' || n, 'Synthetic member',
         'p312-member-' || n || '@example.test', false, CURRENT_TIMESTAMP
       FROM generate_series(1, $1) AS n`,
      [MEMBER_ROWS],
    );
    await database.query(
      `INSERT INTO board_members (board_id, user_id, role)
       SELECT $1, id, 'viewer' FROM "user" WHERE id LIKE 'p312-member-%'`,
      [boardId],
    );
    await database.query(
      `INSERT INTO board_invites
        (board_id, token_hash, role, created_by, expires_at, created_at)
       SELECT $1, decode(lpad(to_hex(n), 64, '0'), 'hex'), 'viewer', $2,
         CURRENT_TIMESTAMP + INTERVAL '7 days', CURRENT_TIMESTAMP - make_interval(mins => n)
       FROM generate_series(1, $3) AS n`,
      [boardId, actor, INVITE_ROWS],
    );
    const otherBoardId = (
      (await database.query("SELECT id FROM boards WHERE title = 'unrelated-active-1'")) as {
        id: string;
      }[]
    )[0]!.id;
    await database.query(
      `INSERT INTO board_invites
        (board_id, token_hash, role, created_by, expires_at, created_at)
       SELECT $1, decode(lpad(to_hex(n + $3), 64, '0'), 'hex'), 'viewer', $2,
         CURRENT_TIMESTAMP + INTERVAL '7 days', CURRENT_TIMESTAMP - make_interval(mins => n)
       FROM generate_series(1, $4) AS n`,
      [otherBoardId, other, INVITE_ROWS, OTHER_INVITE_ROWS],
    );
    await database.query(
      `INSERT INTO api_idempotency
        (actor_user_id, operation, key, request_hash, response_status, response_json, expires_at)
       SELECT $1, 'board.create', gen_random_uuid(),
         decode(lpad(to_hex(n), 64, '0'), 'hex'), 201, '{}'::jsonb,
         CURRENT_TIMESTAMP + INTERVAL '1 day'
       FROM generate_series(1, $2) AS n`,
      [actor, IDEMPOTENCY_ROWS],
    );
    await database.query('ANALYZE boards');
    await database.query('ANALYZE board_members');
    await database.query('ANALYZE board_invites');
    await database.query('ANALYZE api_idempotency');
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

  async function explain(label: string, sql: string, parameters: unknown[]) {
    const rows = (await database.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
      parameters,
    )) as { 'QUERY PLAN': PlanResult[] }[];
    const result = rows[0]?.['QUERY PLAN'][0];
    if (!result) throw new Error(`${label} did not return an execution plan.`);
    process.stdout.write(
      `P3-12 plan ${label}: ${result['Execution Time'].toFixed(PLAN_DECIMAL_PLACES)} ms; ` +
        `${result.Plan['Actual Rows']} top-level rows; ` +
        `${result.Plan['Shared Hit Blocks'] ?? 0} top-level shared hits; ` +
        `${summarize(result.Plan).join(' > ')}\n`,
    );
    return result;
  }

  it('measures accessible-board, member, invite, and idempotency paths on mixed rows', async () => {
    const counts = (await database.query(
      `SELECT
        (SELECT count(*)::integer FROM boards) AS boards,
        (SELECT count(*)::integer FROM board_members) AS memberships,
        (SELECT count(*)::integer FROM board_invites) AS invites,
        (SELECT count(*)::integer FROM api_idempotency) AS idempotency`,
    )) as { boards: number; memberships: number; invites: number; idempotency: number }[];
    expect(counts[0]).toEqual({
      boards:
        OWNED_ACTIVE_ROWS +
        OWNED_ARCHIVED_ROWS +
        JOINED_ACTIVE_ROWS +
        JOINED_ARCHIVED_ROWS +
        UNRELATED_ACTIVE_ROWS,
      memberships: JOINED_ACTIVE_ROWS + JOINED_ARCHIVED_ROWS + MEMBER_ROWS,
      invites: INVITE_ROWS + OTHER_INVITE_ROWS,
      idempotency: IDEMPOTENCY_ROWS,
    });
    const active = await explain(
      'accessible active page',
      `SELECT board.id FROM boards board
       WHERE (board.owner_user_id = $1 OR EXISTS (
         SELECT 1 FROM board_members member
         WHERE member.board_id = board.id AND member.user_id = $1))
       AND board.archived_at IS NULL
       ORDER BY board.content_updated_at DESC, board.id DESC LIMIT $2`,
      [actor, PAGE_SIZE],
    );
    expect(active.Plan['Actual Rows']).toBe(PAGE_SIZE);
    const cursor = (
      (await database.query(
        `SELECT content_updated_at, id FROM boards WHERE owner_user_id = $1
         AND archived_at IS NULL ORDER BY content_updated_at DESC, id DESC
         OFFSET $2 LIMIT 1`,
        [actor, PAGE_SIZE],
      )) as { content_updated_at: Date; id: string }[]
    )[0]!;
    const nextPage = await explain(
      'accessible cursor page',
      `SELECT board.id FROM boards board
       WHERE (board.owner_user_id = $1 OR EXISTS (
         SELECT 1 FROM board_members member
         WHERE member.board_id = board.id AND member.user_id = $1))
       AND board.archived_at IS NULL
       AND (board.content_updated_at, board.id) < ($3::timestamptz, $4::uuid)
       ORDER BY board.content_updated_at DESC, board.id DESC LIMIT $2`,
      [actor, PAGE_SIZE, cursor.content_updated_at, cursor.id],
    );
    expect(nextPage.Plan['Actual Rows']).toBe(PAGE_SIZE);
    const archived = await explain(
      'accessible archived page',
      `SELECT board.id FROM boards board
       WHERE (board.owner_user_id = $1 OR EXISTS (
         SELECT 1 FROM board_members member
         WHERE member.board_id = board.id AND member.user_id = $1))
       AND board.archived_at IS NOT NULL
       ORDER BY board.content_updated_at DESC, board.id DESC LIMIT $2`,
      [actor, PAGE_SIZE],
    );
    expect(archived.Plan['Actual Rows']).toBe(PAGE_SIZE);
    const target = (
      (await database.query("SELECT id FROM boards WHERE title = 'owned-active-1'")) as {
        id: string;
      }[]
    )[0]!.id;
    await explain(
      'member list',
      `SELECT member.id FROM (
         SELECT owner.id, board.created_at AS joined_at, 0 AS sort_rank
         FROM boards board JOIN "user" owner ON owner.id = board.owner_user_id
         WHERE board.id = $1
         UNION ALL
         SELECT person.id, membership.created_at AS joined_at, 1 AS sort_rank
         FROM board_members membership
         JOIN boards board ON board.id = membership.board_id
         JOIN "user" person ON person.id = membership.user_id
         WHERE membership.board_id = $1 AND membership.user_id <> board.owner_user_id
       ) member ORDER BY member.sort_rank, member.joined_at, member.id`,
      [target],
    );
    await explain(
      'invite list',
      `SELECT id FROM board_invites WHERE board_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [target, PAGE_SIZE],
    );
    const key = (
      (await database.query('SELECT key FROM api_idempotency WHERE actor_user_id = $1 LIMIT 1', [
        actor,
      ])) as { key: string }[]
    )[0]!.key;
    const lookup = await explain(
      'idempotency key',
      `SELECT response_json FROM api_idempotency
       WHERE actor_user_id = $1 AND operation = 'board.create' AND key = $2`,
      [actor, key],
    );
    expect(lookup.Plan['Actual Rows']).toBe(1);
  });
});
