import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  COMMENT_DELETION_MARKER,
  ERROR_CODES,
  MAX_COMMENTS_PER_THREAD,
  MAX_COMMENT_BODY_CHARACTERS,
  MAX_THREADS_PER_BOARD,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  commentListResponseSchema,
  commentResponseSchema,
  currentUserResponseSchema,
  threadCreateResponseSchema,
  threadListResponseSchema,
  threadResponseSchema,
  type ThreadAnchor,
  type ThreadCreateResult,
  serverMessageSchema,
  GRAPH_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  boardInviteResponseSchema,
  inviteAcceptanceResponseSchema,
} from '@archboard/contracts';
import {
  createNode,
  hydrateGraphDocument,
  moveNode,
  projectGraphDocument,
  setNodeTitle,
  tombstoneEdge,
  tombstoneNode,
} from '@archboard/document-model';
import { minimalGraphFixture } from '@archboard/fixtures';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpStatus } from '@nestjs/common';
import { Pool } from 'pg';
import { DataSource, type QueryRunner } from 'typeorm';
import * as Y from 'yjs';
import WebSocket, { type RawData } from 'ws';

import { AppModule } from '../../app.module.js';
import { CollaborationGateway } from '../collaboration/infrastructure/websocket/collaboration.gateway.js';
import { DiscussionRepository } from './infrastructure/discussion-repository.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { loadApiConfig } from '../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';
import { BetterAuthRuntime, configureAuthHttp } from '../auth/index.js';
import { configureCollaborationWebSockets } from '../collaboration/infrastructure/websocket/index.js';
import { CollaborationRoom } from '../collaboration/application/room-registry.js';
import { CollaborationUpdateService } from '../collaboration/application/collaboration-update-service.js';
import {
  CommittedAnchorReader,
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
} from '../collaboration/application/index.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'phase6-synthetic-integration-password';
const TIMEOUT_MS = 90_000;
const POOL_SIZE = 8;
const POLL_ATTEMPTS = 100;
const POLL_INTERVAL_MS = 50;
const PAGE_SIZE = 2;
const FIRST_AND_WINNING_MESSAGES = 2;
const SCHEMA_SUFFIX_LENGTH = 8;
const CHANGED_VERSION = 2;
const SECOND_CHANGED_VERSION = 3;
const FRACTIONAL_VERSION = 1.5;
const EXPECTED_COMMENTS_HINTS = 6;
const EXPECTED_EDGE_POSITION = { x: 320, y: 70 };
const PLAN_THREADS = 300;
const PLAN_MESSAGES = 500;
const PLAN_PAGE_SIZE = 30;
const SCHEMA = `archboard_p602_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, SCHEMA_SUFFIX_LENGTH)}`;
const point: ThreadAnchor = { type: 'point', position: { x: -25, y: 30 } };
const submittedBody = '  Synthetic message\nwith formatting  ';

interface BoardFixture {
  readonly id: string;
  readonly graph: typeof minimalGraphFixture;
  readonly state: Uint8Array;
}
interface Counts {
  threads: number;
  comments: number;
  keys: number;
}
interface ObservedQueryPlan {
  readonly 'Actual Rows': number;
  readonly 'Node Type': string;
  readonly 'Index Name'?: string;
  readonly Plans?: ObservedQueryPlan[];
}

function deferred() {
  let resolve = () => undefined as void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

jest.setTimeout(TIMEOUT_MS);

describe('P6-02/P6-03 discussion HTTP, real sessions and PostgreSQL transactions', () => {
  let admin: Pool;
  let database: DataSource;
  let application: NestExpressApplication;
  let apiOrigin: string;
  const users = new Map<string, { id: string; cookie: string }>();
  const rooms = new Map<string, CollaborationRoom>();
  const sockets = new Set<WebSocket>();

  async function request(
    path: string,
    actor = 'owner',
    options?: { method?: string; body?: unknown; key?: string },
  ) {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (actor) headers.cookie = users.get(actor)!.cookie;
    if (options?.body !== undefined) headers['content-type'] = 'application/json';
    if (options?.key) headers['idempotency-key'] = options.key;
    return fetch(`${apiOrigin}/api/v1${path}`, {
      method: options?.method ?? 'GET',
      headers,
      ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  async function board(): Promise<BoardFixture> {
    const response = await request('/boards', 'owner', {
      method: 'POST',
      body: { title: 'Synthetic discussion fixture' },
      key: randomUUID(),
    });
    expect(response.status).toBe(HttpStatus.CREATED);
    const result = boardDetailResponseSchema.parse(await response.json()).data;
    const nodes = minimalGraphFixture.nodes.map((node) => ({ ...node, id: randomUUID() }));
    const graph = {
      ...minimalGraphFixture,
      nodes,
      edges: [
        {
          ...minimalGraphFixture.edges[0]!,
          id: randomUUID(),
          sourceId: nodes[0]!.id,
          targetId: nodes[1]!.id,
        },
      ],
    };
    const document = hydrateGraphDocument(graph);
    const bytes = Buffer.from(Y.encodeStateAsUpdate(document));
    try {
      await database.query(
        'UPDATE board_snapshots SET update_bytes = $2, byte_length = $3 WHERE board_id = $1',
        [result.id, bytes, bytes.byteLength],
      );
    } finally {
      document.destroy();
    }
    await database.query(
      `INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,'editor'),($1,$3,'viewer')`,
      [result.id, users.get('editor')!.id, users.get('viewer')!.id],
    );
    return { id: result.id, graph, state: bytes };
  }

  function createRequest(
    boardId: string,
    anchor: ThreadAnchor = point,
    actor = 'owner',
    key = randomUUID(),
    body = submittedBody,
  ) {
    return request(`/boards/${boardId}/threads`, actor, {
      method: 'POST',
      body: { anchor, body },
      key,
    });
  }

  async function create(
    boardId: string,
    anchor: ThreadAnchor = point,
  ): Promise<ThreadCreateResult> {
    const response = await createRequest(boardId, anchor);
    expect(response.status).toBe(HttpStatus.CREATED);
    return threadCreateResponseSchema.parse(await response.json()).data;
  }

  function reply(
    boardId: string,
    threadId: string,
    actor = 'owner',
    key = randomUUID(),
    body = submittedBody,
  ) {
    return request(`/boards/${boardId}/threads/${threadId}/comments`, actor, {
      method: 'POST',
      body: { body },
      key,
    });
  }

  async function counts(boardId: string): Promise<Counts> {
    const rows = (await database.query(
      `SELECT
      (SELECT count(*)::integer FROM comment_threads WHERE board_id=$1) AS threads,
      (SELECT count(*)::integer FROM comments c JOIN comment_threads t ON t.id=c.thread_id WHERE t.board_id=$1) AS comments,
      (SELECT count(*)::integer FROM api_idempotency WHERE operation LIKE $2) AS keys`,
      [boardId, `%:${boardId}%`],
    )) as Counts[];
    return rows[0]!;
  }

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    const envelope = apiErrorEnvelopeSchema.parse(await response.json());
    expect(envelope.error.code).toBe(code);
    return envelope.error;
  }

  async function waitForBoardLock() {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const rows = (await database.query(
        `SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`,
        [SCHEMA],
      )) as { count: number }[];
      if (rows[0]?.count) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error('The competing transaction did not reach a PostgreSQL board-lock wait.');
  }

  async function lockedBoard(boardId: string): Promise<QueryRunner> {
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [boardId]);
    return runner;
  }

  async function graphEdit(fixture: BoardFixture, mutate: (document: Y.Doc) => void) {
    let room = rooms.get(fixture.id);
    if (!room) {
      const committed = new Y.Doc();
      Y.applyUpdate(committed, fixture.state);
      room = new CollaborationRoom(fixture.id, committed, '0', '0', Date.now);
      rooms.set(fixture.id, room);
    }
    const replica = new Y.Doc();
    try {
      Y.applyUpdate(replica, Y.encodeStateAsUpdate(room.document));
      const vector = Y.encodeStateVector(replica);
      mutate(replica);
      const updateBytes = Y.encodeStateAsUpdate(replica, vector);
      const activeRoom = room;
      return await activeRoom.run(() =>
        application.get(CollaborationUpdateService).accept(activeRoom, {
          actorUserId: users.get('owner')!.id,
          updateId: randomUUID(),
          updateBytes,
        }),
      );
    } finally {
      replica.destroy();
    }
  }

  beforeAll(async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const directUrl = process.env.DATABASE_DIRECT_URL;
    if (!directUrl) throw new Error('DATABASE_DIRECT_URL is required for P6-02 integration.');
    admin = new Pool({ connectionString: directUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    const scoped = new URL(directUrl);
    scoped.searchParams.set('options', `-c search_path=${SCHEMA} -c application_name=${SCHEMA}`);
    const url = scoped.toString();
    database = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: [...DATABASE_ENTITIES],
      migrations: [
        InitialDatabaseFoundation1789300000000,
        RetainCompactedUpdateReceipts1790426800000,
      ],
      synchronize: false,
      migrationsRun: false,
      extra: { max: POOL_SIZE, options: `-c search_path=${SCHEMA} -c application_name=${SCHEMA}` },
    });
    await database.initialize();
    await database.runMigrations({ transaction: 'all' });
    const version = (await database.query('SHOW server_version')) as { server_version: string }[];
    const indexes = (await database.query(
      'SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename IN ($2,$3) ORDER BY indexname',
      [SCHEMA, 'comment_threads', 'comments'],
    )) as { indexname: string }[];
    expect(indexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining([
        'IDX_comment_threads_board_created_id',
        'IDX_comments_thread_created_id',
      ]),
    );
    console.log(
      JSON.stringify({
        phase: 'P6-02/P6-03/P6-04',
        postgresVersion: version[0]?.server_version,
        migrations: 2,
        discussionIndexes: indexes.length,
      }),
    );
    const config = loadApiConfig({
      NODE_ENV: 'test',
      PUBLIC_API_ORIGIN: 'http://localhost:3000',
      ALLOWED_WEB_ORIGINS: ORIGIN,
      PORT: '3000',
      DATABASE_URL: url,
      DATABASE_DIRECT_URL: url,
      BETTER_AUTH_SECRET: 'phase6-auth-integration-secret-32chars',
    });
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureCollaborationWebSockets(application);
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.listen(0, '127.0.0.1');
    apiOrigin = `http://127.0.0.1:${(application.getHttpServer().address() as AddressInfo).port}`;
    for (const name of ['owner', 'editor', 'viewer', 'outsider', 'expiring', 'moderator']) {
      const signup = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          email: `p602-${name}-${randomUUID()}@example.test`,
          password: PASSWORD,
        }),
      });
      expect(signup.status).toBe(HttpStatus.OK);
      const cookie = signup.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ');
      const me = await fetch(`${apiOrigin}/api/v1/me`, { headers: { origin: ORIGIN, cookie } });
      users.set(name, { id: currentUserResponseSchema.parse(await me.json()).data.id, cookie });
    }
  });

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    for (const room of rooms.values()) room.destroy();
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
    jest.restoreAllMocks();
  });

  it('requires real sessions and rejects forged/blank/invalid wire data before any write', async () => {
    const fixture = await board();
    await expectError(
      await createRequest(fixture.id, point, ''),
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.UNAUTHENTICATED,
    );
    for (const body of [
      { anchor: point, body: ' ', authorUserId: users.get('owner')!.id },
      { anchor: point, body: ' ' },
      { anchor: { type: 'point', position: { x: 100001, y: 0 } }, body: submittedBody },
    ]) {
      await expectError(
        await request(`/boards/${fixture.id}/threads`, 'owner', {
          method: 'POST',
          body,
          key: randomUUID(),
        }),
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    await expectError(
      await request(`/boards/${fixture.id}/threads`, 'owner', {
        method: 'POST',
        body: { anchor: point, body: submittedBody },
      }),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
  });

  it('creates point discussion atomically, preserves formatting, and leaves graph bytes/sequence untouched', async () => {
    const fixture = await board();
    const before = await database.query(
      'SELECT b.latest_seq::text, b.content_updated_at, s.update_bytes FROM boards b JOIN board_snapshots s ON s.board_id=b.id WHERE b.id=$1',
      [fixture.id],
    );
    const result = await create(fixture.id);
    expect(result.thread.anchor).toEqual(point);
    expect(result.thread.createdBy.id).toBe(users.get('owner')!.id);
    expect(result.comment.author.id).toBe(users.get('owner')!.id);
    expect(result.comment.body).toBe(submittedBody);
    expect(result.comment.version).toBe(1);
    expect(result.thread.messageCount).toBe(1);
    expect(result.thread.latestMessage.id).toBe(result.comment.id);
    expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
    expect(
      await database.query(
        'SELECT b.latest_seq::text, b.content_updated_at, s.update_bytes FROM boards b JOIN board_snapshots s ON s.board_id=b.id WHERE b.id=$1',
        [fixture.id],
      ),
    ).toEqual(before);
    const graphRows = await database.query(
      'SELECT (SELECT count(*)::integer FROM board_updates WHERE board_id=$1) AS updates, (SELECT count(*)::integer FROM update_receipts WHERE board_id=$1) AS receipts',
      [fixture.id],
    );
    expect(graphRows[0]).toEqual({ updates: 0, receipts: 0 });
  });

  it('uses the shared Unicode body limit and rejects blank bodies for thread and reply creation', async () => {
    const fixture = await board();
    const body = '😀'.repeat(MAX_COMMENT_BODY_CHARACTERS);
    const response = await createRequest(fixture.id, point, 'owner', randomUUID(), body);
    expect(response.status).toBe(HttpStatus.CREATED);
    const first = threadCreateResponseSchema.parse(await response.json()).data;
    expect(first.comment.body).toBe(body);
    const replyResponse = await reply(fixture.id, first.thread.id, 'editor', randomUUID(), body);
    expect(replyResponse.status).toBe(HttpStatus.CREATED);
    expect(commentResponseSchema.parse(await replyResponse.json()).data.body).toBe(body);
    await expectError(
      await createRequest(fixture.id, point, 'owner', randomUUID(), body + 'a'),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    await expectError(
      await reply(fixture.id, first.thread.id, 'editor', randomUUID(), body + 'a'),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    await expectError(
      await reply(fixture.id, first.thread.id, 'editor', randomUUID(), ' \n\t'),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 2, keys: 2 });
  });

  it('captures node/edge fallback from accepted snapshot and update log, ignoring fabricated context', async () => {
    const fixture = await board();
    const node = fixture.graph.nodes[0]!;
    const nodeResult = await create(fixture.id, {
      type: 'node',
      id: node.id,
      label: 'Untrusted',
      position: { x: 99, y: 99 },
    });
    expect(nodeResult.thread.anchor).toEqual({
      type: 'node',
      id: node.id,
      label: node.title,
      position: node.position,
    });
    const edge = fixture.graph.edges[0]!;
    const edgeResult = await create(fixture.id, {
      type: 'edge',
      id: edge.id,
      label: 'Untrusted',
      position: { x: 99, y: 99 },
    });
    expect(edgeResult.thread.anchor).toEqual({
      type: 'edge',
      id: edge.id,
      label: edge.label,
      position: EXPECTED_EDGE_POSITION,
    });
    await graphEdit(fixture, (document) => {
      setNodeTitle(document, node.id, 'Accepted title');
      moveNode(document, node.id, { x: 20, y: 30 });
    });
    const accepted = await create(fixture.id, {
      type: 'node',
      id: node.id,
      label: 'Stale title',
      position: node.position,
    });
    expect(accepted.thread.anchor).toEqual({
      type: 'node',
      id: node.id,
      label: 'Accepted title',
      position: { x: 20, y: 30 },
    });
  });

  it('rejects local-only, cross-board, tombstoned nodes/edges and edges with deleted endpoints', async () => {
    const fixture = await board();
    const other = await board();
    const localOnlyId = randomUUID();
    const pendingDocument = hydrateGraphDocument(fixture.graph);
    try {
      createNode(pendingDocument, { ...fixture.graph.nodes[0]!, id: localOnlyId });
      expect(
        projectGraphDocument(pendingDocument).nodes.some((node) => node.id === localOnlyId),
      ).toBe(true);
    } finally {
      pendingDocument.destroy();
    }
    for (const id of [localOnlyId, other.graph.nodes[0]!.id]) {
      await expectError(
        await createRequest(fixture.id, { type: 'node', id, label: '', position: { x: 0, y: 0 } }),
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    await graphEdit(fixture, (document) => tombstoneEdge(document, fixture.graph.edges[0]!.id));
    await expectError(
      await createRequest(fixture.id, {
        type: 'edge',
        id: fixture.graph.edges[0]!.id,
        label: '',
        position: { x: 0, y: 0 },
      }),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    const deleted = await board();
    await graphEdit(deleted, (document) => tombstoneNode(document, deleted.graph.nodes[0]!.id));
    for (const anchor of [
      { type: 'node' as const, id: deleted.graph.nodes[0]!.id },
      { type: 'edge' as const, id: deleted.graph.edges[0]!.id },
    ]) {
      await expectError(
        await createRequest(deleted.id, { ...anchor, label: '', position: { x: 0, y: 0 } }),
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
    expect(await counts(deleted.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
  });

  it('deduplicates concurrent lost-response retries and scopes keys by actor, operation and target', async () => {
    const fixture = await board();
    const key = randomUUID();
    const responses = await Promise.all([
      createRequest(fixture.id, point, 'owner', key),
      createRequest(fixture.id, point, 'owner', key),
    ]);
    for (const response of responses) expect(response.status).toBe(HttpStatus.CREATED);
    const first = threadCreateResponseSchema.parse(await responses[0]!.json()).data;
    expect(threadCreateResponseSchema.parse(await responses[1]!.json()).data).toEqual(first);
    await expectError(
      await createRequest(fixture.id, point, 'owner', key, 'Changed'),
      HttpStatus.CONFLICT,
      ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );
    const changedAnchor = { type: 'point' as const, position: { x: 1, y: 2 } };
    await expectError(
      await createRequest(fixture.id, changedAnchor, 'owner', key),
      HttpStatus.CONFLICT,
      ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );
    expect((await createRequest(fixture.id, point, 'editor', key)).status).toBe(HttpStatus.CREATED);
    const replyKey = key;
    const replies = await Promise.all([
      reply(fixture.id, first.thread.id, 'editor', replyKey),
      reply(fixture.id, first.thread.id, 'editor', replyKey),
    ]);
    for (const response of replies) expect(response.status).toBe(HttpStatus.CREATED);
    const firstReply = commentResponseSchema.parse(await replies[0]!.json()).data;
    expect(commentResponseSchema.parse(await replies[1]!.json()).data).toEqual(firstReply);
    await expectError(
      await reply(fixture.id, first.thread.id, 'editor', replyKey, 'Changed'),
      HttpStatus.CONFLICT,
      ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );
    const secondThread = await create(fixture.id);
    expect((await reply(fixture.id, secondThread.thread.id, 'editor', replyKey)).status).toBe(
      HttpStatus.CREATED,
    );
    const other = await board();
    expect((await createRequest(other.id, point, 'owner', key)).status).toBe(HttpStatus.CREATED);
    expect(await counts(fixture.id)).toEqual({ threads: 3, comments: 5, keys: 5 });
    expect(await counts(other.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
  });

  it('stores 24-hour receipts transactionally and replaces explicitly retried expired keys', async () => {
    const fixture = await board();
    const key = randomUUID();
    const response = await createRequest(fixture.id, point, 'owner', key);
    const first = threadCreateResponseSchema.parse(await response.json()).data;
    const lifetime = await database.query(
      `SELECT expires_at > CURRENT_TIMESTAMP + INTERVAL '23 hours' AS live, expires_at <= CURRENT_TIMESTAMP + INTERVAL '24 hours' AS bounded FROM api_idempotency WHERE operation=$1 AND key=$2`,
      [`discussion.thread.create:${fixture.id}`, key],
    );
    expect(lifetime[0]).toEqual({ live: true, bounded: true });
    await database.query(
      `UPDATE api_idempotency SET expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE operation=$1 AND key=$2`,
      [`discussion.thread.create:${fixture.id}`, key],
    );
    const repeated = threadCreateResponseSchema.parse(
      await (await createRequest(fixture.id, point, 'owner', key)).json(),
    ).data;
    expect(repeated.thread.id).not.toBe(first.thread.id);
    expect(await counts(fixture.id)).toEqual({ threads: 2, comments: 2, keys: 1 });
  });

  it.each(['comments', 'api_idempotency'])(
    'rolls back the thread, first message and receipt when %s insertion fails',
    async (table) => {
      const fixture = await board();
      const key = randomUUID();
      await database.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT p602_deny_insert CHECK (false) NOT VALID`,
      );
      try {
        await expectError(
          await createRequest(fixture.id, point, 'owner', key),
          HttpStatus.SERVICE_UNAVAILABLE,
          ERROR_CODES.TEMPORARILY_UNAVAILABLE,
        );
        expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
      } finally {
        await database.query(`ALTER TABLE "${table}" DROP CONSTRAINT p602_deny_insert`);
      }
      expect((await createRequest(fixture.id, point, 'owner', key)).status).toBe(
        HttpStatus.CREATED,
      );
    },
  );

  it('rolls back reply creation when receipt storage fails', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    await database.query(
      'ALTER TABLE api_idempotency ADD CONSTRAINT p602_deny_reply CHECK (false) NOT VALID',
    );
    try {
      await expectError(
        await reply(fixture.id, first.thread.id),
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.TEMPORARILY_UNAVAILABLE,
      );
      expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
    } finally {
      await database.query('ALTER TABLE api_idempotency DROP CONSTRAINT p602_deny_reply');
    }
  });

  it('serializes two independent creates at the 2,000-thread cap and permits receipt replay at the cap', async () => {
    const fixture = await board();
    await database.query(
      `INSERT INTO comment_threads (board_id,anchor,created_by) SELECT $1,$2::jsonb,$3 FROM generate_series(1,$4)`,
      [fixture.id, JSON.stringify(point), users.get('owner')!.id, MAX_THREADS_PER_BOARD - 1],
    );
    await database.query(
      `INSERT INTO comments (thread_id,author_user_id,body,deleted_at) SELECT id,$2,$3,CURRENT_TIMESTAMP FROM comment_threads WHERE board_id=$1`,
      [fixture.id, users.get('owner')!.id, COMMENT_DELETION_MARKER],
    );
    const keys = [randomUUID(), randomUUID()];
    const responses = await Promise.all(
      keys.map((key) => createRequest(fixture.id, point, 'owner', key)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      HttpStatus.CREATED,
      HttpStatus.PAYLOAD_TOO_LARGE,
    ]);
    const winner = responses.findIndex((response) => response.status === HttpStatus.CREATED);
    expect((await createRequest(fixture.id, point, 'owner', keys[winner]!)).status).toBe(
      HttpStatus.CREATED,
    );
    expect(await counts(fixture.id)).toEqual({
      threads: MAX_THREADS_PER_BOARD,
      comments: MAX_THREADS_PER_BOARD,
      keys: 1,
    });
  });

  it('serializes two replies at the 500-message cap, including deleted marker rows', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    await database.query(
      `INSERT INTO comments (thread_id,author_user_id,body,deleted_at) SELECT $1,$2,$3,CURRENT_TIMESTAMP FROM generate_series(1,$4)`,
      [
        first.thread.id,
        users.get('owner')!.id,
        COMMENT_DELETION_MARKER,
        MAX_COMMENTS_PER_THREAD - FIRST_AND_WINNING_MESSAGES,
      ],
    );
    const keys = [randomUUID(), randomUUID()];
    const responses = await Promise.all(
      keys.map((key) => reply(fixture.id, first.thread.id, 'editor', key)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      HttpStatus.CREATED,
      HttpStatus.PAYLOAD_TOO_LARGE,
    ]);
    const winner = responses.findIndex((response) => response.status === HttpStatus.CREATED);
    expect((await reply(fixture.id, first.thread.id, 'editor', keys[winner]!)).status).toBe(
      HttpStatus.CREATED,
    );
    expect(await counts(fixture.id)).toEqual({
      threads: 1,
      comments: MAX_COMMENTS_PER_THREAD,
      keys: 2,
    });
  });

  it('enforces current viewer/archive/nonmember roles on writes, reads and idempotent replay', async () => {
    const fixture = await board();
    const key = randomUUID();
    const response = await createRequest(fixture.id, point, 'editor', key);
    const first = threadCreateResponseSchema.parse(await response.json()).data;
    const replyKey = randomUUID();
    expect((await reply(fixture.id, first.thread.id, 'editor', replyKey)).status).toBe(
      HttpStatus.CREATED,
    );
    for (const actor of ['owner', 'editor', 'viewer']) {
      expect((await request(`/boards/${fixture.id}/threads`, actor)).status).toBe(HttpStatus.OK);
      expect(
        (await request(`/boards/${fixture.id}/threads/${first.thread.id}/comments`, actor)).status,
      ).toBe(HttpStatus.OK);
    }
    await expectError(
      await createRequest(fixture.id, point, 'viewer'),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    await expectError(
      await reply(fixture.id, first.thread.id, 'viewer'),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    await expectError(
      await request(`/boards/${fixture.id}/threads`, 'outsider'),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    expect(
      (
        await request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    await expectError(
      await createRequest(fixture.id, point, 'editor', key),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    await expectError(
      await reply(fixture.id, first.thread.id, 'editor', replyKey),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    expect(
      (
        await request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HttpStatus.NO_CONTENT);
    await expectError(
      await createRequest(fixture.id, point, 'editor', key),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    await expectError(
      await request(`/boards/${fixture.id}/threads/${first.thread.id}/comments`, 'editor'),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    expect(
      (
        await request(`/boards/${fixture.id}/archive`, 'owner', {
          method: 'POST',
          body: { expectedVersion: 1 },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    await expectError(
      await createRequest(fixture.id),
      HttpStatus.CONFLICT,
      ERROR_CODES.BOARD_ARCHIVED,
    );
    await expectError(
      await reply(fixture.id, first.thread.id),
      HttpStatus.CONFLICT,
      ERROR_CODES.BOARD_ARCHIVED,
    );
    expect((await request(`/boards/${fixture.id}/threads`, 'viewer')).status).toBe(HttpStatus.OK);
    expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 2, keys: 2 });
  });

  it('scopes thread lookups through the path board for both reads and replies', async () => {
    const fixture = await board();
    const other = await board();
    const first = await create(other.id);
    await expectError(
      await request(`/boards/${fixture.id}/threads/${first.thread.id}/comments`),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    await expectError(
      await reply(fixture.id, first.thread.id),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    await expectError(
      await request(`/boards/${other.id}/threads/${first.thread.id}/comments`, 'outsider'),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
  });

  it('paginates by exact microseconds/UUID ties with filters, counts and safe latest-deletion markers', async () => {
    const fixture = await board();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const times = [
      '2026-09-01T10:00:00.123001Z',
      '2026-09-01T10:00:00.123002Z',
      '2026-09-01T10:00:00.123002Z',
      '2026-09-01T10:00:00.123003Z',
    ];
    await database.query(
      `INSERT INTO comment_threads (id,board_id,anchor,created_by,created_at) SELECT id,$3,$4::jsonb,$5,stamp FROM unnest($1::uuid[],$2::timestamptz[]) AS rows(id,stamp)`,
      [ids, times, fixture.id, JSON.stringify(point), users.get('owner')!.id],
    );
    await database.query(
      `INSERT INTO comments (thread_id,author_user_id,body,created_at) SELECT id,$2,$3,created_at FROM comment_threads WHERE board_id=$1`,
      [fixture.id, users.get('owner')!.id, submittedBody],
    );
    const sorted = [ids[3]!, ...[ids[1]!, ids[2]!].sort().reverse(), ids[0]!];
    const firstPage = threadListResponseSchema.parse(
      await (await request(`/boards/${fixture.id}/threads?limit=${PAGE_SIZE}`)).json(),
    );
    const secondPage = threadListResponseSchema.parse(
      await (
        await request(
          `/boards/${fixture.id}/threads?limit=${PAGE_SIZE}&cursor=${firstPage.nextCursor}`,
        )
      ).json(),
    );
    expect([...firstPage.data, ...secondPage.data].map((thread) => thread.id)).toEqual(sorted);
    expect(secondPage.nextCursor).toBeNull();
    await database.query(
      'UPDATE comment_threads SET resolved_at=CURRENT_TIMESTAMP,resolved_by=$2 WHERE id=ANY($1::uuid[])',
      [ids.slice(0, PAGE_SIZE), users.get('owner')!.id],
    );
    for (const resolved of ['true', 'false']) {
      const response = threadListResponseSchema.parse(
        await (await request(`/boards/${fixture.id}/threads?resolved=${resolved}`)).json(),
      );
      expect(response.data).toHaveLength(PAGE_SIZE);
    }
    const commentIds = [randomUUID(), randomUUID(), randomUUID()];
    await database.query(
      `INSERT INTO comments (id,thread_id,author_user_id,body,created_at) SELECT id,$3,$4,$5,stamp FROM unnest($1::uuid[],$2::timestamptz[]) AS rows(id,stamp)`,
      [commentIds, times.slice(1), ids[0], users.get('editor')!.id, submittedBody],
    );
    await database.query('UPDATE comments SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1', [
      commentIds[2],
    ]);
    const commentPage = commentListResponseSchema.parse(
      await (
        await request(`/boards/${fixture.id}/threads/${ids[0]}/comments?limit=${PAGE_SIZE}`)
      ).json(),
    );
    const nextCommentPage = commentListResponseSchema.parse(
      await (
        await request(
          `/boards/${fixture.id}/threads/${ids[0]}/comments?limit=${PAGE_SIZE}&cursor=${commentPage.nextCursor}`,
        )
      ).json(),
    );
    expect(
      [...commentPage.data.slice(1), ...nextCommentPage.data].map((comment) => comment.id),
    ).toEqual([...commentIds.slice(0, PAGE_SIZE).sort(), commentIds[2]]);
    expect(nextCommentPage.nextCursor).toBeNull();
    expect(nextCommentPage.data.at(-1)?.body).toBe(COMMENT_DELETION_MARKER);
    const summary = threadListResponseSchema
      .parse(await (await request(`/boards/${fixture.id}/threads`)).json())
      .data.find((thread) => thread.id === ids[0]);
    expect(summary?.messageCount).toBe(commentIds.length + 1);
    expect(summary?.latestMessage).toMatchObject({
      id: commentIds[2],
      body: COMMENT_DELETION_MARKER,
      author: { id: users.get('editor')!.id },
    });
    expect(summary?.latestMessage.deletedAt).not.toBeNull();
    await expectError(
      await request(`/boards/${fixture.id}/threads?resolved=all`),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    await expectError(
      await request(`/boards/${fixture.id}/threads?limit=101`),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    await expectError(
      await request(`/boards/${fixture.id}/threads?cursor=invalid`),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
  });

  it('rechecks current authority after an in-flight create waits behind archive', async () => {
    const fixture = await board();
    const runner = await lockedBoard(fixture.id);
    let attempted: Promise<Response> | undefined;
    try {
      await runner.query('UPDATE boards SET archived_at=CURRENT_TIMESTAMP WHERE id=$1', [
        fixture.id,
      ]);
      attempted = createRequest(fixture.id);
      await waitForBoardLock();
      await runner.commitTransaction();
      await expectError(await attempted, HttpStatus.CONFLICT, ERROR_CODES.BOARD_ARCHIVED);
      expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await attempted;
    }
  });

  it('rejects a session that expires while a create is waiting for the board transaction', async () => {
    const fixture = await board();
    await database.query(
      `INSERT INTO board_members (board_id,user_id,role) VALUES ($1,$2,'editor')`,
      [fixture.id, users.get('expiring')!.id],
    );
    const runner = await lockedBoard(fixture.id);
    let attempted: Promise<Response> | undefined;
    try {
      attempted = createRequest(fixture.id, point, 'expiring');
      await waitForBoardLock();
      await database.query(
        `UPDATE session SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "userId"=$1`,
        [users.get('expiring')!.id],
      );
      await runner.commitTransaction();
      await expectError(await attempted, HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED);
      expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await attempted;
    }
  });

  it('rejects an anchor when a real graph deletion commits before the waiting create', async () => {
    const fixture = await board();
    const reached = deferred();
    const release = deferred();
    application
      .get(DurableUpdateFailpointController)
      .arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT, async () => {
        reached.resolve();
        await release.promise;
      });
    const deletion = graphEdit(fixture, (document) =>
      tombstoneNode(document, fixture.graph.nodes[0]!.id),
    );
    await Promise.race([
      reached.promise,
      deletion.then(() => {
        throw new Error('Graph write did not reach its transaction barrier.');
      }),
    ]);
    let attempted: Promise<Response> | undefined;
    try {
      attempted = createRequest(fixture.id, {
        type: 'node',
        id: fixture.graph.nodes[0]!.id,
        label: '',
        position: { x: 0, y: 0 },
      });
      await waitForBoardLock();
      release.resolve();
      expect((await deletion).sequence).toBe('1');
      await expectError(await attempted, HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
    } finally {
      release.resolve();
      await deletion;
      await attempted;
    }
  });

  it('preserves a committed thread and exact replay when graph deletion commits afterward', async () => {
    const fixture = await board();
    const key = randomUUID();
    const reached = deferred();
    const release = deferred();
    const reader = application.get(CommittedAnchorReader);
    const resolve = reader.resolve.bind(reader);
    const spy = jest.spyOn(reader, 'resolve').mockImplementationOnce(async (...args) => {
      const result = await resolve(...args);
      reached.resolve();
      await release.promise;
      return result;
    });
    const anchor: ThreadAnchor = {
      type: 'node',
      id: fixture.graph.nodes[0]!.id,
      label: 'Fabricated',
      position: { x: 0, y: 0 },
    };
    const creation = createRequest(fixture.id, anchor, 'owner', key);
    await Promise.race([
      reached.promise,
      creation.then((response) => {
        throw new Error(`Anchor read did not reach its barrier (HTTP ${response.status}).`);
      }),
    ]);
    let deletion: ReturnType<typeof graphEdit> | undefined;
    try {
      deletion = graphEdit(fixture, (document) =>
        tombstoneNode(document, fixture.graph.nodes[0]!.id),
      );
      await waitForBoardLock();
      release.resolve();
      const response = await creation;
      expect(response.status).toBe(HttpStatus.CREATED);
      const first = threadCreateResponseSchema.parse(await response.json()).data;
      await deletion;
      expect(
        projectGraphDocument(rooms.get(fixture.id)!.document).nodes.some(
          (node) => node.id === anchor.id,
        ),
      ).toBe(false);
      const listed = threadListResponseSchema.parse(
        await (await request(`/boards/${fixture.id}/threads`)).json(),
      ).data;
      expect(listed[0]?.anchor).toEqual(first.thread.anchor);
      const replay = await createRequest(fixture.id, anchor, 'owner', key);
      expect(replay.status).toBe(HttpStatus.CREATED);
      expect(threadCreateResponseSchema.parse(await replay.json()).data).toEqual(first);
      expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
    } finally {
      release.resolve();
      spy.mockRestore();
      await creation;
      await deletion;
    }
  });

  function edit(
    boardId: string,
    commentId: string,
    actor = 'owner',
    expectedVersion = 1,
    body = 'Synthetic newer message',
  ) {
    return request(`/boards/${boardId}/comments/${commentId}`, actor, {
      method: 'PATCH',
      body: { body, expectedVersion },
    });
  }

  function removeMessage(boardId: string, commentId: string, actor = 'owner', expectedVersion = 1) {
    return request(`/boards/${boardId}/comments/${commentId}`, actor, {
      method: 'DELETE',
      body: { expectedVersion },
    });
  }

  function resolveThread(
    boardId: string,
    threadId: string,
    actor = 'owner',
    expectedVersion = 1,
    resolved = true,
  ) {
    return request(`/boards/${boardId}/threads/${threadId}`, actor, {
      method: 'PATCH',
      body: { expectedVersion, resolved },
    });
  }

  async function storedComment(commentId: string) {
    return (
      await database.query(
        'SELECT body,version,author_user_id,created_at,edited_at,deleted_at FROM comments WHERE id=$1',
        [commentId],
      )
    )[0];
  }

  async function storedThread(threadId: string) {
    return (
      await database.query(
        'SELECT version,resolved_at,resolved_by,anchor,created_at,created_by FROM comment_threads WHERE id=$1',
        [threadId],
      )
    )[0];
  }

  it('edits only the message version and preserves author, creation context and graph state', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    const graphBefore = await database.query(
      'SELECT latest_seq,content_updated_at FROM boards WHERE id=$1',
      [fixture.id],
    );
    const threadBefore = await storedThread(first.thread.id);
    const response = await edit(fixture.id, first.comment.id);
    expect(response.status).toBe(HttpStatus.OK);
    const updated = commentResponseSchema.parse(await response.json()).data;
    expect(updated).toMatchObject({
      version: 2,
      author: first.comment.author,
      createdAt: first.comment.createdAt,
      deletedAt: null,
    });
    expect(updated.editedAt).not.toBeNull();
    const newer = await storedComment(first.comment.id);
    expect(newer).toMatchObject({
      version: 2,
      body: updated.body,
      author_user_id: users.get('owner')!.id,
      deleted_at: null,
    });
    await expectError(
      await edit(fixture.id, first.comment.id),
      HttpStatus.CONFLICT,
      ERROR_CODES.VERSION_CONFLICT,
    );
    expect(await storedComment(first.comment.id)).toEqual(newer);
    const unchanged = await edit(
      fixture.id,
      first.comment.id,
      'owner',
      CHANGED_VERSION,
      updated.body,
    );
    expect(unchanged.status).toBe(HttpStatus.OK);
    expect(commentResponseSchema.parse(await unchanged.json()).data).toEqual(updated);
    expect(await storedThread(first.thread.id)).toEqual(threadBefore);
    expect(
      await database.query('SELECT latest_seq,content_updated_at FROM boards WHERE id=$1', [
        fixture.id,
      ]),
    ).toEqual(graphBefore);
  });

  it('permits owner moderation without replacing the original editor author and logs only safe operation fields', async () => {
    const fixture = await board();
    const created = await createRequest(fixture.id, point, 'editor');
    const first = threadCreateResponseSchema.parse(await created.json()).data;
    const ownEdit = await edit(fixture.id, first.comment.id, 'editor');
    expect(ownEdit.status).toBe(HttpStatus.OK);
    const ownerEdit = await edit(
      fixture.id,
      first.comment.id,
      'owner',
      CHANGED_VERSION,
      'Synthetic owner moderation',
    );
    expect(ownerEdit.status).toBe(HttpStatus.OK);
    const updated = commentResponseSchema.parse(await ownerEdit.json()).data;
    expect(updated.author).toEqual(first.comment.author);
    const ownerDelete = await removeMessage(
      fixture.id,
      first.comment.id,
      'owner',
      SECOND_CHANGED_VERSION,
    );
    expect(ownerDelete.status).toBe(HttpStatus.OK);
    expect(commentResponseSchema.parse(await ownerDelete.json()).data.author).toEqual(
      first.comment.author,
    );
    const ownReply = commentResponseSchema.parse(
      await (await reply(fixture.id, first.thread.id, 'editor')).json(),
    ).data;
    expect((await removeMessage(fixture.id, ownReply.id, 'editor')).status).toBe(HttpStatus.OK);
    const logs = jest
      .mocked(console.info)
      .mock.calls.map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: users.get('owner')!.id,
          boardId: fixture.id,
          method: 'DELETE',
          route: '/api/v1/boards/:id/comments/:commentId',
          status: HttpStatus.OK,
        }),
      ]),
    );
    const safeLogs = JSON.stringify(logs);
    expect(safeLogs).not.toContain('Synthetic owner moderation');
    expect(safeLogs).not.toContain(users.get('owner')!.cookie);
    expect(safeLogs).not.toContain('author_user_id');
  });

  it('retains deletion markers, counts, metadata and timestamps and prevents stale or current-version resurrection', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    const edited = commentResponseSchema.parse(
      await (await edit(fixture.id, first.comment.id)).json(),
    ).data;
    const removed = await removeMessage(fixture.id, first.comment.id, 'owner', CHANGED_VERSION);
    expect(removed.status).toBe(HttpStatus.OK);
    const marker = commentResponseSchema.parse(await removed.json()).data;
    expect(marker).toMatchObject({
      body: COMMENT_DELETION_MARKER,
      version: 3,
      author: first.comment.author,
      createdAt: first.comment.createdAt,
      editedAt: edited.editedAt,
    });
    expect(marker.deletedAt).not.toBeNull();
    const stored = await storedComment(first.comment.id);
    expect(stored).toMatchObject({ body: COMMENT_DELETION_MARKER, version: 3 });
    const again = await removeMessage(
      fixture.id,
      first.comment.id,
      'owner',
      SECOND_CHANGED_VERSION,
    );
    expect(again.status).toBe(HttpStatus.OK);
    expect(commentResponseSchema.parse(await again.json()).data).toEqual(marker);
    await expectError(
      await removeMessage(fixture.id, first.comment.id, 'owner', CHANGED_VERSION),
      HttpStatus.CONFLICT,
      ERROR_CODES.VERSION_CONFLICT,
    );
    await expectError(
      await edit(fixture.id, first.comment.id, 'owner', CHANGED_VERSION),
      HttpStatus.CONFLICT,
      ERROR_CODES.VERSION_CONFLICT,
    );
    await expectError(
      await edit(fixture.id, first.comment.id, 'owner', SECOND_CHANGED_VERSION),
      HttpStatus.CONFLICT,
      ERROR_CODES.VERSION_CONFLICT,
    );
    expect(await storedComment(first.comment.id)).toEqual(stored);
    const listed = threadListResponseSchema.parse(
      await (await request(`/boards/${fixture.id}/threads`)).json(),
    ).data[0]!;
    expect(listed).toMatchObject({
      version: 1,
      messageCount: 1,
      latestMessage: { body: COMMENT_DELETION_MARKER, deletedAt: marker.deletedAt },
    });
    expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
  });

  it('versions resolution and reopening independently from messages and preserves no-op resolution attribution', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    const original = await storedComment(first.comment.id);
    const resolvedResponse = await resolveThread(fixture.id, first.thread.id, 'editor');
    expect(resolvedResponse.status).toBe(HttpStatus.OK);
    const resolved = threadResponseSchema.parse(await resolvedResponse.json()).data;
    expect(resolved).toMatchObject({
      version: 2,
      resolvedBy: { id: users.get('editor')!.id },
      createdBy: first.thread.createdBy,
      anchor: first.thread.anchor,
    });
    expect(resolved.resolvedAt).not.toBeNull();
    const same = await resolveThread(fixture.id, first.thread.id, 'owner', CHANGED_VERSION);
    expect(same.status).toBe(HttpStatus.OK);
    expect(threadResponseSchema.parse(await same.json()).data).toEqual(resolved);
    const before = await storedThread(first.thread.id);
    await expectError(
      await resolveThread(fixture.id, first.thread.id, 'owner', 1, false),
      HttpStatus.CONFLICT,
      ERROR_CODES.VERSION_CONFLICT,
    );
    expect(await storedThread(first.thread.id)).toEqual(before);
    const reopenedResponse = await resolveThread(
      fixture.id,
      first.thread.id,
      'owner',
      CHANGED_VERSION,
      false,
    );
    expect(reopenedResponse.status).toBe(HttpStatus.OK);
    expect(threadResponseSchema.parse(await reopenedResponse.json()).data).toMatchObject({
      version: 3,
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(await storedComment(first.comment.id)).toEqual(original);
    const filtered = threadListResponseSchema.parse(
      await (await request(`/boards/${fixture.id}/threads?resolved=false`)).json(),
    );
    expect(filtered.data.map((thread) => thread.id)).toContain(first.thread.id);
  });

  it('rejects editor moderation of another author, viewer writes, removed users and cross-board resources', async () => {
    const fixture = await board();
    const otherBoard = await board();
    const first = await create(fixture.id);
    const before = await storedComment(first.comment.id);
    for (const mutate of [edit, removeMessage]) {
      await expectError(
        await mutate(fixture.id, first.comment.id, 'editor'),
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
      );
      await expectError(
        await mutate(fixture.id, first.comment.id, 'viewer'),
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
      );
      await expectError(
        await mutate(fixture.id, first.comment.id, 'outsider'),
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
      await expectError(
        await mutate(otherBoard.id, first.comment.id),
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
      await expectError(
        await mutate(fixture.id, randomUUID()),
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    await expectError(
      await resolveThread(fixture.id, first.thread.id, 'viewer'),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    await expectError(
      await resolveThread(fixture.id, first.thread.id, 'outsider'),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    await expectError(
      await resolveThread(otherBoard.id, first.thread.id),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    const authored = threadCreateResponseSchema.parse(
      await (await createRequest(fixture.id, point, 'editor')).json(),
    ).data;
    expect(
      (
        await request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    for (const mutate of [edit, removeMessage])
      await expectError(
        await mutate(fixture.id, authored.comment.id, 'editor'),
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
      );
    await expectError(
      await resolveThread(fixture.id, authored.thread.id, 'editor'),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    expect(
      (
        await request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HttpStatus.NO_CONTENT);
    for (const mutate of [edit, removeMessage])
      await expectError(
        await mutate(fixture.id, authored.comment.id, 'editor'),
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    await expectError(
      await resolveThread(fixture.id, authored.thread.id, 'editor'),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
    );
    expect(await storedComment(first.comment.id)).toEqual(before);
    expect((await storedComment(authored.comment.id)).version).toBe(1);
  });

  it('blocks every archived moderation operation while authorized readers retain the unchanged rows', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    const before = await storedComment(first.comment.id);
    const threadBefore = await storedThread(first.thread.id);
    expect(
      (
        await request(`/boards/${fixture.id}/archive`, 'owner', {
          method: 'POST',
          body: { expectedVersion: 1 },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    for (const actor of ['owner', 'editor']) {
      for (const mutate of [edit, removeMessage])
        await expectError(
          await mutate(fixture.id, first.comment.id, actor),
          HttpStatus.CONFLICT,
          ERROR_CODES.BOARD_ARCHIVED,
        );
      await expectError(
        await resolveThread(fixture.id, first.thread.id, actor),
        HttpStatus.CONFLICT,
        ERROR_CODES.BOARD_ARCHIVED,
      );
    }
    expect(
      (await request(`/boards/${fixture.id}/threads/${first.thread.id}/comments`, 'viewer')).status,
    ).toBe(HttpStatus.OK);
    expect(await storedComment(first.comment.id)).toEqual(before);
    expect(await storedThread(first.thread.id)).toEqual(threadBefore);
  });

  it('rejects unauthenticated, forged and malformed version mutation payloads without changing rows', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    const before = await storedComment(first.comment.id);
    const threadBefore = await storedThread(first.thread.id);
    const commentPath = `/boards/${fixture.id}/comments/${first.comment.id}`;
    const threadPath = `/boards/${fixture.id}/threads/${first.thread.id}`;
    for (const [path, method, body] of [
      [commentPath, 'PATCH', { body: 'Synthetic', expectedVersion: 1 }],
      [commentPath, 'DELETE', { expectedVersion: 1 }],
      [threadPath, 'PATCH', { resolved: true, expectedVersion: 1 }],
    ] as const) {
      await expectError(
        await request(path, '', { method, body }),
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.UNAUTHENTICATED,
      );
      for (const extra of [
        { authorUserId: users.get('owner')!.id },
        { createdAt: first.comment.createdAt },
        { editedAt: first.comment.createdAt },
        { deletedAt: first.comment.createdAt },
        { resolvedAt: first.thread.createdAt },
        { resolvedBy: users.get('owner')!.id },
        { createdBy: users.get('owner')!.id },
        { version: 1 },
      ])
        await expectError(
          await request(path, 'owner', { method, body: { ...body, ...extra } }),
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      for (const expectedVersion of [0, -1, FRACTIONAL_VERSION, '1', null])
        await expectError(
          await request(path, 'owner', { method, body: { ...body, expectedVersion } }),
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      await expectError(
        await request(path, 'owner', { method, body: {} }),
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    await expectError(
      await request(threadPath, 'owner', {
        method: 'PATCH',
        body: { resolved: 'true', expectedVersion: 1 },
      }),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    await expectError(
      await edit(fixture.id, first.comment.id, 'owner', 1, ' \n\t'),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    await expectError(
      await edit(
        fixture.id,
        first.comment.id,
        'owner',
        1,
        'x'.repeat(MAX_COMMENT_BODY_CHARACTERS + 1),
      ),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
    expect(await storedComment(first.comment.id)).toEqual(before);
    expect(await storedThread(first.thread.id)).toEqual(threadBefore);
  });

  it('preserves the winning stored body and metadata in an independent edit/edit A20 race', async () => {
    const fixture = await board();
    const first = threadCreateResponseSchema.parse(
      await (await createRequest(fixture.id, point, 'editor')).json(),
    ).data;
    const responses = await Promise.all([
      edit(fixture.id, first.comment.id, 'editor', 1, 'Synthetic editor winner'),
      edit(fixture.id, first.comment.id, 'owner', 1, 'Synthetic owner winner'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      HttpStatus.OK,
      HttpStatus.CONFLICT,
    ]);
    const winner = commentResponseSchema.parse(
      await responses.find((response) => response.status === HttpStatus.OK)!.json(),
    ).data;
    await expectError(
      responses.find((response) => response.status === HttpStatus.CONFLICT)!,
      HttpStatus.CONFLICT,
      ERROR_CODES.VERSION_CONFLICT,
    );
    const stored = await storedComment(first.comment.id);
    expect(stored).toMatchObject({
      body: winner.body,
      version: 2,
      author_user_id: users.get('editor')!.id,
      deleted_at: null,
    });
    expect(stored.edited_at).not.toBeNull();
    expect((await storedThread(first.thread.id)).version).toBe(1);
  });

  it.each(['edit-first', 'delete-first'] as const)(
    'preserves the newer row under ordered edit/delete A20 race: %s',
    async (ordering) => {
      const fixture = await board();
      const first = await create(fixture.id);
      const reached = deferred();
      const release = deferred();
      const method = ordering === 'edit-first' ? 'editComment' : 'deleteComment';
      const originalEdit = DiscussionRepository.prototype.editComment;
      const originalDelete = DiscussionRepository.prototype.deleteComment;
      const spy = jest
        .spyOn(DiscussionRepository.prototype, method)
        .mockImplementationOnce(async function (
          this: DiscussionRepository,
          ...args: [string, number, string?]
        ) {
          const result =
            ordering === 'edit-first'
              ? await originalEdit.call(this, args[0], args[1], args[2]!)
              : await originalDelete.call(this, args[0], args[1]);
          reached.resolve();
          await release.promise;
          return result;
        });
      const winner =
        ordering === 'edit-first'
          ? edit(fixture.id, first.comment.id)
          : removeMessage(fixture.id, first.comment.id);
      let loser: Promise<Response> | undefined;
      try {
        await Promise.race([
          reached.promise,
          winner.then((response) => {
            throw new Error(`Mutation barrier was not reached (HTTP ${response.status}).`);
          }),
        ]);
        loser =
          ordering === 'edit-first'
            ? removeMessage(fixture.id, first.comment.id)
            : edit(fixture.id, first.comment.id);
        await waitForBoardLock();
        release.resolve();
        const response = await winner;
        expect(response.status).toBe(HttpStatus.OK);
        const changed = commentResponseSchema.parse(await response.json()).data;
        await expectError(await loser, HttpStatus.CONFLICT, ERROR_CODES.VERSION_CONFLICT);
        expect(await storedComment(first.comment.id)).toMatchObject({
          body: changed.body,
          version: 2,
          author_user_id: first.comment.author.id,
        });
        expect(changed.body).toBe(
          ordering === 'edit-first' ? 'Synthetic newer message' : COMMENT_DELETION_MARKER,
        );
        expect(changed.deletedAt === null).toBe(ordering === 'edit-first');
      } finally {
        release.resolve();
        spy.mockRestore();
        await winner;
        await loser;
      }
    },
  );

  it.each(['reopen-first', 'resolve-first'] as const)(
    'preserves a committed resolution state against a waiting opposite stale request: %s',
    async (ordering) => {
      const fixture = await board();
      const first = await create(fixture.id);
      if (ordering === 'reopen-first')
        expect((await resolveThread(fixture.id, first.thread.id)).status).toBe(HttpStatus.OK);
      const expectedVersion = ordering === 'reopen-first' ? CHANGED_VERSION : 1;
      const resolved = ordering === 'resolve-first';
      const reached = deferred();
      const release = deferred();
      const original = DiscussionRepository.prototype.resolveThread;
      const spy = jest
        .spyOn(DiscussionRepository.prototype, 'resolveThread')
        .mockImplementationOnce(async function (
          this: DiscussionRepository,
          ...args: Parameters<typeof original>
        ) {
          const result = await original.call(this, ...args);
          reached.resolve();
          await release.promise;
          return result;
        });
      const winner = resolveThread(
        fixture.id,
        first.thread.id,
        'editor',
        expectedVersion,
        resolved,
      );
      let loser: Promise<Response> | undefined;
      try {
        await Promise.race([
          reached.promise,
          winner.then((response) => {
            throw new Error(`Resolution barrier was not reached (HTTP ${response.status}).`);
          }),
        ]);
        loser = resolveThread(fixture.id, first.thread.id, 'owner', expectedVersion, !resolved);
        await waitForBoardLock();
        release.resolve();
        const response = await winner;
        expect(response.status).toBe(HttpStatus.OK);
        const changed = threadResponseSchema.parse(await response.json()).data;
        expect(changed.version).toBe(expectedVersion + 1);
        expect(changed.resolvedAt !== null).toBe(resolved);
        expect(changed.resolvedBy?.id ?? null).toBe(resolved ? users.get('editor')!.id : null);
        await expectError(await loser, HttpStatus.CONFLICT, ERROR_CODES.VERSION_CONFLICT);
        const stored = await storedThread(first.thread.id);
        expect(stored.version).toBe(expectedVersion + 1);
        expect(stored.resolved_at !== null).toBe(resolved);
        expect(stored.resolved_by).toBe(resolved ? users.get('editor')!.id : null);
        expect((await storedComment(first.comment.id)).version).toBe(1);
      } finally {
        release.resolve();
        spy.mockRestore();
        await winner;
        await loser;
      }
    },
  );

  it.each(['edit', 'delete', 'resolve'] as const)(
    'rolls back a failed %s without changing content, version or metadata',
    async (operation) => {
      const fixture = await board();
      const first = await create(fixture.id);
      const before = await storedComment(first.comment.id);
      const threadBefore = await storedThread(first.thread.id);
      const table = operation === 'resolve' ? 'comment_threads' : 'comments';
      const constraint = `p603_${operation}_failure`;
      await database.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (false) NOT VALID`,
      );
      try {
        const response =
          operation === 'edit'
            ? await edit(fixture.id, first.comment.id)
            : operation === 'delete'
              ? await removeMessage(fixture.id, first.comment.id)
              : await resolveThread(fixture.id, first.thread.id);
        const error = await expectError(
          response,
          HttpStatus.SERVICE_UNAVAILABLE,
          ERROR_CODES.TEMPORARILY_UNAVAILABLE,
        );
        expect(JSON.stringify(error)).not.toContain(constraint);
        expect(JSON.stringify(error)).not.toContain('Synthetic newer message');
        expect(await storedComment(first.comment.id)).toEqual(before);
        expect(await storedThread(first.thread.id)).toEqual(threadBefore);
        expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
      } finally {
        await database.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
      }
    },
  );

  it.each(['downgrade', 'remove', 'archive'] as const)(
    'rechecks authority after a moderation request waits behind %s',
    async (change) => {
      const fixture = await board();
      const first = threadCreateResponseSchema.parse(
        await (await createRequest(fixture.id, point, 'editor')).json(),
      ).data;
      const before = await storedComment(first.comment.id);
      const runner = await lockedBoard(fixture.id);
      let attempted: Promise<Response> | undefined;
      try {
        attempted = edit(fixture.id, first.comment.id, 'editor');
        await waitForBoardLock();
        if (change === 'downgrade')
          await runner.query(
            `UPDATE board_members SET role='viewer' WHERE board_id=$1 AND user_id=$2`,
            [fixture.id, users.get('editor')!.id],
          );
        else if (change === 'remove')
          await runner.query('DELETE FROM board_members WHERE board_id=$1 AND user_id=$2', [
            fixture.id,
            users.get('editor')!.id,
          ]);
        else
          await runner.query('UPDATE boards SET archived_at=CURRENT_TIMESTAMP WHERE id=$1', [
            fixture.id,
          ]);
        await runner.commitTransaction();
        const status =
          change === 'downgrade'
            ? HttpStatus.FORBIDDEN
            : change === 'remove'
              ? HttpStatus.NOT_FOUND
              : HttpStatus.CONFLICT;
        const code =
          change === 'downgrade'
            ? ERROR_CODES.FORBIDDEN
            : change === 'remove'
              ? ERROR_CODES.NOT_FOUND
              : ERROR_CODES.BOARD_ARCHIVED;
        await expectError(await attempted, status, code);
        expect(await storedComment(first.comment.id)).toEqual(before);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await attempted;
      }
    },
  );

  it('rejects an expired real session after moderation waits for the board lock', async () => {
    const fixture = await board();
    await database.query(
      `INSERT INTO board_members (board_id,user_id,role) VALUES ($1,$2,'editor')`,
      [fixture.id, users.get('moderator')!.id],
    );
    const first = threadCreateResponseSchema.parse(
      await (await createRequest(fixture.id, point, 'moderator')).json(),
    ).data;
    const before = await storedComment(first.comment.id);
    const runner = await lockedBoard(fixture.id);
    let attempted: Promise<Response> | undefined;
    try {
      attempted = edit(fixture.id, first.comment.id, 'moderator');
      await waitForBoardLock();
      await database.query(
        `UPDATE session SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "userId"=$1`,
        [users.get('moderator')!.id],
      );
      await runner.commitTransaction();
      await expectError(await attempted, HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED);
      expect(await storedComment(first.comment.id)).toEqual(before);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await attempted;
    }
  });

  async function observeSocket(boardId: string, actor = 'viewer') {
    const frames: ReturnType<typeof serverMessageSchema.parse>[] = [];
    const socket = new WebSocket(`${apiOrigin.replace('http:', 'ws:')}/ws/boards/${boardId}`, {
      origin: ORIGIN,
      headers: { cookie: users.get(actor)!.cookie },
    });
    sockets.add(socket);
    socket.on('message', (raw) =>
      frames.push(serverMessageSchema.parse(JSON.parse(raw.toString()))),
    );
    const waitEvent = (event: 'ready' | 'close' | 'pong') =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Socket ${event} timed out.`));
        }, TIMEOUT_MS);
        const done = () => {
          cleanup();
          resolve();
        };
        const onMessage = (raw: RawData) => {
          if (serverMessageSchema.parse(JSON.parse(raw.toString())).event === event) done();
        };
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('message', onMessage);
          socket.off(event === 'ready' ? 'open' : event, done);
        };
        if (event === 'ready') socket.on('message', onMessage);
        else socket.once(event, done);
      });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const ready = waitEvent('ready');
    socket.send(
      JSON.stringify({
        event: 'hello',
        data: {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: GRAPH_SCHEMA_VERSION,
          tabId: randomUUID(),
        },
      }),
    );
    await ready;
    const flush = async () => {
      await application.get(CollaborationGateway).drain();
      if (socket.readyState === WebSocket.OPEN) {
        const pong = waitEvent('pong');
        socket.ping();
        await pong;
      }
    };
    await flush();
    frames.length = 0;
    return { socket, frames, flush, closed: () => waitEvent('close') };
  }

  it('P6-04 sends one committed comments hint to current actor/readers without graph or unrelated-board effects', async () => {
    const fixture = await board();
    const other = await board();
    const actor = await observeSocket(fixture.id, 'owner');
    const reader = await observeSocket(fixture.id);
    const unrelated = await observeSocket(other.id, 'owner');
    const refreshes: Promise<ReturnType<typeof threadListResponseSchema.parse>>[] = [];
    reader.socket.on('message', (raw) => {
      const message = serverMessageSchema.parse(JSON.parse(raw.toString()));
      if (message.event === 'invalidate' && message.data.resource === 'comments') {
        refreshes.push(
          request(`/boards/${fixture.id}/threads`, 'viewer').then(async (response) => {
            expect(response.status).toBe(HttpStatus.OK);
            return threadListResponseSchema.parse(await response.json());
          }),
        );
      }
    });
    const before = await database.query(
      'SELECT latest_seq,content_updated_at FROM boards WHERE id=$1',
      [fixture.id],
    );
    const key = randomUUID();
    const response = await createRequest(fixture.id, point, 'owner', key);
    expect(response.status).toBe(HttpStatus.CREATED);
    const first = threadCreateResponseSchema.parse(await response.json()).data;
    await Promise.all([actor.flush(), reader.flush(), unrelated.flush()]);
    const hints = (frames: typeof reader.frames) =>
      frames.filter((frame) => frame.event === 'invalidate' && frame.data.resource === 'comments');
    expect(hints(actor.frames)).toHaveLength(1);
    expect(hints(reader.frames)).toHaveLength(1);
    expect(unrelated.frames).toHaveLength(0);
    const fetched = await Promise.all(refreshes);
    expect(fetched[0]?.data[0]?.id).toBe(first.thread.id);
    expect((await createRequest(fixture.id, point, 'owner', key)).status).toBe(HttpStatus.CREATED);
    await expectError(
      await createRequest(fixture.id, point, 'viewer'),
      HttpStatus.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
    );
    await reader.flush();
    expect(hints(reader.frames)).toHaveLength(1);
    expect((await reply(fixture.id, first.thread.id)).status).toBe(HttpStatus.CREATED);
    expect((await edit(fixture.id, first.comment.id)).status).toBe(HttpStatus.OK);
    expect((await edit(fixture.id, first.comment.id, 'owner', CHANGED_VERSION)).status).toBe(
      HttpStatus.OK,
    );
    expect(
      (await removeMessage(fixture.id, first.comment.id, 'owner', CHANGED_VERSION)).status,
    ).toBe(HttpStatus.OK);
    expect(
      (await removeMessage(fixture.id, first.comment.id, 'owner', SECOND_CHANGED_VERSION)).status,
    ).toBe(HttpStatus.OK);
    expect((await resolveThread(fixture.id, first.thread.id)).status).toBe(HttpStatus.OK);
    expect(
      (await resolveThread(fixture.id, first.thread.id, 'owner', CHANGED_VERSION)).status,
    ).toBe(HttpStatus.OK);
    expect(
      (await resolveThread(fixture.id, first.thread.id, 'owner', CHANGED_VERSION, false)).status,
    ).toBe(HttpStatus.OK);
    await reader.flush();
    expect(hints(reader.frames)).toHaveLength(EXPECTED_COMMENTS_HINTS);
    const finalReads = await Promise.all(refreshes);
    expect(finalReads.at(-1)?.data[0]).toMatchObject({
      version: 3,
      resolvedAt: null,
      messageCount: 2,
    });
    expect(reader.frames.some((frame) => frame.event === 'ack' || frame.event === 'update')).toBe(
      false,
    );
    expect(
      await database.query('SELECT latest_seq,content_updated_at FROM boards WHERE id=$1', [
        fixture.id,
      ]),
    ).toEqual(before);
    actor.socket.terminate();
    reader.socket.terminate();
    unrelated.socket.terminate();
  });

  it('P6-04 sends nothing before commit or after a real transaction rollback', async () => {
    const fixture = await board();
    const reader = await observeSocket(fixture.id);
    const reached = deferred();
    const release = deferred();
    const original = DiscussionRepository.prototype.insertComment;
    const spy = jest
      .spyOn(DiscussionRepository.prototype, 'insertComment')
      .mockImplementationOnce(async function (
        this: DiscussionRepository,
        ...args: Parameters<typeof original>
      ) {
        const result = await original.call(this, ...args);
        reached.resolve();
        await release.promise;
        return result;
      });
    const creation = createRequest(fixture.id);
    try {
      await Promise.race([
        reached.promise,
        creation.then((response) => {
          throw new Error(`Commit barrier missed (${response.status}).`);
        }),
      ]);
      // Do not drain the gateway here: no notification operation exists until commit.
      const pong = new Promise<void>((resolve) => reader.socket.once('pong', () => resolve()));
      reader.socket.ping();
      await pong;
      expect(reader.frames).toHaveLength(0);
      expect(await counts(fixture.id)).toEqual({ threads: 0, comments: 0, keys: 0 });
      release.resolve();
      expect((await creation).status).toBe(HttpStatus.CREATED);
      await reader.flush();
      expect(reader.frames.filter((frame) => frame.event === 'invalidate')).toHaveLength(1);
    } finally {
      release.resolve();
      spy.mockRestore();
      await creation;
    }
    reader.frames.length = 0;
    await database.query(
      'ALTER TABLE comments ADD CONSTRAINT p604_message_failure CHECK(false) NOT VALID',
    );
    try {
      await expectError(
        await createRequest(fixture.id),
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.TEMPORARILY_UNAVAILABLE,
      );
      await reader.flush();
      expect(reader.frames).toHaveLength(0);
    } finally {
      await database.query('ALTER TABLE comments DROP CONSTRAINT p604_message_failure');
      reader.socket.terminate();
    }
  });

  it('P6-04 orders downgrade/archive access events before member/metadata hints and suppresses no-op metadata changes', async () => {
    const fixture = await board();
    const editor = await observeSocket(fixture.id, 'editor');
    const owner = await observeSocket(fixture.id, 'owner');
    expect(
      (
        await request(`/boards/${fixture.id}`, 'owner', {
          method: 'PATCH',
          body: { expectedVersion: 1, title: 'Synthetic updated metadata' },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    await owner.flush();
    expect(owner.frames).toEqual([
      expect.objectContaining({ event: 'invalidate', data: { resource: 'metadata' } }),
    ]);
    owner.frames.length = 0;
    expect(
      (
        await request(`/boards/${fixture.id}`, 'owner', {
          method: 'PATCH',
          body: { expectedVersion: CHANGED_VERSION, title: 'Synthetic updated metadata' },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    await owner.flush();
    expect(owner.frames).toHaveLength(0);
    editor.frames.length = 0;
    expect(
      (
        await request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    await editor.flush();
    expect(editor.frames.map((frame) => frame.event)).toEqual([
      'access.changed',
      'invalidate',
      'invalidate',
    ]);
    expect(editor.frames[0]).toMatchObject({ data: { role: 'viewer', archived: false } });
    editor.frames.length = 0;
    expect(
      (
        await request(`/boards/${fixture.id}/archive`, 'owner', {
          method: 'POST',
          body: { expectedVersion: CHANGED_VERSION },
        })
      ).status,
    ).toBe(HttpStatus.OK);
    await editor.flush();
    expect(editor.frames.map((frame) => frame.event)).toEqual(['access.changed', 'invalidate']);
    expect(editor.frames[0]).toMatchObject({ data: { role: 'viewer', archived: true } });
    editor.socket.terminate();
    owner.socket.terminate();
  });

  it('P6-04 rechecks removal between a committed creation and delayed notification delivery', async () => {
    const fixture = await board();
    const removed = await observeSocket(fixture.id, 'editor');
    const reader = await observeSocket(fixture.id);
    const gateway = application.get(CollaborationGateway);
    const original = gateway.resourcesChanged.bind(gateway);
    const reached = deferred();
    const release = deferred();
    const spy = jest.spyOn(gateway, 'resourcesChanged').mockImplementationOnce(async (...args) => {
      reached.resolve();
      await release.promise;
      return original(...args);
    });
    const creation = createRequest(fixture.id);
    try {
      await Promise.race([
        reached.promise,
        creation.then((response) => {
          throw new Error(`Notification barrier missed (${response.status}).`);
        }),
      ]);
      expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
      const closed = removed.closed();
      expect(
        (
          await request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
            method: 'DELETE',
          })
        ).status,
      ).toBe(HttpStatus.NO_CONTENT);
      await closed;
      release.resolve();
      expect((await creation).status).toBe(HttpStatus.CREATED);
      await reader.flush();
      expect(removed.frames.some((frame) => frame.event === 'invalidate')).toBe(false);
      expect(removed.frames).toContainEqual(
        expect.objectContaining({ event: 'access.changed', data: { role: null, archived: false } }),
      );
      expect(reader.frames).toContainEqual({ event: 'invalidate', data: { resource: 'comments' } });
      await expectError(
        await request(`/boards/${fixture.id}/threads`, 'editor'),
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    } finally {
      release.resolve();
      spy.mockRestore();
      await creation;
      removed.socket.terminate();
      reader.socket.terminate();
    }
  });

  it('P6-04 maps invite acceptance to members/metadata after access changes and suppresses acceptance replay', async () => {
    const fixture = await board();
    const reader = await observeSocket(fixture.id);
    const response = await request(`/boards/${fixture.id}/invites`, 'owner', {
      method: 'POST',
      key: randomUUID(),
      body: { role: 'editor' },
    });
    expect(response.status).toBe(HttpStatus.CREATED);
    const invite = boardInviteResponseSchema.parse(await response.json()).data;
    const token = new URL(invite.inviteUrl!).pathname.split('/').at(-1)!;
    await reader.flush();
    expect(reader.frames).toHaveLength(0);
    const accepted = await request('/invites/accept', 'viewer', {
      method: 'POST',
      body: { token },
    });
    expect(accepted.status).toBe(HttpStatus.OK);
    expect(inviteAcceptanceResponseSchema.parse(await accepted.json()).data.effectiveRole).toBe(
      'editor',
    );
    await reader.flush();
    expect(reader.frames.map((frame) => frame.event)).toEqual([
      'access.changed',
      'invalidate',
      'invalidate',
    ]);
    expect(reader.frames[0]).toMatchObject({ data: { role: 'editor' } });
    reader.frames.length = 0;
    expect(
      (await request('/invites/accept', 'viewer', { method: 'POST', body: { token } })).status,
    ).toBe(HttpStatus.OK);
    await reader.flush();
    expect(reader.frames).toHaveLength(0);
    reader.socket.terminate();
  });

  it('P6-04 preserves a committed REST response when best-effort notification delivery fails', async () => {
    const fixture = await board();
    const reader = await observeSocket(fixture.id);
    const gateway = application.get(CollaborationGateway);
    const spy = jest
      .spyOn(gateway, 'resourcesChanged')
      .mockRejectedValueOnce(new Error('Synthetic notification failure'));
    const key = randomUUID();
    try {
      const response = await createRequest(fixture.id, point, 'owner', key);
      expect(response.status).toBe(HttpStatus.CREATED);
      const first = threadCreateResponseSchema.parse(await response.json()).data;
      expect(await counts(fixture.id)).toEqual({ threads: 1, comments: 1, keys: 1 });
      await reader.flush();
      expect(reader.frames).toHaveLength(0);
      const replay = await createRequest(fixture.id, point, 'owner', key);
      expect(replay.status).toBe(HttpStatus.CREATED);
      expect(threadCreateResponseSchema.parse(await replay.json()).data).toEqual(first);
      await reader.flush();
      expect(reader.frames).toHaveLength(0);
      const fetched = threadListResponseSchema.parse(
        await (await request(`/boards/${fixture.id}/threads`, 'viewer')).json(),
      ).data;
      expect(fetched[0]?.id).toBe(first.thread.id);
    } finally {
      spy.mockRestore();
      reader.socket.terminate();
    }
  });

  it('P6-04 rechecks queued graph fanout when removal commits behind a graph commit before notification runs', async () => {
    const fixture = await board();
    const owner = await observeSocket(fixture.id, 'owner');
    const removed = await observeSocket(fixture.id, 'editor');
    const reached = deferred();
    const release = deferred();
    application
      .get(DurableUpdateFailpointController)
      .arm(DURABLE_UPDATE_FAILPOINTS.AFTER_COMMIT_BEFORE_ACK, async () => {
        reached.resolve();
        await release.promise;
      });
    const document = new Y.Doc();
    Y.applyUpdate(document, fixture.state);
    const vector = Y.encodeStateVector(document);
    setNodeTitle(document, fixture.graph.nodes[0]!.id, 'Synthetic committed graph change');
    const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(document, vector)).toString('base64');
    document.destroy();
    owner.socket.send(
      JSON.stringify({ event: 'update', data: { updateId: randomUUID(), updateBase64 } }),
    );
    let removal: Promise<Response> | undefined;
    try {
      await reached.promise;
      const closed = removed.closed();
      removal = request(`/boards/${fixture.id}/members/${users.get('editor')!.id}`, 'owner', {
        method: 'DELETE',
      });
      let committed = false;
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        const rows = await database.query(
          'SELECT EXISTS(SELECT 1 FROM board_members WHERE board_id=$1 AND user_id=$2) AS present',
          [fixture.id, users.get('editor')!.id],
        );
        if (!rows[0]?.present) {
          committed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      expect(committed).toBe(true);
      release.resolve();
      expect((await removal).status).toBe(HttpStatus.NO_CONTENT);
      await closed;
      await owner.flush();
      expect(removed.frames.some((frame) => frame.event === 'update')).toBe(false);
      expect(owner.frames).toContainEqual(
        expect.objectContaining({ event: 'ack', data: expect.objectContaining({ seq: '1' }) }),
      );
    } finally {
      release.resolve();
      await removal;
      owner.socket.terminate();
      removed.socket.terminate();
    }
  });

  it('P6-04 rejects an expired socket session before protected invalidation fanout', async () => {
    const fixture = await board();
    const reader = await observeSocket(fixture.id);
    const closed = reader.closed();
    await database.query(
      `UPDATE session SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "userId"=$1`,
      [users.get('viewer')!.id],
    );
    expect((await createRequest(fixture.id)).status).toBe(HttpStatus.CREATED);
    await closed;
    expect(reader.frames.some((frame) => frame.event === 'invalidate')).toBe(false);
    await expectError(
      await request(`/boards/${fixture.id}/threads`, 'viewer'),
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.UNAUTHENTICATED,
    );
  });

  it('P6-11 denies cross-board discussion/member/invite targets through HTTP without changing any resource', async () => {
    const source = await board();
    const destination = await board();
    const thread = await create(source.id);
    const issued = await request(`/boards/${source.id}/invites`, 'owner', {
      method: 'POST',
      key: randomUUID(),
      body: { role: 'viewer' },
    });
    expect(issued.status).toBe(HttpStatus.CREATED);
    const invite = boardInviteResponseSchema.parse(await issued.json()).data;
    // The editor belongs only to source; destination is otherwise readable by the owner.
    await database.query('DELETE FROM board_members WHERE board_id=$1 AND user_id=$2', [
      destination.id,
      users.get('editor')!.id,
    ]);
    const unchanged = async () => ({
      source: await counts(source.id),
      destination: await counts(destination.id),
      comment: await storedComment(thread.comment.id),
      members: await database.query(
        'SELECT board_id,user_id,role FROM board_members WHERE board_id IN ($1,$2) ORDER BY board_id,user_id',
        [source.id, destination.id],
      ),
      invite: await database.query('SELECT revoked_at,accepted_by FROM board_invites WHERE id=$1', [
        invite.id,
      ]),
      graph: await database.query(
        'SELECT id,latest_seq,content_updated_at FROM boards WHERE id IN ($1,$2) ORDER BY id',
        [source.id, destination.id],
      ),
    });
    const before = await unchanged();
    const requests = [
      () => request(`/boards/${destination.id}/threads/${thread.thread.id}/comments`),
      () => reply(destination.id, thread.thread.id),
      () => edit(destination.id, thread.comment.id),
      () => removeMessage(destination.id, thread.comment.id),
      () => resolveThread(destination.id, thread.thread.id),
      () =>
        request(`/boards/${destination.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'PATCH',
          body: { role: 'viewer' },
        }),
      () =>
        request(`/boards/${destination.id}/members/${users.get('editor')!.id}`, 'owner', {
          method: 'DELETE',
        }),
      () =>
        request(`/boards/${destination.id}/invites/${invite.id}`, 'owner', { method: 'DELETE' }),
    ];
    for (const send of requests)
      await expectError(await send(), HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    for (const resource of ['threads', 'members', 'invites']) {
      const denied = await expectError(
        await request(`/boards/${source.id}/${resource}`, 'outsider'),
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
      expect(Object.keys(denied).sort()).toEqual(['code', 'message', 'requestId']);
    }
    expect(await unchanged()).toEqual(before);
  });

  it('P6-11 a reauthenticated socket and REST reader recover discussion committed during a disconnect', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    const reader = await observeSocket(fixture.id);
    const closed = reader.closed();
    reader.socket.close();
    await closed;
    const graph = await database.query(
      'SELECT latest_seq,content_updated_at FROM boards WHERE id=$1',
      [fixture.id],
    );
    const committed = await reply(fixture.id, first.thread.id);
    expect(committed.status).toBe(HttpStatus.CREATED);
    const message = commentResponseSchema.parse(await committed.json()).data;
    const resumed = await observeSocket(fixture.id);
    try {
      const response = await request(
        `/boards/${fixture.id}/threads/${first.thread.id}/comments`,
        'viewer',
      );
      expect(response.status).toBe(HttpStatus.OK);
      const messages = commentListResponseSchema.parse(await response.json()).data;
      expect(messages.map(({ id }) => id)).toContain(message.id);
      expect(messages.find(({ id }) => id === message.id)?.version).toBe(message.version);
      await resumed.flush();
      expect(resumed.frames.some(({ event }) => event === 'ack' || event === 'update')).toBe(false);
      expect(
        await database.query('SELECT latest_seq,content_updated_at FROM boards WHERE id=$1', [
          fixture.id,
        ]),
      ).toEqual(graph);
    } finally {
      resumed.socket.terminate();
    }
  });

  it('P6-11 measures actual repository thread/filter/cursor/message query plans on representative synthetic rows', async () => {
    const fixture = await board();
    const first = await create(fixture.id);
    await database.query(
      `INSERT INTO comment_threads (board_id,anchor,created_by,created_at,resolved_at,resolved_by)
      SELECT $1,$2::jsonb,$3,CURRENT_TIMESTAMP - make_interval(secs => n),
        CASE WHEN n % 2 = 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN n % 2 = 0 THEN $3 ELSE NULL END FROM generate_series(1,$4) n`,
      [fixture.id, JSON.stringify(point), users.get('owner')!.id, PLAN_THREADS],
    );
    await database.query(
      `INSERT INTO comments (thread_id,author_user_id,body,created_at)
      SELECT id,$2,'Synthetic query-plan row',created_at FROM comment_threads WHERE board_id=$1 AND id<>$3`,
      [fixture.id, users.get('owner')!.id, first.thread.id],
    );
    await database.query(
      `INSERT INTO comments (thread_id,author_user_id,body,created_at)
      SELECT $1,$2,'Synthetic query-plan reply',CURRENT_TIMESTAMP + make_interval(secs => n)
      FROM generate_series(1,$3) n`,
      [first.thread.id, users.get('owner')!.id, PLAN_MESSAGES - 1],
    );
    await database.query('ANALYZE comment_threads');
    await database.query('ANALYZE comments');
    const runner = database.createQueryRunner();
    await runner.connect();
    try {
      const repository = new DiscussionRepository(runner.manager);
      const captured = jest.spyOn(runner, 'query');
      const page = await repository.listThreads(fixture.id, PLAN_PAGE_SIZE, false);
      const thread = page.at(-1)!;
      const calls: { label: string; sql: string; parameters: unknown[] | undefined }[] = [];
      const remember = (label: string) => {
        const [sql, parameters] = captured.mock.calls.at(-1)!;
        if (parameters !== undefined && !Array.isArray(parameters))
          throw new Error('Expected positional query-plan parameters.');
        calls.push({ label, sql, parameters });
      };
      remember('unresolved-first-page');
      await repository.listThreads(fixture.id, PLAN_PAGE_SIZE, false, {
        id: thread.id,
        timestamp: thread.createdAt,
      });
      remember('unresolved-cursor-page');
      await repository.listThreads(fixture.id, PLAN_PAGE_SIZE, true);
      remember('resolved-first-page');
      const messages = await repository.listComments(fixture.id, first.thread.id, PLAN_PAGE_SIZE);
      remember('message-first-page');
      const last = messages.at(-1)!;
      await repository.listComments(fixture.id, first.thread.id, PLAN_PAGE_SIZE, {
        id: last.id,
        timestamp: last.createdAt,
      });
      remember('message-cursor-page');
      captured.mockRestore();
      for (const { label, sql, parameters } of calls) {
        const plans = (await runner.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          parameters,
        )) as { 'QUERY PLAN': { 'Execution Time': number; Plan: ObservedQueryPlan }[] }[];
        const plan = plans[0]!['QUERY PLAN'][0]!;
        expect(plan.Plan['Actual Rows']).toBe(PLAN_PAGE_SIZE);
        expect(Number.isFinite(plan['Execution Time'])).toBe(true);
        const operators = (
          node: ObservedQueryPlan,
        ): { type: string; discussionIndex: string | null }[] => [
          {
            type: node['Node Type'],
            discussionIndex: [
              'IDX_comment_threads_board_created_id',
              'IDX_comments_thread_created_id',
            ].includes(node['Index Name'] ?? '')
              ? node['Index Name']!
              : null,
          },
          ...(node.Plans?.flatMap(operators) ?? []),
        ];
        // Fixed operators/index names and numeric observations; no SQL/bind values/content.
        console.log(
          JSON.stringify({
            phase: 'P6-11',
            label,
            threads: PLAN_THREADS + 1,
            messages: PLAN_MESSAGES,
            rows: plan.Plan['Actual Rows'],
            executionMs: plan['Execution Time'],
            operators: operators(plan.Plan),
          }),
        );
      }
    } finally {
      await runner.release();
    }
  });

  it('publishes all seven discussion routes with exact shared schemas, DELETE bodies and statuses', async () => {
    const document = (await (await request('/openapi.json')).json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            parameters: { name: string; required: boolean }[];
            requestBody: {
              required: boolean;
              content: { 'application/json': { schema: { $ref: string } } };
            };
            responses: Record<
              string,
              { content: { 'application/json': { schema: { $ref: string } } } }
            >;
          }
        >
      >;
    };
    const createRoute = document.paths['/api/v1/boards/{id}/threads']!.post!;
    expect(createRoute.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(
      createRoute.responses[String(HttpStatus.CREATED)]!.content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/ThreadCreateResponse');
    expect(document.paths['/api/v1/boards/{id}/threads/{threadId}/comments']!.get).toBeDefined();
    expect(document.paths['/api/v1/boards/{id}/threads/{threadId}']!.patch).toBeDefined();
    const deletion = document.paths['/api/v1/boards/{id}/comments/{commentId}']!.delete!;
    expect(deletion.requestBody.required).toBe(true);
    expect(deletion.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/DeleteCommentRequest',
    );
    expect(deletion.responses[String(HttpStatus.OK)]!.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/CommentResponse',
    );
    expect(deletion.responses[String(HttpStatus.NO_CONTENT)]).toBeUndefined();
    expect(deletion.parameters.some((parameter) => parameter.name === 'Idempotency-Key')).toBe(
      false,
    );
  });
});
