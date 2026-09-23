import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  ERROR_CODES,
  MAX_ACTIVE_OWNED_BOARDS,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardListResponseSchema,
  currentUserResponseSchema,
} from '@archboard/contracts';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';

import { AppModule } from '../../app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { loadApiConfig } from '../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';
import { BetterAuthRuntime, configureAuthHttp } from '../auth/index.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'p305-test-password-32-characters';
const TEST_TIMEOUT_MS = 90_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_RATE_LIMITED = 429;
const HTTP_UNAVAILABLE = 503;
const PAGE_SIZE = 2;
const SCHEMA_SUFFIX_LENGTH = 8;
const EXPECTED_MEMBER_COUNT = 3;
const SCHEMA = `archboard_p305_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, SCHEMA_SUFFIX_LENGTH)}`;

jest.setTimeout(TEST_TIMEOUT_MS);

function scopedUrl(directUrl: string): string {
  const url = new URL(directUrl);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return url.toString();
}

function cookies(response: Response): string {
  const all = response.headers.getSetCookie();
  expect(all.some((value) => value.includes('HttpOnly'))).toBe(true);
  return all.map((value) => value.split(';', 1)[0]).join('; ');
}

describe('boards HTTP with real Better Auth cookies and PostgreSQL', () => {
  let admin: Pool;
  let database: DataSource;
  let application: NestExpressApplication;
  let apiOrigin: string;
  const users = new Map<string, { id: string; cookie: string }>();

  async function request(
    path: string,
    user?: string,
    options?: { method?: string; body?: unknown; key?: string },
  ) {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (user) headers.cookie = users.get(user)!.cookie;
    if (options?.body !== undefined) headers['content-type'] = 'application/json';
    if (options?.key) headers['idempotency-key'] = options.key;
    return fetch(`${apiOrigin}/api/v1${path}`, {
      method: options?.method ?? 'GET',
      headers,
      ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  async function create(user: string, title: string, key = randomUUID()) {
    const response = await request('/boards', user, { method: 'POST', key, body: { title } });
    expect(response.status).toBe(HTTP_CREATED);
    return boardDetailResponseSchema.parse(await response.json()).data;
  }

  beforeAll(async () => {
    const directUrl = process.env.DATABASE_DIRECT_URL;
    if (!directUrl)
      throw new Error('DATABASE_DIRECT_URL is required for board HTTP integration tests.');
    admin = new Pool({ connectionString: directUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    const url = scopedUrl(directUrl);
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
    const config = loadApiConfig({
      NODE_ENV: 'test',
      PUBLIC_API_ORIGIN: 'http://localhost:3000',
      ALLOWED_WEB_ORIGINS: ORIGIN,
      PORT: '3000',
      DATABASE_URL: url,
      DATABASE_DIRECT_URL: url,
      BETTER_AUTH_SECRET: 'p305-auth-integration-secret-32chars',
      GITHUB_CLIENT_ID: 'Ov23liExampleClientId1234567890',
      GITHUB_CLIENT_SECRET: '0123456789abcdef0123456789abcdef01234567',
    });
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.listen(0, '127.0.0.1');
    apiOrigin = `http://127.0.0.1:${(application.getHttpServer().address() as AddressInfo).port}`;
    for (const name of ['owner', 'editor', 'viewer', 'outsider']) {
      const signup = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          email: `p305-${name}-${randomUUID()}@example.test`,
          password: PASSWORD,
        }),
      });
      expect(signup.status).toBe(HTTP_OK);
      const cookie = cookies(signup);
      const me = await fetch(`${apiOrigin}/api/v1/me`, { headers: { origin: ORIGIN, cookie } });
      users.set(name, { id: currentUserResponseSchema.parse(await me.json()).data.id, cookie });
    }
  });

  afterAll(async () => {
    try {
      await application?.close();
      if (database?.isInitialized) await database.destroy();
    } finally {
      if (admin) {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  });

  it('requires a cookie and strict request data, then atomically creates and replays a private board', async () => {
    expect(
      (
        await request('/boards', undefined, {
          method: 'POST',
          key: randomUUID(),
          body: { title: 'No actor' },
        })
      ).status,
    ).toBe(HTTP_UNAUTHORIZED);
    const malformed = await request('/boards', 'owner', {
      method: 'POST',
      key: randomUUID(),
      body: { title: 'Bad', ownerUserId: users.get('outsider')!.id },
    });
    expect(malformed.status).toBe(HTTP_BAD_REQUEST);
    expect(apiErrorEnvelopeSchema.parse(await malformed.json()).error.code).toBe(
      ERROR_CODES.VALIDATION_ERROR,
    );
    const key = randomUUID();
    const first = await request('/boards', 'owner', {
      method: 'POST',
      key,
      body: { title: '  Blank architecture  ', description: '' },
    });
    expect(first.status).toBe(HTTP_CREATED);
    const board = boardDetailResponseSchema.parse(await first.json()).data;
    expect(board).toMatchObject({
      title: 'Blank architecture',
      effectiveRole: 'owner',
      metadataVersion: 1,
      latestSeq: '0',
      memberCount: 1,
      owner: { id: users.get('owner')!.id, name: 'owner', image: null },
    });
    const snapshot = (await database.query(
      'SELECT schema_version, through_seq::text, byte_length, octet_length(update_bytes)::integer AS actual FROM board_snapshots WHERE board_id = $1',
      [board.id],
    )) as { schema_version: number; through_seq: string; byte_length: number; actual: number }[];
    expect(snapshot[0]).toMatchObject({
      schema_version: 1,
      through_seq: '0',
      byte_length: snapshot[0]!.actual,
    });
    const replay = await request('/boards', 'owner', {
      method: 'POST',
      key,
      body: { description: '', title: 'Blank architecture' },
    });
    expect(replay.status).toBe(HTTP_CREATED);
    expect(boardDetailResponseSchema.parse(await replay.json()).data).toEqual(board);
    const conflict = await request('/boards', 'owner', {
      method: 'POST',
      key,
      body: { title: 'Changed' },
    });
    expect(conflict.status).toBe(HTTP_CONFLICT);
    expect(apiErrorEnvelopeSchema.parse(await conflict.json()).error.code).toBe(
      ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );
  });

  it('rolls back board and idempotency writes if snapshot persistence fails', async () => {
    await database.query(
      'ALTER TABLE board_snapshots ADD CONSTRAINT deny_p305_snapshot CHECK (false) NOT VALID',
    );
    const key = randomUUID();
    try {
      const response = await request('/boards', 'owner', {
        method: 'POST',
        key,
        body: { title: 'Rollback board' },
      });
      expect(response.status).toBe(HTTP_UNAVAILABLE);
      const error = apiErrorEnvelopeSchema.parse(await response.json());
      expect(error.error.code).toBe(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      expect(JSON.stringify(error)).not.toContain('SQL');
      expect(
        (await database.query('SELECT id FROM boards WHERE title = $1', [
          'Rollback board',
        ])) as unknown[],
      ).toHaveLength(0);
      expect(
        (await database.query('SELECT key FROM api_idempotency WHERE key = $1', [
          key,
        ])) as unknown[],
      ).toHaveLength(0);
    } finally {
      await database.query('ALTER TABLE board_snapshots DROP CONSTRAINT deny_p305_snapshot');
    }
  });

  it('lists owned and joined boards with search, archive filter, stable cursor, and no outsider leakage', async () => {
    const joined = await create('editor', 'Joined architecture');
    const ownedA = await create('owner', 'Search Alpha');
    const ownedB = await create('owner', 'Search Beta');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [joined.id, users.get('owner')!.id, 'viewer'],
    );
    await database.query('UPDATE boards SET content_updated_at = $1 WHERE id = ANY($2::uuid[])', [
      new Date('2030-01-01T00:00:00.000Z'),
      [joined.id, ownedA.id, ownedB.id],
    ]);
    const first = await request(`/boards?limit=${PAGE_SIZE}`, 'owner');
    expect(first.status).toBe(HTTP_OK);
    const page1 = boardListResponseSchema.parse(await first.json());
    expect(page1.data).toHaveLength(PAGE_SIZE);
    expect(page1.nextCursor).toBeTruthy();
    const second = await request(`/boards?limit=${PAGE_SIZE}&cursor=${page1.nextCursor}`, 'owner');
    const page2 = boardListResponseSchema.parse(await second.json());
    expect(
      page2.data.some((board) => page1.data.some((previous) => previous.id === board.id)),
    ).toBe(false);
    const search = await request('/boards?search=%20search%20', 'owner');
    const searched = boardListResponseSchema.parse(await search.json());
    expect(searched.data.map((board) => board.title).sort()).toEqual([
      'Search Alpha',
      'Search Beta',
    ]);
    const joinedSearch = boardListResponseSchema.parse(
      await (await request('/boards?search=joined', 'owner')).json(),
    );
    expect(joinedSearch.data).toHaveLength(1);
    expect(joinedSearch.data[0]).toMatchObject({ id: joined.id, effectiveRole: 'viewer' });
    await database.query('UPDATE boards SET archived_at = CURRENT_TIMESTAMP WHERE id = $1', [
      ownedB.id,
    ]);
    const archived = boardListResponseSchema.parse(
      await (await request('/boards?archived=true', 'owner')).json(),
    );
    expect(archived.data.map((board) => board.id)).toContain(ownedB.id);
    const archivedPatch = await request(`/boards/${ownedB.id}`, 'owner', {
      method: 'PATCH',
      body: { title: 'Cannot edit archived', expectedVersion: ownedB.metadataVersion },
    });
    expect(archivedPatch.status).toBe(HTTP_CONFLICT);
    expect(apiErrorEnvelopeSchema.parse(await archivedPatch.json()).error.code).toBe(
      ERROR_CODES.BOARD_ARCHIVED,
    );
    const outsider = boardListResponseSchema.parse(
      await (await request('/boards', 'outsider')).json(),
    );
    expect(outsider.data).toEqual([]);
    expect((await request(`/boards?cursor=${encodeURIComponent('%%%')}`, 'owner')).status).toBe(
      HTTP_BAD_REQUEST,
    );
    expect((await request('/boards?limit=101', 'owner')).status).toBe(HTTP_BAD_REQUEST);
  });

  it('enforces owner/editor/viewer/nonmember metadata permissions and version/no-op semantics', async () => {
    const board = await create('owner', 'Editable board');
    await database.query(
      `INSERT INTO board_members (board_id, user_id, role)
      VALUES ($1, $2, 'editor'), ($1, $3, 'viewer')`,
      [board.id, users.get('editor')!.id, users.get('viewer')!.id],
    );
    const detail = boardDetailResponseSchema.parse(
      await (await request(`/boards/${board.id}`, 'viewer')).json(),
    ).data;
    expect(detail.memberCount).toBe(EXPECTED_MEMBER_COUNT);
    expect(detail.effectiveRole).toBe('viewer');
    expect((await request(`/boards/${board.id}`, 'outsider')).status).toBe(HTTP_NOT_FOUND);
    const denied = await request(`/boards/${board.id}`, 'viewer', {
      method: 'PATCH',
      body: { title: 'Denied', expectedVersion: board.metadataVersion },
    });
    expect(denied.status).toBe(HTTP_FORBIDDEN);
    expect(apiErrorEnvelopeSchema.parse(await denied.json()).error.code).toBe(
      ERROR_CODES.FORBIDDEN,
    );
    expect(
      (
        await request(`/boards/${board.id}`, 'outsider', {
          method: 'PATCH',
          body: { title: 'Hidden', expectedVersion: board.metadataVersion },
        })
      ).status,
    ).toBe(HTTP_NOT_FOUND);
    const changed = await request(`/boards/${board.id}`, 'editor', {
      method: 'PATCH',
      body: { title: 'Renamed', expectedVersion: board.metadataVersion },
    });
    expect(changed.status).toBe(HTTP_OK);
    const updated = boardDetailResponseSchema.parse(await changed.json()).data;
    expect(updated).toMatchObject({
      title: 'Renamed',
      metadataVersion: board.metadataVersion + 1,
      latestSeq: '0',
    });
    const stale = await request(`/boards/${board.id}`, 'owner', {
      method: 'PATCH',
      body: { description: 'Too late', expectedVersion: board.metadataVersion },
    });
    expect(stale.status).toBe(HTTP_CONFLICT);
    expect(apiErrorEnvelopeSchema.parse(await stale.json()).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
    const noop = await request(`/boards/${board.id}`, 'owner', {
      method: 'PATCH',
      body: { title: 'Renamed', expectedVersion: updated.metadataVersion },
    });
    expect(boardDetailResponseSchema.parse(await noop.json()).data).toEqual({
      ...updated,
      effectiveRole: 'owner',
    });
    const final = boardDetailResponseSchema.parse(
      await (await request(`/boards/${board.id}`, 'owner')).json(),
    ).data;
    expect(final.latestSeq).toBe('0');
    expect(final.metadataVersion).toBe(updated.metadataVersion);
    expect(final.description).toBe('');
  });

  it('serializes two authenticated creates at the active-owned-board limit', async () => {
    const ownerId = users.get('owner')!.id;
    const rows = (await database.query(
      'SELECT count(*)::integer AS count FROM boards WHERE owner_user_id = $1 AND archived_at IS NULL',
      [ownerId],
    )) as { count: number }[];
    await database.query(
      `INSERT INTO boards (owner_user_id, title)
      SELECT $1, 'limit fixture' FROM generate_series(1, $2)`,
      [ownerId, MAX_ACTIVE_OWNED_BOARDS - rows[0]!.count - 1],
    );
    const outcomes = await Promise.all([
      request('/boards', 'owner', {
        method: 'POST',
        key: randomUUID(),
        body: { title: 'limit A' },
      }),
      request('/boards', 'owner', {
        method: 'POST',
        key: randomUUID(),
        body: { title: 'limit B' },
      }),
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([
      HTTP_CREATED,
      HTTP_RATE_LIMITED,
    ]);
    const count = (await database.query(
      'SELECT count(*)::integer AS count FROM boards WHERE owner_user_id = $1 AND archived_at IS NULL',
      [ownerId],
    )) as { count: number }[];
    expect(count[0]!.count).toBe(MAX_ACTIVE_OWNED_BOARDS);
  });
});
