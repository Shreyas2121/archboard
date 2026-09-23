import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  ERROR_CODES,
  MAX_ACTIVE_OWNED_BOARDS,
  GRAPH_SCHEMA_VERSION,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardListResponseSchema,
  currentUserResponseSchema,
} from '@archboard/contracts';
import {
  createNode,
  createGraphDocument,
  hydrateGraphDocument,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import { allEntityGraphFixture } from '@archboard/fixtures';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import * as Y from 'yjs';

import { AppModule } from '../../app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { loadApiConfig } from '../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';
import { BetterAuthRuntime, configureAuthHttp } from '../auth/index.js';
import { AUTH_REQUEST_ACTOR, type RequestActor } from '../auth/application/index.js';
import {
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
} from '../collaboration/application/index.js';
import { PostgresDurableUpdateHarness } from '../collaboration/infrastructure/persistence/postgres-durable-update-harness.js';
import { BoardPermissionService } from './application/permissions/index.js';
import { PostgresBoardAuthorityReader } from './infrastructure/postgres-board-authority-reader.js';

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

  it('archives and restores with locked owner authority, stale versions, and repeat no-ops', async () => {
    const board = await create('owner', 'Lifecycle source');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [board.id, users.get('viewer')!.id, 'viewer'],
    );
    const path = `/boards/${board.id}`;
    const body = { expectedVersion: board.metadataVersion };
    expect((await request(`${path}/archive`, 'viewer', { method: 'POST', body })).status).toBe(
      HTTP_FORBIDDEN,
    );
    expect((await request(`${path}/archive`, 'outsider', { method: 'POST', body })).status).toBe(
      HTTP_NOT_FOUND,
    );
    const archivedResponse = await request(`${path}/archive`, 'owner', { method: 'POST', body });
    expect(archivedResponse.status).toBe(HTTP_OK);
    const archived = boardDetailResponseSchema.parse(await archivedResponse.json()).data;
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.metadataVersion).toBe(board.metadataVersion + 1);
    expect((await request(`${path}/archive`, 'owner', { method: 'POST', body })).status).toBe(
      HTTP_CONFLICT,
    );
    const repeat = boardDetailResponseSchema.parse(
      await (
        await request(`${path}/archive`, 'owner', {
          method: 'POST',
          body: { expectedVersion: archived.metadataVersion },
        })
      ).json(),
    ).data;
    expect(repeat).toEqual(archived);
    const restored = boardDetailResponseSchema.parse(
      await (
        await request(`${path}/restore`, 'owner', {
          method: 'POST',
          body: { expectedVersion: archived.metadataVersion },
        })
      ).json(),
    ).data;
    expect(restored.archivedAt).toBeNull();
    expect(restored.metadataVersion).toBe(archived.metadataVersion + 1);
    const rows = (await database.query(
      'SELECT count(*)::integer AS count FROM board_members WHERE board_id = $1',
      [board.id],
    )) as { count: number }[];
    expect(rows[0]?.count).toBe(1);
  });

  it('duplicates committed content with fresh references and no source access or history', async () => {
    const source = await create('owner', 'Graph source');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [source.id, users.get('viewer')!.id, 'viewer'],
    );
    const document = hydrateGraphDocument(allEntityGraphFixture);
    validateGraphDocument(document);
    const bytes = Buffer.from(Y.encodeStateAsUpdate(document));
    await database.query(
      'UPDATE board_snapshots SET schema_version = $2, update_bytes = $3, byte_length = $4 WHERE board_id = $1',
      [source.id, GRAPH_SCHEMA_VERSION, bytes, bytes.byteLength],
    );
    const vector = Y.encodeStateVector(document);
    createNode(document, {
      ...allEntityGraphFixture.nodes[0]!,
      id: randomUUID(),
      title: 'Committed later',
    });
    const update = Buffer.from(Y.encodeStateAsUpdate(document, vector));
    await database.query(
      'INSERT INTO board_updates (board_id, seq, update_id, actor_user_id, update_bytes) VALUES ($1, 1, $2, $3, $4)',
      [source.id, randomUUID(), users.get('owner')!.id, update],
    );
    await database.query('UPDATE boards SET latest_seq = 1 WHERE id = $1', [source.id]);
    const key = randomUUID();
    const path = `/boards/${source.id}/duplicate`;
    const response = await request(path, 'viewer', {
      method: 'POST',
      key,
      body: { title: '  Private copy  ' },
    });
    expect(response.status).toBe(HTTP_CREATED);
    const copy = boardDetailResponseSchema.parse(await response.json()).data;
    expect(copy).toMatchObject({
      title: 'Private copy',
      effectiveRole: 'owner',
      latestSeq: '0',
      memberCount: 1,
    });
    expect(copy.owner.id).toBe(users.get('viewer')!.id);
    expect((await request(`/boards/${copy.id}`, 'owner')).status).toBe(HTTP_NOT_FOUND);
    const sourceProjection = projectGraphDocument(document);
    const snapshots = (await database.query(
      'SELECT update_bytes FROM board_snapshots WHERE board_id = $1',
      [copy.id],
    )) as { update_bytes: Buffer }[];
    const duplicated = new Y.Doc();
    Y.applyUpdate(duplicated, snapshots[0]!.update_bytes);
    validateGraphDocument(duplicated);
    const projection = projectGraphDocument(duplicated);
    expect(projection.nodes.map((node) => node.title).sort()).toEqual(
      sourceProjection.nodes.map((node) => node.title).sort(),
    );
    expect(
      projection.nodes.every(
        (node) => !sourceProjection.nodes.some((original) => original.id === node.id),
      ),
    ).toBe(true);
    expect(
      projection.edges.every(
        (edge) =>
          projection.nodes.some((node) => node.id === edge.sourceId) &&
          projection.nodes.some((node) => node.id === edge.targetId),
      ),
    ).toBe(true);
    const counts = (await database.query(
      `SELECT
      (SELECT count(*)::integer FROM board_members WHERE board_id = $1) AS members,
      (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
      (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts`,
      [copy.id],
    )) as { members: number; updates: number; receipts: number }[];
    expect(counts[0]).toEqual({ members: 0, updates: 0, receipts: 0 });
    const replay = await request(path, 'viewer', {
      method: 'POST',
      key,
      body: { title: 'Private copy' },
    });
    expect(boardDetailResponseSchema.parse(await replay.json()).data).toEqual(copy);
    const conflict = await request(path, 'viewer', {
      method: 'POST',
      key,
      body: { title: 'Different copy' },
    });
    expect(conflict.status).toBe(HTTP_CONFLICT);
    expect(apiErrorEnvelopeSchema.parse(await conflict.json()).error.code).toBe(
      ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );
    const archived = await request(`/boards/${source.id}/archive`, 'owner', {
      method: 'POST',
      body: { expectedVersion: source.metadataVersion },
    });
    expect(archived.status).toBe(HTTP_OK);
    const archivedCopy = await request(path, 'viewer', {
      method: 'POST',
      key: randomUUID(),
      body: { title: 'Archived copy' },
    });
    expect(archivedCopy.status).toBe(HTTP_CREATED);
    await database.query('UPDATE board_snapshots SET schema_version = $2 WHERE board_id = $1', [
      source.id,
      GRAPH_SCHEMA_VERSION + 1,
    ]);
    const invalid = await request(path, 'viewer', {
      method: 'POST',
      key: randomUUID(),
      body: { title: 'Invalid source copy' },
    });
    expect(invalid.status).toBe(HTTP_BAD_REQUEST);
    expect(
      (await database.query('SELECT id FROM boards WHERE title = $1', [
        'Invalid source copy',
      ])) as unknown[],
    ).toHaveLength(0);
  });

  it('serializes a committed graph update before archive through the same board lock', async () => {
    const board = await create('owner', 'A27 ordering');
    const actor = application.get<RequestActor>(AUTH_REQUEST_ACTOR);
    const failpoints = new DurableUpdateFailpointController();
    let reached!: () => void;
    let release!: () => void;
    const atCommit = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    failpoints.arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT, async () => {
      reached();
      await barrier;
    });
    const accepted = createGraphDocument();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
    const vector = Y.encodeStateVector(replica);
    createNode(replica, { ...allEntityGraphFixture.nodes[0]!, id: randomUUID() });
    const harness = new PostgresDurableUpdateHarness(
      board.id,
      accepted,
      database,
      { authenticate: async (cookie) => ({ userId: (await actor.require({ cookie })).user.id }) },
      new BoardPermissionService(new PostgresBoardAuthorityReader(database)),
      failpoints,
    );
    const updateId = randomUUID();
    const acceptedWrite = harness.accept({
      boardId: board.id,
      updateId,
      sessionToken: users.get('owner')!.cookie,
      updateBytes: Y.encodeStateAsUpdate(replica, vector),
    });
    await atCommit;
    const archive = request(`/boards/${board.id}/archive`, 'owner', {
      method: 'POST',
      body: { expectedVersion: board.metadataVersion },
    });
    release();
    expect((await acceptedWrite).receipt.sequence).toBe('1');
    expect((await archive).status).toBe(HTTP_OK);
    const rejected = harness.accept({
      boardId: board.id,
      updateId: randomUUID(),
      sessionToken: users.get('owner')!.cookie,
      updateBytes: Y.encodeStateAsUpdate(replica, vector),
    });
    await expect(rejected).rejects.toMatchObject({ code: ERROR_CODES.BOARD_ARCHIVED });
    const rows = (await database.query(
      `SELECT
      (SELECT latest_seq::text FROM boards WHERE id = $1) AS sequence,
      (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
      (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts`,
      [board.id],
    )) as { sequence: string; updates: number; receipts: number }[];
    expect(rows[0]).toEqual({ sequence: '1', updates: 1, receipts: 1 });
  });

  it('rejects a validated graph update after archive commits without changing durable state', async () => {
    const board = await create('owner', 'A27 archived first');
    const actor = application.get<RequestActor>(AUTH_REQUEST_ACTOR);
    const failpoints = new DurableUpdateFailpointController();
    let reached!: () => void;
    let release!: () => void;
    const validated = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    failpoints.arm(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION, async () => {
      reached();
      await barrier;
    });
    const accepted = createGraphDocument();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
    const vector = Y.encodeStateVector(replica);
    createNode(replica, { ...allEntityGraphFixture.nodes[0]!, id: randomUUID() });
    const harness = new PostgresDurableUpdateHarness(
      board.id,
      accepted,
      database,
      { authenticate: async (cookie) => ({ userId: (await actor.require({ cookie })).user.id }) },
      new BoardPermissionService(new PostgresBoardAuthorityReader(database)),
      failpoints,
    );
    const attempted = harness.accept({
      boardId: board.id,
      updateId: randomUUID(),
      sessionToken: users.get('owner')!.cookie,
      updateBytes: Y.encodeStateAsUpdate(replica, vector),
    });
    await validated;
    const archived = await request(`/boards/${board.id}/archive`, 'owner', {
      method: 'POST',
      body: { expectedVersion: board.metadataVersion },
    });
    expect(archived.status).toBe(HTTP_OK);
    release();
    await expect(attempted).rejects.toMatchObject({ code: ERROR_CODES.BOARD_ARCHIVED });
    const rows = (await database.query(
      `SELECT
      (SELECT latest_seq::text FROM boards WHERE id = $1) AS sequence,
      (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
      (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts`,
      [board.id],
    )) as { sequence: string; updates: number; receipts: number }[];
    expect(rows[0]).toEqual({ sequence: '0', updates: 0, receipts: 0 });
    expect(harness.acceptedStateAsUpdate()).toEqual(Y.encodeStateAsUpdate(accepted));
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
