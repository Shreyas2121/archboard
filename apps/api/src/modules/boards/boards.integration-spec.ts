import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  ERROR_CODES,
  MAX_ACTIVE_OWNED_BOARDS,
  GRAPH_SCHEMA_VERSION,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardMemberResponseSchema,
  boardMembersResponseSchema,
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
import { configureCollaborationWebSockets } from '../collaboration/infrastructure/websocket/index.js';
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
const HTTP_NO_CONTENT = 204;
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
const LOCK_POLL_ATTEMPTS = 50;
const LOCK_POLL_INTERVAL_MS = 50;
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

async function waitForBoardLock(database: DataSource): Promise<void> {
  for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt += 1) {
    const rows = (await database.query(
      `SELECT count(*)::integer AS count FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
       AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`,
    )) as { count: number }[];
    if (rows[0]?.count) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }
  throw new Error('The competing board transaction did not reach a PostgreSQL lock wait.');
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
    configureCollaborationWebSockets(application);
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

  it('imports privately with fresh IDs, exact replay and payload conflict', async () => {
    const file = {
      format: 'archboard',
      formatVersion: 1,
      exportedAt: '2026-10-02T00:00:00.000Z',
      syncStatusAtExport: 'local-only',
      board: { title: 'Portable source', description: 'Preserved metadata' },
      graph: allEntityGraphFixture,
    };
    const key = randomUUID();
    const body = { title: 'Imported graph', file };
    expect((await request('/boards/import', undefined, { method: 'POST', key, body })).status).toBe(
      HTTP_UNAUTHORIZED,
    );
    const invalidKey = randomUUID();
    const malformed = await request('/boards/import', 'viewer', {
      method: 'POST',
      key: invalidKey,
      body: {
        ...body,
        file: {
          ...file,
          graph: { ...file.graph, edges: [{ ...file.graph.edges[0]!, targetId: randomUUID() }] },
        },
      },
    });
    expect(malformed.status).toBe(HTTP_BAD_REQUEST);
    expect(
      (await database.query('SELECT key FROM api_idempotency WHERE key = $1', [
        invalidKey,
      ])) as unknown[],
    ).toHaveLength(0);
    const first = await request('/boards/import', 'viewer', { method: 'POST', key, body });
    expect(first.status).toBe(HTTP_CREATED);
    const imported = boardDetailResponseSchema.parse(await first.json()).data;
    expect(imported).toMatchObject({
      title: body.title,
      description: file.board.description,
      effectiveRole: 'owner',
      latestSeq: '0',
    });
    expect(imported.owner.id).toBe(users.get('viewer')!.id);
    const replay = await request('/boards/import', 'viewer', { method: 'POST', key, body });
    expect(replay.status).toBe(HTTP_CREATED);
    expect(boardDetailResponseSchema.parse(await replay.json()).data).toEqual(imported);
    expect(
      (
        await request('/boards/import', 'viewer', {
          method: 'POST',
          key,
          body: { ...body, title: 'Changed' },
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    expect((await request(`/boards/${imported.id}`, 'owner')).status).toBe(HTTP_NOT_FOUND);
    const snapshots = (await database.query(
      'SELECT update_bytes FROM board_snapshots WHERE board_id = $1',
      [imported.id],
    )) as { update_bytes: Buffer }[];
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, snapshots[0]!.update_bytes);
    validateGraphDocument(decoded);
    const projection = projectGraphDocument(decoded);
    const sourceIds = new Set(
      [...file.graph.nodes, ...file.graph.edges, ...file.graph.boundaries, ...file.graph.steps].map(
        ({ id }) => id,
      ),
    );
    expect(
      [
        ...projection.nodes,
        ...projection.edges,
        ...projection.boundaries,
        ...projection.steps,
      ].some(({ id }) => sourceIds.has(id)),
    ).toBe(false);
    for (const table of ['board_members', 'board_updates', 'checkpoints', 'comment_threads'])
      expect(
        (await database.query(`SELECT board_id FROM ${table} WHERE board_id = $1`, [
          imported.id,
        ])) as unknown[],
      ).toHaveLength(0);
    decoded.destroy();
  });

  it('rolls back import board, snapshot and receipt on a persistence failure', async () => {
    await database.query(
      'ALTER TABLE board_snapshots ADD CONSTRAINT deny_p706_snapshot CHECK (false) NOT VALID',
    );
    const key = randomUUID();
    try {
      const file = {
        format: 'archboard',
        formatVersion: 1,
        exportedAt: '2026-10-02T00:00:00.000Z',
        syncStatusAtExport: 'local-only',
        board: { title: 'Source', description: '' },
        graph: allEntityGraphFixture,
      };
      const response = await request('/boards/import', 'editor', {
        method: 'POST',
        key,
        body: { title: 'Import rollback', file },
      });
      expect(response.status).toBe(HTTP_UNAVAILABLE);
      expect(
        (await database.query('SELECT id FROM boards WHERE title = $1', [
          'Import rollback',
        ])) as unknown[],
      ).toHaveLength(0);
      expect(
        (await database.query('SELECT key FROM api_idempotency WHERE key = $1', [
          key,
        ])) as unknown[],
      ).toHaveLength(0);
    } finally {
      await database.query('ALTER TABLE board_snapshots DROP CONSTRAINT deny_p706_snapshot');
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
    // Successful retry must remain the original effect after source advancement.
    await database.query('UPDATE boards SET latest_seq = latest_seq + 1 WHERE id = $1', [
      source.id,
    ]);
    const advancedReplay = await request(path, 'viewer', {
      method: 'POST',
      key,
      body: { title: 'Private copy' },
    });
    expect(boardDetailResponseSchema.parse(await advancedReplay.json()).data).toEqual(copy);
    await database.query('UPDATE boards SET latest_seq = latest_seq - 1 WHERE id = $1', [
      source.id,
    ]);
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
    await database.query('DELETE FROM board_members WHERE board_id = $1 AND user_id = $2', [
      source.id,
      users.get('viewer')!.id,
    ]);
    expect(
      (await request(path, 'viewer', { method: 'POST', key, body: { title: 'Private copy' } }))
        .status,
    ).toBe(HTTP_NOT_FOUND);
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [source.id, users.get('viewer')!.id, 'viewer'],
    );
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

  it('rejects viewer, nonmember, and cross-board graph proposals through real sessions without changing state', async () => {
    const board = await create('owner', 'A11 graph authority');
    const other = await create('owner', 'A11 other board');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [board.id, users.get('viewer')!.id, 'viewer'],
    );
    const actor = application.get<RequestActor>(AUTH_REQUEST_ACTOR);
    const accepted = createGraphDocument();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
    const vector = Y.encodeStateVector(replica);
    createNode(replica, { ...allEntityGraphFixture.nodes[0]!, id: randomUUID() });
    const updateBytes = Y.encodeStateAsUpdate(replica, vector);
    const harness = new PostgresDurableUpdateHarness(
      board.id,
      accepted,
      database,
      { authenticate: async (cookie) => ({ userId: (await actor.require({ cookie })).user.id }) },
      new BoardPermissionService(new PostgresBoardAuthorityReader(database)),
    );
    const before = harness.acceptedStateAsUpdate();
    for (const [user, boardId, code] of [
      ['viewer', board.id, ERROR_CODES.FORBIDDEN],
      ['outsider', board.id, ERROR_CODES.NOT_FOUND],
      ['owner', other.id, ERROR_CODES.FORBIDDEN],
      ['owner', randomUUID(), ERROR_CODES.FORBIDDEN],
    ] as const) {
      await expect(
        harness.accept({
          boardId,
          updateId: randomUUID(),
          sessionToken: users.get(user)!.cookie,
          updateBytes,
        }),
      ).rejects.toMatchObject({ code });
      expect(harness.acceptedStateAsUpdate()).toEqual(before);
    }
    const rows = (await database.query(
      `SELECT
       (SELECT latest_seq::text FROM boards WHERE id = $1) AS sequence,
       (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
       (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts`,
      [board.id],
    )) as { sequence: string; updates: number; receipts: number }[];
    expect(rows[0]).toEqual({ sequence: '0', updates: 0, receipts: 0 });
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
    try {
      await waitForBoardLock(database);
    } finally {
      release();
    }
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

  it('blocks a graph transaction behind an uncommitted archive and rejects it after commit', async () => {
    const board = await create('owner', 'A27 blocked graph');
    const actor = application.get<RequestActor>(AUTH_REQUEST_ACTOR);
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
    );
    const archiveRunner = database.createQueryRunner();
    await archiveRunner.connect();
    await archiveRunner.startTransaction();
    try {
      await archiveRunner.query('SELECT id FROM boards WHERE id = $1 FOR UPDATE', [board.id]);
      await archiveRunner.query(
        `UPDATE boards SET archived_at = CURRENT_TIMESTAMP,
         metadata_version = metadata_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [board.id],
      );
      const attempted = harness.accept({
        boardId: board.id,
        updateId: randomUUID(),
        sessionToken: users.get('owner')!.cookie,
        updateBytes: Y.encodeStateAsUpdate(replica, vector),
      });
      await waitForBoardLock(database);
      await archiveRunner.commitTransaction();
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
    } finally {
      if (archiveRunner.isTransactionActive) await archiveRunner.rollbackTransaction();
      await archiveRunner.release();
    }
  });

  it('lists safe owner/member summaries and enforces the member role matrix', async () => {
    const board = await create('owner', 'Member authority');
    const other = await create('owner', 'Other member board');
    const editorId = users.get('editor')!.id;
    const viewerId = users.get('viewer')!.id;
    await database.query(
      `INSERT INTO board_members (board_id, user_id, role)
       VALUES ($1, $2, 'editor'), ($1, $3, 'viewer'), ($4, $3, 'editor')`,
      [board.id, editorId, viewerId, other.id],
    );
    const membersPath = `/boards/${board.id}/members`;
    const listedResponse = await request(membersPath, 'viewer');
    expect(listedResponse.status).toBe(HTTP_OK);
    const listed = boardMembersResponseSchema.parse(await listedResponse.json());
    expect(listed.nextCursor).toBeNull();
    expect(listed.data[0]).toMatchObject({
      user: { id: users.get('owner')!.id },
      role: 'owner',
    });
    expect(new Map(listed.data.map((member) => [member.user.id, member.role]))).toEqual(
      new Map([
        [users.get('owner')!.id, 'owner'],
        [editorId, 'editor'],
        [viewerId, 'viewer'],
      ]),
    );
    expect(JSON.stringify(listed)).not.toContain('email');
    expect(JSON.stringify(listed)).not.toContain('provider');
    const ownerMembership = (await database.query(
      'SELECT count(*)::integer AS count FROM board_members WHERE board_id = $1 AND user_id = $2',
      [board.id, users.get('owner')!.id],
    )) as { count: number }[];
    expect(ownerMembership[0]?.count).toBe(0);
    expect((await request(membersPath, 'outsider')).status).toBe(HTTP_NOT_FOUND);
    expect((await request(membersPath)).status).toBe(HTTP_UNAUTHORIZED);

    const rolePath = `${membersPath}/${viewerId}`;
    const denied = await request(rolePath, 'editor', {
      method: 'PATCH',
      body: { role: 'editor' },
    });
    expect(denied.status).toBe(HTTP_FORBIDDEN);
    expect(
      (
        await request(rolePath, 'outsider', {
          method: 'PATCH',
          body: { role: 'editor' },
        })
      ).status,
    ).toBe(HTTP_NOT_FOUND);
    expect(
      (
        await request(`${membersPath}/${users.get('owner')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HTTP_FORBIDDEN);
    expect(
      (
        await request(`${membersPath}/${users.get('outsider')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HTTP_NOT_FOUND);
    expect(
      (
        await request(`${membersPath}/${viewerId}`, 'owner', {
          method: 'PATCH',
          body: { role: 'owner' },
        })
      ).status,
    ).toBe(HTTP_BAD_REQUEST);
    const changed = await request(rolePath, 'owner', {
      method: 'PATCH',
      body: { role: 'editor' },
    });
    expect(changed.status).toBe(HTTP_OK);
    const member = boardMemberResponseSchema.parse(await changed.json()).data;
    expect(member.role).toBe('editor');
    expect(member.joinedAt).toBe(listed.data.find((entry) => entry.user.id === viewerId)!.joinedAt);
    const counts = (await database.query(
      'SELECT count(*)::integer AS count FROM board_members WHERE board_id = $1 AND user_id = $2',
      [board.id, viewerId],
    )) as { count: number }[];
    expect(counts[0]!.count).toBe(1);
    expect(
      (
        await request(`${membersPath}/${users.get('owner')!.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_FORBIDDEN);
    expect(
      (
        await request(`${membersPath}/${viewerId}`, 'editor', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_FORBIDDEN);
    expect(
      (
        await request(`${membersPath}/${viewerId}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_NO_CONTENT);
    expect(
      (
        await request(`${membersPath}/${viewerId}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_NO_CONTENT);
    expect((await request(membersPath, 'viewer')).status).toBe(HTTP_NOT_FOUND);
    expect(
      (
        await request(`${membersPath}/${viewerId}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HTTP_NOT_FOUND);
    expect(
      (
        await request(`${membersPath}/${editorId}`, 'editor', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_NO_CONTENT);
    expect((await request(membersPath, 'editor')).status).toBe(HTTP_NOT_FOUND);
    expect(
      (
        await request(`/boards/${other.id}/members/${viewerId}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HTTP_OK);
  });

  it('hides cross-board member targets and blocks changes while archived', async () => {
    const board = await create('owner', 'Scoped members');
    const another = await create('owner', 'Other scoped members');
    const viewerId = users.get('viewer')!.id;
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [another.id, viewerId, 'viewer'],
    );
    const path = `/boards/${board.id}/members/${viewerId}`;
    expect(
      (
        await request(path, 'owner', {
          method: 'PATCH',
          body: { role: 'editor' },
        })
      ).status,
    ).toBe(HTTP_NOT_FOUND);
    expect((await request(path, 'owner', { method: 'DELETE' })).status).toBe(HTTP_NO_CONTENT);
    const untouched = (await database.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [another.id, viewerId],
    )) as { role: string }[];
    expect(untouched[0]?.role).toBe('viewer');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [board.id, users.get('editor')!.id, 'editor'],
    );
    expect(
      (
        await request(`/boards/${board.id}/archive`, 'owner', {
          method: 'POST',
          body: { expectedVersion: board.metadataVersion },
        })
      ).status,
    ).toBe(HTTP_OK);
    expect((await request(`/boards/${board.id}/members`, 'editor')).status).toBe(HTTP_OK);
    expect(
      (
        await request(`/boards/${board.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    expect(
      (
        await request(`/boards/${board.id}/members/${users.get('editor')!.id}`, 'editor', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
  });

  it('orders member removal and role change against durable graph writes', async () => {
    const actor = application.get<RequestActor>(AUTH_REQUEST_ACTOR);
    const permissions = new BoardPermissionService(new PostgresBoardAuthorityReader(database));
    const editorId = users.get('editor')!.id;
    const cookie = users.get('editor')!.cookie;
    const proposalFor = (boardId: string, accepted: Y.Doc) => {
      const replica = new Y.Doc();
      Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
      const vector = Y.encodeStateVector(replica);
      createNode(replica, { ...allEntityGraphFixture.nodes[0]!, id: randomUUID() });
      return {
        boardId,
        updateId: randomUUID(),
        sessionToken: cookie,
        updateBytes: Y.encodeStateAsUpdate(replica, vector),
      };
    };
    const authenticator = {
      authenticate: async (sessionCookie: string) => ({
        userId: (await actor.require({ cookie: sessionCookie })).user.id,
      }),
    };

    const removedBoard = await create('owner', 'Removal ordering');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [removedBoard.id, editorId, 'editor'],
    );
    const removeFailpoints = new DurableUpdateFailpointController();
    let validated!: () => void;
    let resumeRemoved!: () => void;
    const validationReached = new Promise<void>((resolve) => {
      validated = resolve;
    });
    const removedBarrier = new Promise<void>((resolve) => {
      resumeRemoved = resolve;
    });
    removeFailpoints.arm(
      DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION,
      async () => {
        validated();
        await removedBarrier;
      },
    );
    const removedAccepted = createGraphDocument();
    const removedHarness = new PostgresDurableUpdateHarness(
      removedBoard.id,
      removedAccepted,
      database,
      authenticator,
      permissions,
      removeFailpoints,
    );
    const removedWrite = removedHarness.accept(proposalFor(removedBoard.id, removedAccepted));
    await validationReached;
    expect(
      (
        await request(`/boards/${removedBoard.id}/members/${editorId}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_NO_CONTENT);
    resumeRemoved();
    await expect(removedWrite).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    const removedRows = (await database.query(
      'SELECT latest_seq::text AS sequence FROM boards WHERE id = $1',
      [removedBoard.id],
    )) as { sequence: string }[];
    expect(removedRows[0]?.sequence).toBe('0');

    const demotedBoard = await create('owner', 'Role ordering');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [demotedBoard.id, editorId, 'editor'],
    );
    const roleFailpoints = new DurableUpdateFailpointController();
    let atCommit!: () => void;
    let resumeCommit!: () => void;
    const commitReached = new Promise<void>((resolve) => {
      atCommit = resolve;
    });
    const commitBarrier = new Promise<void>((resolve) => {
      resumeCommit = resolve;
    });
    roleFailpoints.arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT, async () => {
      atCommit();
      await commitBarrier;
    });
    const demotedAccepted = createGraphDocument();
    const demotedHarness = new PostgresDurableUpdateHarness(
      demotedBoard.id,
      demotedAccepted,
      database,
      authenticator,
      permissions,
      roleFailpoints,
    );
    const acceptedWrite = demotedHarness.accept(proposalFor(demotedBoard.id, demotedAccepted));
    await commitReached;
    const roleChange = request(`/boards/${demotedBoard.id}/members/${editorId}`, 'owner', {
      method: 'PATCH',
      body: { role: 'viewer' },
    });
    resumeCommit();
    expect((await acceptedWrite).receipt.sequence).toBe('1');
    expect((await roleChange).status).toBe(HTTP_OK);
    await expect(
      demotedHarness.accept(proposalFor(demotedBoard.id, demotedAccepted)),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    const demotedRows = (await database.query(
      'SELECT latest_seq::text AS sequence FROM boards WHERE id = $1',
      [demotedBoard.id],
    )) as { sequence: string }[];
    expect(demotedRows[0]?.sequence).toBe('1');
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
      request('/boards/import', 'owner', {
        method: 'POST',
        key: randomUUID(),
        body: {
          title: 'limit B',
          file: {
            format: 'archboard',
            formatVersion: 1,
            exportedAt: '2026-10-02T00:00:00.000Z',
            syncStatusAtExport: 'local-only',
            board: { title: 'Source', description: '' },
            graph: allEntityGraphFixture,
          },
        },
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
