import 'reflect-metadata';

import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  GRAPH_SCHEMA_VERSION,
  ERROR_CODES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  MAX_BOARD_CONNECTIONS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_DRAG_PREVIEW_POSITIONS,
  PRESENCE_UPDATES_PER_SECOND,
  MAX_WS_FRAME_BYTES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  serverMessageSchema,
} from '@archboard/contracts';
import { createNode, projectGraphDocument, validateGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import type { ClientOptions, RawData } from 'ws';
import * as Y from 'yjs';

import { AppModule } from '../../app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { BoardEntity } from '../boards/infrastructure/entities/board.entity.js';
import { BoardService } from '../boards/application/board-service.js';
import { createEmptyBoardSnapshot } from '../boards/infrastructure/empty-board-snapshot.js';
import { BoardSnapshotEntity } from '../collaboration/infrastructure/entities/board-snapshot.entity.js';
import { BoardUpdateEntity } from '../collaboration/infrastructure/entities/board-update.entity.js';
import { UpdateReceiptEntity } from '../collaboration/infrastructure/entities/update-receipt.entity.js';
import { CollaborationRoomRegistry } from '../collaboration/application/room-registry.js';
import { PostgresRoomCompactor } from '../collaboration/infrastructure/room/postgres-room-compactor.js';
import { PostgresRoomLoader } from '../collaboration/infrastructure/room/postgres-room-loader.js';
import {
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
} from '../collaboration/application/durable-update.js';
import { configureCollaborationWebSockets } from '../collaboration/infrastructure/websocket/index.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';
import { loadApiConfig } from '../../platform/config/index.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { BetterAuthRuntime, configureAuthHttp } from './index.js';

const ALLOWED_FRONTEND_ORIGIN = 'http://localhost:5173';
const INVALID_FRONTEND_ORIGIN = 'http://attacker.example';
const AUTH_WEBSOCKET_INTEGRATION_TIMEOUT_MS = 60_000;
const CLIENT_EVENT_TIMEOUT_MS = 10_000;
const NO_EARLY_MESSAGE_WINDOW_MS = 100;
const COMMIT_POLL_ATTEMPTS = 100;
const COMMIT_POLL_INTERVAL_MS = 10;
const ARCHIVED_BOARD_VERSION = 2;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_ABNORMAL = 1006;
const PRESENCE_BURST_MULTIPLIER = 2;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const SCHEMA = `archboard_p403_${process.pid}`;

jest.setTimeout(AUTH_WEBSOCKET_INTEGRATION_TIMEOUT_MS);

function scopedUrl(directUrl: string): string {
  const url = new URL(directUrl);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return url.toString();
}

function integrationConfig(url: string): ApiConfig {
  return loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: 'http://localhost:3000',
    ALLOWED_WEB_ORIGINS: ALLOWED_FRONTEND_ORIGIN,
    PORT: '3000',
    DATABASE_URL: url,
    DATABASE_DIRECT_URL: url,
    BETTER_AUTH_SECRET: 'auth-websocket-integration-secret-32chars',
  });
}

function websocketOptions(origin: string, cookie?: string): ClientOptions {
  return cookie === undefined ? { origin } : { origin, headers: { cookie } };
}

function waitForOpen(websocket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket open.')),
      CLIENT_EVENT_TIMEOUT_MS,
    );
    websocket.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    websocket.once('error', reject);
  });
}

function waitForMessage(websocket: WebSocket): Promise<RawData> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for a WebSocket message.')),
      CLIENT_EVENT_TIMEOUT_MS,
    );
    websocket.once('message', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
    websocket.once('error', reject);
  });
}

function waitForEvent(websocket: WebSocket, event: string) {
  return new Promise<ReturnType<typeof serverMessageSchema.parse>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      websocket.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, CLIENT_EVENT_TIMEOUT_MS);
    const onMessage = (raw: RawData) => {
      const message = serverMessageSchema.parse(JSON.parse(raw.toString()));
      if (message.event !== event) return;
      clearTimeout(timeout);
      websocket.off('message', onMessage);
      resolve(message);
    };
    websocket.on('message', onMessage);
  });
}

function waitForClose(websocket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket close.')),
      CLIENT_EVENT_TIMEOUT_MS,
    );
    websocket.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    websocket.once('error', () => undefined);
  });
}

function closeWebSocket(websocket: WebSocket): Promise<void> {
  if (websocket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    websocket.once('close', () => resolve());
    websocket.close();
  });
}

function rejectedUpgradeStatus(url: string, options: ClientOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url, options);
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for a rejected upgrade.')),
      CLIENT_EVENT_TIMEOUT_MS,
    );
    websocket.once('open', () => {
      clearTimeout(timeout);
      websocket.terminate();
      reject(new Error('Expected the WebSocket upgrade to be rejected.'));
    });
    websocket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      const status = response.statusCode;
      response.resume();
      websocket.terminate();
      if (status === undefined) reject(new Error('Rejected upgrade omitted its HTTP status.'));
      else resolve(status);
    });
    websocket.once('error', () => undefined);
  });
}

async function joinRoom(url: string, cookie: string) {
  const socket = new WebSocket(url, websocketOptions(ALLOWED_FRONTEND_ORIGIN, cookie));
  await waitForOpen(socket);
  const responsePromise = waitForMessage(socket);
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
  const response = serverMessageSchema.parse(JSON.parse((await responsePromise).toString()));
  if (response.event !== SERVER_EVENT_NAMES.READY) throw new Error('Expected room ready.');
  return { socket, ready: response.data };
}

function makeNodeUpdate(snapshotBase64: string, title: string) {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, Buffer.from(snapshotBase64, 'base64'));
    const before = Y.encodeStateVector(document);
    const nodeId = randomUUID();
    createNode(document, {
      id: nodeId,
      kind: 'component',
      position: { x: 0, y: 0 },
      size: { width: 240, height: 140 },
      title,
      color: COLOR_TOKENS.BLUE,
      content: {
        category: COMPONENT_CATEGORIES.SERVICE,
        description: '',
        technology: 'TypeScript',
        externalUrl: null,
      },
    });
    return { bytes: Y.encodeStateAsUpdate(document, before), nodeId };
  } finally {
    document.destroy();
  }
}

async function sendUpdate(socket: WebSocket, updateId: string, bytes: Uint8Array) {
  const responsePromise = waitForMessage(socket);
  socket.send(
    JSON.stringify({
      event: 'update',
      data: { updateId, updateBase64: Buffer.from(bytes).toString('base64') },
    }),
  );
  return serverMessageSchema.parse(JSON.parse((await responsePromise).toString()));
}

describe('authenticated Nest collaboration WebSocket gateway', () => {
  let admin: Pool;
  let database: DataSource;
  let application: NestExpressApplication;
  let websocketUrl: string;
  let authUrl: string;
  let sessionCookie: string;
  let nonmemberCookie: string;
  let viewerCookie: string;
  let nonmemberId: string;
  let ownerId: string;
  let viewerId: string;
  let boardId: string;
  let testEmail: string;

  beforeAll(async () => {
    const directUrl = process.env.DATABASE_DIRECT_URL;
    if (!directUrl) throw new Error('DATABASE_DIRECT_URL is required for socket integration.');
    admin = new Pool({ connectionString: directUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    const url = scopedUrl(directUrl);
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
      extra: { options: `-c search_path=${SCHEMA}` },
    });
    await database.initialize();
    await database.runMigrations({ transaction: 'all' });
    const config = integrationConfig(url);
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureCollaborationWebSockets(application);
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.listen(0, '127.0.0.1');

    const address = application.getHttpServer().address() as AddressInfo;
    authUrl = `http://127.0.0.1:${address.port}`;
    boardId = randomUUID();
    websocketUrl = `ws://127.0.0.1:${address.port}/ws/boards/${boardId}`;

    testEmail = `auth-websocket-${randomUUID()}@example.com`;
    const response = await fetch(`${authUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_FRONTEND_ORIGIN,
      },
      body: JSON.stringify({
        name: 'WebSocket Integration',
        email: testEmail,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_FRONTEND_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('content-type')).toContain('application/json');

    const sessionHeader = response.headers
      .getSetCookie()
      .find((header) => header.includes('.session_token='));
    expect(sessionHeader).toContain('HttpOnly');
    sessionCookie = sessionHeader!.split(';', 1)[0]!;
    const users = (await database.query('SELECT id FROM "user" WHERE email = $1', [testEmail])) as {
      id: string;
    }[];
    ownerId = users[0]!.id;
    const now = new Date();
    await database.getRepository(BoardEntity).save({
      id: boardId,
      ownerUserId: ownerId,
      title: 'Socket room',
      description: '',
      archivedAt: null,
      metadataVersion: 1,
      latestSeq: '0',
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.getRepository(BoardSnapshotEntity).save({
      boardId,
      ...createEmptyBoardSnapshot(),
      updatedAt: now,
    });
    const nonmemberEmail = `nonmember-${randomUUID()}@example.com`;
    const nonmember = await fetch(`${authUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_FRONTEND_ORIGIN },
      body: JSON.stringify({
        name: 'Nonmember',
        email: nonmemberEmail,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(nonmember.status).toBe(HTTP_OK);
    nonmemberCookie = nonmember.headers
      .getSetCookie()
      .find((header) => header.includes('.session_token='))!
      .split(';', 1)[0]!;
    const nonmemberUsers = (await database.query('SELECT id FROM "user" WHERE email = $1', [
      nonmemberEmail,
    ])) as { id: string }[];
    nonmemberId = nonmemberUsers[0]!.id;
    const viewerEmail = `viewer-${randomUUID()}@example.com`;
    const viewer = await fetch(`${authUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_FRONTEND_ORIGIN },
      body: JSON.stringify({
        name: 'Viewer',
        email: viewerEmail,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(viewer.status).toBe(HTTP_OK);
    viewerCookie = viewer.headers
      .getSetCookie()
      .find((header) => header.includes('.session_token='))!
      .split(';', 1)[0]!;
    const viewerUsers = (await database.query('SELECT id FROM "user" WHERE email = $1', [
      viewerEmail,
    ])) as { id: string }[];
    viewerId = viewerUsers[0]!.id;
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

  async function createUpdateBoard(withViewer = false) {
    const id = randomUUID();
    const now = new Date();
    await database.getRepository(BoardEntity).save({
      id,
      ownerUserId: ownerId,
      title: 'Update room',
      description: '',
      archivedAt: null,
      metadataVersion: 1,
      latestSeq: '0',
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.getRepository(BoardSnapshotEntity).save({
      boardId: id,
      ...createEmptyBoardSnapshot(),
      updatedAt: now,
    });
    if (withViewer) {
      await database.query(
        'INSERT INTO "board_members" ("board_id", "user_id", "role") VALUES ($1, $2, $3)',
        [id, viewerId, 'viewer'],
      );
    }
    return { id, url: websocketUrl.replace(boardId, id) };
  }

  it('bounds session-derived presence, isolates rooms, drops excess traffic, and never writes graph data', async () => {
    const board = await createUpdateBoard(true);
    const other = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    const viewer = await joinRoom(board.url, viewerCookie);
    const outsider = await joinRoom(other.url, sessionCookie);
    const before = await database.getRepository(BoardEntity).findOneByOrFail({ id: board.id });
    const presence = {
      cursor: { x: 120, y: -50 },
      selectedIds: Array.from({ length: MAX_PRESENCE_SELECTED_IDS }, () => randomUUID()),
      dragPreview: {
        positions: Array.from({ length: MAX_DRAG_PREVIEW_POSITIONS }, () => ({
          id: randomUUID(),
          position: { x: 5, y: 10 },
        })),
      },
    };
    const received: unknown[] = [];
    const otherMessages: unknown[] = [];
    viewer.socket.on('message', (raw) => received.push(JSON.parse(raw.toString())));
    outsider.socket.on('message', (raw) => otherMessages.push(JSON.parse(raw.toString())));
    try {
      const broadcast = waitForEvent(viewer.socket, SERVER_EVENT_NAMES.PRESENCE);
      owner.socket.send(JSON.stringify({ event: 'presence', data: presence }));
      const message = await broadcast;
      expect(message).toMatchObject({
        event: 'presence',
        data: {
          connectionId: owner.ready.connectionId,
          user: { id: ownerId },
          presence,
        },
      });
      if (message.event !== SERVER_EVENT_NAMES.PRESENCE) throw new Error('Presence expected.');
      expect(message.data.user.name.length).toBeGreaterThan(0);
      expect(Date.parse(message.data.expiresAt)).toBeGreaterThan(Date.now());
      for (
        let index = 0;
        index < PRESENCE_UPDATES_PER_SECOND * PRESENCE_BURST_MULTIPLIER;
        index += 1
      ) {
        owner.socket.send(JSON.stringify({ event: 'presence', data: presence }));
      }
      await new Promise((resolve) => setTimeout(resolve, NO_EARLY_MESSAGE_WINDOW_MS));
      expect(received).toHaveLength(PRESENCE_UPDATES_PER_SECOND);
      expect(otherMessages).toEqual([]);
      const after = await database.getRepository(BoardEntity).findOneByOrFail({ id: board.id });
      expect(after.latestSeq).toBe(before.latestSeq);
      expect(after.contentUpdatedAt).toEqual(before.contentUpdatedAt);
      expect(await database.getRepository(BoardUpdateEntity).countBy({ boardId: board.id })).toBe(
        0,
      );
      expect(await database.getRepository(UpdateReceiptEntity).countBy({ boardId: board.id })).toBe(
        0,
      );
      const reservation = await application.get(CollaborationRoomRegistry).reserve(board.id);
      expect(projectGraphDocument(reservation.room.document).nodes).toHaveLength(0);
      reservation.release();
      const removal = waitForEvent(viewer.socket, SERVER_EVENT_NAMES.PRESENCE);
      await closeWebSocket(owner.socket);
      const expired = await removal;
      expect(expired).toMatchObject({
        event: 'presence',
        data: {
          connectionId: owner.ready.connectionId,
          presence: { cursor: null, selectedIds: [], dragPreview: null },
        },
      });
      if (expired.event === SERVER_EVENT_NAMES.PRESENCE) {
        expect(Date.parse(expired.data.expiresAt)).toBeLessThanOrEqual(Date.now());
      }
    } finally {
      await Promise.all([owner.socket, viewer.socket, outsider.socket].map(closeWebSocket));
    }
  });

  it('rejects spoofed presence identity and oversized selections before broadcast', async () => {
    const board = await createUpdateBoard();
    const peer = await joinRoom(board.url, sessionCookie);
    const messages: unknown[] = [];
    peer.socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    try {
      for (const data of [
        { cursor: null, selectedIds: [], dragPreview: null, user: { id: 'spoofed' } },
        {
          cursor: null,
          selectedIds: Array.from({ length: MAX_PRESENCE_SELECTED_IDS + 1 }, () => randomUUID()),
          dragPreview: null,
        },
        { cursor: { x: Infinity, y: 0 }, selectedIds: [], dragPreview: null },
      ]) {
        const sender = await joinRoom(board.url, sessionCookie);
        const closed = waitForClose(sender.socket);
        sender.socket.send(JSON.stringify({ event: 'presence', data }));
        expect(await closed).toBe(CLOSE_POLICY_VIOLATION);
      }
      expect(messages).toEqual([]);
    } finally {
      await closeWebSocket(peer.socket);
    }
  });

  async function changeArchiveOverHttp(
    boardId: string,
    action: 'archive' | 'restore',
    expectedVersion: number,
  ) {
    const response = await fetch(`${authUrl}/api/v1/boards/${boardId}/${action}`, {
      method: 'POST',
      headers: {
        origin: ALLOWED_FRONTEND_ORIGIN,
        cookie: sessionCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion }),
    });
    expect(response.status).toBe(HTTP_OK);
  }

  it('preserves the session cookie and opens from the exact credentialed frontend origin', async () => {
    const websocket = new WebSocket(
      websocketUrl,
      websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
    );
    await waitForOpen(websocket);

    let disclosedMessages = 0;
    websocket.on('message', () => {
      disclosedMessages += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, NO_EARLY_MESSAGE_WINDOW_MS));
    expect(disclosedMessages).toBe(0);

    const responsePromise = waitForMessage(websocket);
    websocket.send(
      JSON.stringify({
        event: 'hello',
        data: {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: GRAPH_SCHEMA_VERSION,
          tabId: randomUUID(),
        },
      }),
    );
    const response = serverMessageSchema.parse(JSON.parse((await responsePromise).toString()));
    expect(response.event).toBe(SERVER_EVENT_NAMES.READY);
    if (response.event === SERVER_EVENT_NAMES.READY) {
      expect(response.data.role).toBe('owner');
      expect(response.data.latestSeq).toBe('0');
      const document = new Y.Doc();
      Y.applyUpdate(document, Buffer.from(response.data.snapshotBase64, 'base64'));
      validateGraphDocument(document);
      expect(projectGraphDocument(document).nodes).toEqual([]);
    }
    expect(disclosedMessages).toBe(1);
    await closeWebSocket(websocket);
  });

  it('rejects an anonymous upgrade without opening a graph channel', async () => {
    await expect(
      rejectedUpgradeStatus(websocketUrl, websocketOptions(ALLOWED_FRONTEND_ORIGIN)),
    ).resolves.toBe(HTTP_UNAUTHORIZED);
  });

  it('rejects an invalid session cookie without opening a graph channel', async () => {
    await expect(
      rejectedUpgradeStatus(
        websocketUrl,
        websocketOptions(ALLOWED_FRONTEND_ORIGIN, 'better-auth.session_token=invalid'),
      ),
    ).resolves.toBe(HTTP_UNAUTHORIZED);
  });

  it('rejects an invalid origin without opening a graph channel', async () => {
    await expect(
      rejectedUpgradeStatus(websocketUrl, websocketOptions(INVALID_FRONTEND_ORIGIN, sessionCookie)),
    ).resolves.toBe(HTTP_FORBIDDEN);
  });

  it('gives nonmembers and missing boards the same denial without graph bytes', async () => {
    await expect(
      rejectedUpgradeStatus(
        websocketUrl,
        websocketOptions(ALLOWED_FRONTEND_ORIGIN, nonmemberCookie),
      ),
    ).resolves.toBe(HTTP_NOT_FOUND);
    const missingUrl = websocketUrl.replace(boardId, randomUUID());
    await expect(
      rejectedUpgradeStatus(missingUrl, websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie)),
    ).resolves.toBe(HTTP_NOT_FOUND);
  });

  it('rejects an expired real session before opening a graph channel', async () => {
    await database.query('UPDATE "session" SET "expiresAt" = $1 WHERE "userId" = $2', [
      new Date(0),
      nonmemberId,
    ]);
    await expect(
      rejectedUpgradeStatus(
        websocketUrl,
        websocketOptions(ALLOWED_FRONTEND_ORIGIN, nonmemberCookie),
      ),
    ).resolves.toBe(HTTP_UNAUTHORIZED);
  });

  it('rejects an unsupported hello version without a ready snapshot', async () => {
    const websocket = new WebSocket(
      websocketUrl,
      websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
    );
    await waitForOpen(websocket);
    const responsePromise = waitForMessage(websocket);
    websocket.send(
      JSON.stringify({
        event: 'hello',
        data: {
          protocolVersion: PROTOCOL_VERSION + 1,
          schemaVersion: GRAPH_SCHEMA_VERSION,
          tabId: randomUUID(),
        },
      }),
    );
    const response = serverMessageSchema.parse(JSON.parse((await responsePromise).toString()));
    expect(response.event).toBe(SERVER_EVENT_NAMES.ERROR);
    if (response.event === SERVER_EVENT_NAMES.ERROR) {
      expect(response.data.code).toBe(ERROR_CODES.SCHEMA_UNSUPPORTED);
    }
    await closeWebSocket(websocket);
  });

  it('requires hello within five seconds before disclosing a snapshot', async () => {
    const websocket = new WebSocket(
      websocketUrl,
      websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
    );
    let messages = 0;
    websocket.on('message', () => {
      messages += 1;
    });
    await waitForOpen(websocket);
    const closePromise = waitForClose(websocket);
    await expect(closePromise).resolves.toBe(CLOSE_POLICY_VIOLATION);
    expect(messages).toBe(0);
  });

  it('caps room connections at the shared limit', async () => {
    const sockets: WebSocket[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    try {
      for (let index = 0; index < MAX_BOARD_CONNECTIONS; index += 1) {
        const websocket = new WebSocket(
          websocketUrl,
          websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
        );
        sockets.push(websocket);
        websocket.on('close', (code, reason) => closes.push({ code, reason: reason.toString() }));
        await waitForOpen(websocket);
        const responsePromise = waitForMessage(websocket);
        websocket.send(
          JSON.stringify({
            event: 'hello',
            data: {
              protocolVersion: PROTOCOL_VERSION,
              schemaVersion: GRAPH_SCHEMA_VERSION,
              tabId: randomUUID(),
            },
          }),
        );
        const response = serverMessageSchema.parse(JSON.parse((await responsePromise).toString()));
        expect(response.event).toBe(SERVER_EVENT_NAMES.READY);
        expect({ states: sockets.map((socket) => socket.readyState), closes }).toEqual({
          states: Array.from({ length: index + 1 }, () => WebSocket.OPEN),
          closes: [],
        });
        expect(application.get(CollaborationRoomRegistry).connectionCount(boardId)).toBe(index + 1);
      }
      const excess = new WebSocket(
        websocketUrl,
        websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
      );
      sockets.push(excess);
      await waitForOpen(excess);
      const responsePromise = waitForMessage(excess);
      excess.send(
        JSON.stringify({
          event: 'hello',
          data: {
            protocolVersion: PROTOCOL_VERSION,
            schemaVersion: GRAPH_SCHEMA_VERSION,
            tabId: randomUUID(),
          },
        }),
      );
      const response = serverMessageSchema.parse(JSON.parse((await responsePromise).toString()));
      expect(response.event).toBe(SERVER_EVENT_NAMES.ERROR);
      if (response.event === SERVER_EVENT_NAMES.ERROR)
        expect(response.data.code).toBe(ERROR_CODES.ROOM_FULL);
    } finally {
      await Promise.all(sockets.map(closeWebSocket));
    }
  });

  it('closes malformed strict envelopes without disclosing graph data', async () => {
    const websocket = new WebSocket(
      websocketUrl,
      websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
    );
    let disclosedMessages = 0;
    websocket.on('message', () => {
      disclosedMessages += 1;
    });
    await waitForOpen(websocket);
    const closePromise = waitForClose(websocket);
    websocket.send(JSON.stringify({ event: 'hello', data: { extra: true } }));
    await expect(closePromise).resolves.toBe(CLOSE_POLICY_VIOLATION);
    expect(disclosedMessages).toBe(0);
  });

  it('enforces the named frame limit without disclosing graph data', async () => {
    const websocket = new WebSocket(
      websocketUrl,
      websocketOptions(ALLOWED_FRONTEND_ORIGIN, sessionCookie),
    );
    let disclosedMessages = 0;
    websocket.on('message', () => {
      disclosedMessages += 1;
    });
    await waitForOpen(websocket);
    const closePromise = waitForClose(websocket);
    websocket.send(Buffer.alloc(MAX_WS_FRAME_BYTES + 1));
    await expect(closePromise).resolves.toBe(CLOSE_MESSAGE_TOO_BIG);
    expect(disclosedMessages).toBe(0);
  });

  it('commits once, ACKs the sender, broadcasts to a peer, and returns the original receipt on retry', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    const peer = await joinRoom(board.url, sessionCookie);
    try {
      const updateId = randomUUID();
      const { bytes, nodeId } = makeNodeUpdate(owner.ready.snapshotBase64, 'Durable socket node');
      const peerMessage = waitForMessage(peer.socket);
      void peerMessage.catch(() => undefined);
      const acknowledgement = await sendUpdate(owner.socket, updateId, bytes);
      if (acknowledgement.event === SERVER_EVENT_NAMES.ERROR)
        throw new Error(`First update failed: ${JSON.stringify(acknowledgement.data)}`);
      expect(acknowledgement).toMatchObject({
        event: SERVER_EVENT_NAMES.ACK,
        data: { updateId, seq: '1' },
      });
      const broadcast = serverMessageSchema.parse(JSON.parse((await peerMessage).toString()));
      expect(broadcast).toMatchObject({ event: SERVER_EVENT_NAMES.UPDATE, data: { seq: '1' } });
      if (broadcast.event === SERVER_EVENT_NAMES.UPDATE)
        expect(Buffer.from(broadcast.data.updateBase64, 'base64')).toEqual(Buffer.from(bytes));

      const rows = (await database.query(
        `SELECT u."update_bytes", r."payload_hash", r."seq"::text AS "seq"
         FROM "board_updates" u JOIN "update_receipts" r USING ("board_id", "update_id")
         WHERE u."board_id" = $1`,
        [board.id],
      )) as { update_bytes: Buffer; payload_hash: Buffer; seq: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ seq: '1', update_bytes: Buffer.from(bytes) });
      expect(rows[0]!.payload_hash).toEqual(createHash('sha256').update(bytes).digest());
      const room = application.get(CollaborationRoomRegistry);
      const reservation = await room.reserve(board.id);
      expect(reservation.room.latestSeq).toBe('1');
      expect(
        projectGraphDocument(reservation.room.document).nodes.map((node) => node.id),
      ).toContain(nodeId);
      reservation.release();

      let extraPeerMessages = 0;
      peer.socket.on('message', () => {
        extraPeerMessages += 1;
      });
      expect(await sendUpdate(owner.socket, updateId, bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ACK,
        data: { updateId, seq: '1' },
      });
      const different = makeNodeUpdate(owner.ready.snapshotBase64, 'Different payload');
      expect(await sendUpdate(owner.socket, updateId, different.bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.UPDATE_ID_REUSED, updateId },
      });
      await new Promise((resolve) => setTimeout(resolve, NO_EARLY_MESSAGE_WINDOW_MS));
      expect(extraPeerMessages).toBe(0);
      const counts = (await database.query(
        `SELECT (SELECT count(*)::integer FROM "board_updates" WHERE "board_id" = $1) AS updates,
                (SELECT count(*)::integer FROM "update_receipts" WHERE "board_id" = $1) AS receipts,
                (SELECT latest_seq::text FROM "boards" WHERE id = $1) AS seq`,
        [board.id],
      )) as { updates: number; receipts: number; seq: string }[];
      expect(counts[0]).toEqual({ updates: 1, receipts: 1, seq: '1' });
    } finally {
      await Promise.all([closeWebSocket(owner.socket), closeWebSocket(peer.socket)]);
    }
  });

  it('returns a delayed duplicate receipt after compaction deleted the update row', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    try {
      const updateId = randomUUID();
      const { bytes, nodeId } = makeNodeUpdate(owner.ready.snapshotBase64, 'Compacted node');
      expect(await sendUpdate(owner.socket, updateId, bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ACK,
        data: { seq: '1' },
      });
      const reservation = await application.get(CollaborationRoomRegistry).reserve(board.id);
      try {
        await reservation.room.run(async () => {
          const sequence = reservation.room.latestSeq;
          await application
            .get(PostgresRoomCompactor)
            .compact(board.id, sequence, Y.encodeStateAsUpdate(reservation.room.document));
          reservation.room.markCompacted(sequence);
        });
      } finally {
        reservation.release();
      }
      const counts = (await database.query(
        `SELECT s.through_seq::text AS snapshot_seq,
                (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
                (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts
         FROM board_snapshots s WHERE s.board_id = $1`,
        [board.id],
      )) as { snapshot_seq: string; updates: number; receipts: number }[];
      expect(counts[0]).toEqual({ snapshot_seq: '1', updates: 0, receipts: 1 });
      const restarted = await new PostgresRoomLoader(database).load(board.id);
      expect(restarted.latestSeq).toBe('1');
      expect(projectGraphDocument(restarted.document).nodes.map((node) => node.id)).toContain(
        nodeId,
      );
      restarted.document.destroy();
      expect(await sendUpdate(owner.socket, updateId, bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ACK,
        data: { updateId, seq: '1' },
      });
      expect(await database.getRepository(BoardUpdateEntity).countBy({ boardId: board.id })).toBe(
        0,
      );
    } finally {
      await closeWebSocket(owner.socket);
    }
  });

  it('denies viewer writes before receipt lookup or validation without changing the room', async () => {
    const board = await createUpdateBoard(true);
    const owner = await joinRoom(board.url, sessionCookie);
    const viewer = await joinRoom(board.url, viewerCookie);
    try {
      expect(viewer.ready.role).toBe('viewer');
      const { bytes } = makeNodeUpdate(viewer.ready.snapshotBase64, 'Denied viewer node');
      let peerMessages = 0;
      owner.socket.on('message', () => {
        peerMessages += 1;
      });
      const response = await sendUpdate(viewer.socket, randomUUID(), bytes);
      expect(response).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.FORBIDDEN },
      });
      await new Promise((resolve) => setTimeout(resolve, NO_EARLY_MESSAGE_WINDOW_MS));
      expect(peerMessages).toBe(0);
      const room = await application.get(CollaborationRoomRegistry).reserve(board.id);
      expect(room.room.latestSeq).toBe('0');
      expect(projectGraphDocument(room.room.document).nodes).toEqual([]);
      room.release();
      const rows = (await database.query(
        'SELECT latest_seq::text AS seq FROM "boards" WHERE id = $1',
        [board.id],
      )) as { seq: string }[];
      expect(rows[0]!.seq).toBe('0');
      const receipts = (await database.query(
        'SELECT count(*)::integer AS count FROM "update_receipts" WHERE board_id = $1',
        [board.id],
      )) as { count: number }[];
      expect(receipts[0]!.count).toBe(0);
    } finally {
      await Promise.all([closeWebSocket(owner.socket), closeWebSocket(viewer.socket)]);
    }
  });

  it('rolls back a failed commit and accepts the same bytes on retry', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    const peer = await joinRoom(board.url, sessionCookie);
    try {
      const updateId = randomUUID();
      const { bytes } = makeNodeUpdate(owner.ready.snapshotBase64, 'Rollback node');
      let peerMessages = 0;
      peer.socket.on('message', () => {
        peerMessages += 1;
      });
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT);
      expect(await sendUpdate(owner.socket, updateId, bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.PERSISTENCE_FAILED },
      });
      const afterFailure = (await database.query(
        'SELECT latest_seq::text AS seq FROM "boards" WHERE id = $1',
        [board.id],
      )) as { seq: string }[];
      expect(afterFailure[0]!.seq).toBe('0');
      expect(peerMessages).toBe(0);
      const room = await application.get(CollaborationRoomRegistry).reserve(board.id);
      expect(room.room.latestSeq).toBe('0');
      room.release();
      const peerMessage = waitForMessage(peer.socket);
      expect(await sendUpdate(owner.socket, updateId, bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ACK,
        data: { updateId, seq: '1' },
      });
      expect(serverMessageSchema.parse(JSON.parse((await peerMessage).toString()))).toMatchObject({
        event: SERVER_EVENT_NAMES.UPDATE,
        data: { seq: '1' },
      });
      expect(peerMessages).toBe(1);
    } finally {
      await Promise.all([closeWebSocket(owner.socket), closeWebSocket(peer.socket)]);
    }
  });

  it('recovers the original receipt after commit but before ACK', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    const peer = await joinRoom(board.url, sessionCookie);
    const updateId = randomUUID();
    const { bytes, nodeId } = makeNodeUpdate(owner.ready.snapshotBase64, 'Crash boundary node');
    let peerMessages = 0;
    peer.socket.on('message', () => {
      peerMessages += 1;
    });
    try {
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.AFTER_COMMIT_BEFORE_ACK);
      const closed = waitForClose(owner.socket);
      owner.socket.send(
        JSON.stringify({
          event: 'update',
          data: { updateId, updateBase64: Buffer.from(bytes).toString('base64') },
        }),
      );
      await expect(closed).resolves.toBe(CLOSE_ABNORMAL);
      const rows = (await database.query(
        `SELECT "seq"::text AS seq FROM "update_receipts"
         WHERE "board_id" = $1 AND "update_id" = $2`,
        [board.id, updateId],
      )) as { seq: string }[];
      expect(rows).toEqual([{ seq: '1' }]);
      expect(peerMessages).toBe(0);
      await closeWebSocket(peer.socket);

      const resumed = await joinRoom(board.url, sessionCookie);
      try {
        expect(resumed.ready.latestSeq).toBe('1');
        const document = new Y.Doc();
        Y.applyUpdate(document, Buffer.from(resumed.ready.snapshotBase64, 'base64'));
        expect(projectGraphDocument(document).nodes.map((node) => node.id)).toContain(nodeId);
        document.destroy();
        expect(await sendUpdate(resumed.socket, updateId, bytes)).toMatchObject({
          event: SERVER_EVENT_NAMES.ACK,
          data: { updateId, seq: '1' },
        });
        const counts = (await database.query(
          `SELECT (SELECT count(*)::integer FROM "board_updates" WHERE "board_id" = $1) AS updates,
                  (SELECT count(*)::integer FROM "update_receipts" WHERE "board_id" = $1) AS receipts`,
          [board.id],
        )) as { updates: number; receipts: number }[];
        expect(counts[0]).toEqual({ updates: 1, receipts: 1 });
      } finally {
        await closeWebSocket(resumed.socket);
      }
    } finally {
      await Promise.all([closeWebSocket(owner.socket), closeWebSocket(peer.socket)]);
    }
  });

  it('rechecks archive under the board row lock after validation', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    try {
      const { bytes } = makeNodeUpdate(owner.ready.snapshotBase64, 'Archived race node');
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION, async () => {
          await database.query(
            'UPDATE "boards" SET "archived_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
            [board.id],
          );
        });
      expect(await sendUpdate(owner.socket, randomUUID(), bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.BOARD_ARCHIVED },
      });
      const rows = (await database.query(
        `SELECT b."latest_seq"::text AS seq,
                (SELECT count(*)::integer FROM "board_updates" WHERE "board_id" = $1) AS updates,
                (SELECT count(*)::integer FROM "update_receipts" WHERE "board_id" = $1) AS receipts
         FROM "boards" b WHERE b."id" = $1`,
        [board.id],
      )) as { seq: string; updates: number; receipts: number }[];
      expect(rows[0]).toEqual({ seq: '0', updates: 0, receipts: 0 });
      const room = await application.get(CollaborationRoomRegistry).reserve(board.id);
      expect(room.room.latestSeq).toBe('0');
      room.release();
    } finally {
      await closeWebSocket(owner.socket);
    }
  });

  it('keeps archived rooms readable, freezes writes, and resumes after restore', async () => {
    const board = await createUpdateBoard(true);
    const owner = await joinRoom(board.url, sessionCookie);
    const viewer = await joinRoom(board.url, viewerCookie);
    try {
      const ownerChanged = waitForEvent(owner.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      const viewerChanged = waitForEvent(viewer.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      await changeArchiveOverHttp(board.id, 'archive', 1);
      expect(await ownerChanged).toMatchObject({ data: { role: 'owner', archived: true } });
      expect(await viewerChanged).toMatchObject({ data: { role: 'viewer', archived: true } });

      const archivedReader = await joinRoom(board.url, viewerCookie);
      try {
        expect(archivedReader.ready.role).toBe('viewer');
      } finally {
        await closeWebSocket(archivedReader.socket);
      }
      const { bytes } = makeNodeUpdate(owner.ready.snapshotBase64, 'Archived write');
      expect(await sendUpdate(owner.socket, randomUUID(), bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.BOARD_ARCHIVED },
      });
      const restored = waitForEvent(owner.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      await changeArchiveOverHttp(board.id, 'restore', ARCHIVED_BOARD_VERSION);
      expect(await restored).toMatchObject({ data: { role: 'owner', archived: false } });
      expect(await sendUpdate(owner.socket, randomUUID(), bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ACK,
        data: { seq: '1' },
      });
    } finally {
      await Promise.all([closeWebSocket(owner.socket), closeWebSocket(viewer.socket)]);
    }
  });

  it('updates an editor role and closes a removed member after commit', async () => {
    const board = await createUpdateBoard(true);
    await application
      .get(BoardService)
      .changeMemberRole(ownerId, board.id, viewerId, { role: 'editor' });
    const editor = await joinRoom(board.url, viewerCookie);
    try {
      expect(editor.ready.role).toBe('editor');
      const demoted = waitForEvent(editor.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      await application
        .get(BoardService)
        .changeMemberRole(ownerId, board.id, viewerId, { role: 'viewer' });
      expect(await demoted).toMatchObject({ data: { role: 'viewer', archived: false } });
      const { bytes } = makeNodeUpdate(editor.ready.snapshotBase64, 'Demoted write');
      expect(await sendUpdate(editor.socket, randomUUID(), bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.FORBIDDEN },
      });
      const removed = waitForEvent(editor.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      const closed = waitForClose(editor.socket);
      await application.get(BoardService).removeMember(ownerId, board.id, viewerId);
      expect(await removed).toMatchObject({ data: { role: null, archived: false } });
      await expect(closed).resolves.toBe(CLOSE_POLICY_VIOLATION);
      await expect(
        rejectedUpgradeStatus(board.url, websocketOptions(ALLOWED_FRONTEND_ORIGIN, viewerCookie)),
      ).resolves.toBe(HTTP_NOT_FOUND);
      const rows = (await database.query(
        `SELECT b.latest_seq::text AS seq,
                (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
                (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts
         FROM boards b WHERE b.id = $1`,
        [board.id],
      )) as { seq: string; updates: number; receipts: number }[];
      expect(rows[0]).toEqual({ seq: '0', updates: 0, receipts: 0 });
    } finally {
      await closeWebSocket(editor.socket);
    }
  });

  it('rejects an update when archive commits while validation is paused', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atBarrier = new Promise<void>((resolve) => {
      reached = resolve;
    });
    try {
      const { bytes } = makeNodeUpdate(owner.ready.snapshotBase64, 'Losing archive race');
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION, async () => {
          reached();
          await held;
        });
      const rejected = waitForEvent(owner.socket, SERVER_EVENT_NAMES.ERROR);
      owner.socket.send(
        JSON.stringify({
          event: 'update',
          data: {
            updateId: randomUUID(),
            updateBase64: Buffer.from(bytes).toString('base64'),
          },
        }),
      );
      await atBarrier;
      const changed = waitForEvent(owner.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      const archive = application
        .get(BoardService)
        .archive(ownerId, board.id, { expectedVersion: 1 });
      for (let attempt = 0; attempt < COMMIT_POLL_ATTEMPTS; attempt += 1) {
        const rows = (await database.query('SELECT archived_at FROM boards WHERE id = $1', [
          board.id,
        ])) as { archived_at: Date | null }[];
        if (rows[0]?.archived_at !== null) break;
        await new Promise((resolve) => setTimeout(resolve, COMMIT_POLL_INTERVAL_MS));
      }
      const archived = (await database.query('SELECT archived_at FROM boards WHERE id = $1', [
        board.id,
      ])) as { archived_at: Date | null }[];
      expect(archived[0]?.archived_at).not.toBeNull();
      release();
      await archive;
      expect(await changed).toMatchObject({ data: { archived: true } });
      expect(await rejected).toMatchObject({ data: { code: ERROR_CODES.BOARD_ARCHIVED } });
      const rows = (await database.query(
        `SELECT b.latest_seq::text AS seq,
                (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
                (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts
         FROM boards b WHERE b.id = $1`,
        [board.id],
      )) as { seq: string; updates: number; receipts: number }[];
      expect(rows[0]).toEqual({ seq: '0', updates: 0, receipts: 0 });
    } finally {
      release();
      await closeWebSocket(owner.socket);
    }
  });

  it('commits an update before a waiting archive and rejects the next update', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atBarrier = new Promise<void>((resolve) => {
      reached = resolve;
    });
    try {
      const { bytes } = makeNodeUpdate(owner.ready.snapshotBase64, 'Winning archive race');
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT, async () => {
          reached();
          await held;
        });
      const acknowledged = waitForEvent(owner.socket, SERVER_EVENT_NAMES.ACK);
      owner.socket.send(
        JSON.stringify({
          event: 'update',
          data: {
            updateId: randomUUID(),
            updateBase64: Buffer.from(bytes).toString('base64'),
          },
        }),
      );
      await atBarrier;
      const changed = waitForEvent(owner.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      const archive = application
        .get(BoardService)
        .archive(ownerId, board.id, { expectedVersion: 1 });
      release();
      expect(await acknowledged).toMatchObject({ data: { seq: '1' } });
      await archive;
      expect(await changed).toMatchObject({ data: { archived: true } });
      const later = makeNodeUpdate(owner.ready.snapshotBase64, 'Post archive write');
      expect(await sendUpdate(owner.socket, randomUUID(), later.bytes)).toMatchObject({
        data: { code: ERROR_CODES.BOARD_ARCHIVED },
      });
      const rows = (await database.query(
        `SELECT b.latest_seq::text AS seq,
                (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
                (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts
         FROM boards b WHERE b.id = $1`,
        [board.id],
      )) as { seq: string; updates: number; receipts: number }[];
      expect(rows[0]).toEqual({ seq: '1', updates: 1, receipts: 1 });
    } finally {
      release();
      await closeWebSocket(owner.socket);
    }
  });

  it('rejects an editor update when removal commits during validation', async () => {
    const board = await createUpdateBoard(true);
    await application
      .get(BoardService)
      .changeMemberRole(ownerId, board.id, viewerId, { role: 'editor' });
    const editor = await joinRoom(board.url, viewerCookie);
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atBarrier = new Promise<void>((resolve) => {
      reached = resolve;
    });
    try {
      const { bytes } = makeNodeUpdate(editor.ready.snapshotBase64, 'Removed editor write');
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION, async () => {
          reached();
          await held;
        });
      const rejected = waitForEvent(editor.socket, SERVER_EVENT_NAMES.ERROR);
      const changed = waitForEvent(editor.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      const closed = waitForClose(editor.socket);
      editor.socket.send(
        JSON.stringify({
          event: 'update',
          data: {
            updateId: randomUUID(),
            updateBase64: Buffer.from(bytes).toString('base64'),
          },
        }),
      );
      await atBarrier;
      const removal = application.get(BoardService).removeMember(ownerId, board.id, viewerId);
      for (let attempt = 0; attempt < COMMIT_POLL_ATTEMPTS; attempt += 1) {
        const rows = (await database.query(
          'SELECT count(*)::integer AS count FROM board_members WHERE board_id = $1 AND user_id = $2',
          [board.id, viewerId],
        )) as { count: number }[];
        if (rows[0]?.count === 0) break;
        await new Promise((resolve) => setTimeout(resolve, COMMIT_POLL_INTERVAL_MS));
      }
      const members = (await database.query(
        'SELECT count(*)::integer AS count FROM board_members WHERE board_id = $1 AND user_id = $2',
        [board.id, viewerId],
      )) as { count: number }[];
      expect(members[0]?.count).toBe(0);
      release();
      expect(await rejected).toMatchObject({ data: { code: ERROR_CODES.NOT_FOUND } });
      await removal;
      expect(await changed).toMatchObject({ data: { role: null } });
      await expect(closed).resolves.toBe(CLOSE_POLICY_VIOLATION);
      const rows = (await database.query(
        `SELECT b.latest_seq::text AS seq,
                (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
                (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts
         FROM boards b WHERE b.id = $1`,
        [board.id],
      )) as { seq: string; updates: number; receipts: number }[];
      expect(rows[0]).toEqual({ seq: '0', updates: 0, receipts: 0 });
    } finally {
      release();
      await closeWebSocket(editor.socket);
    }
  });

  it('commits an editor update before a waiting removal, then closes the socket', async () => {
    const board = await createUpdateBoard(true);
    await application
      .get(BoardService)
      .changeMemberRole(ownerId, board.id, viewerId, { role: 'editor' });
    const editor = await joinRoom(board.url, viewerCookie);
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atBarrier = new Promise<void>((resolve) => {
      reached = resolve;
    });
    try {
      const { bytes } = makeNodeUpdate(editor.ready.snapshotBase64, 'Last editor write');
      application
        .get(DurableUpdateFailpointController)
        .arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT, async () => {
          reached();
          await held;
        });
      const acknowledged = waitForEvent(editor.socket, SERVER_EVENT_NAMES.ACK);
      const changed = waitForEvent(editor.socket, SERVER_EVENT_NAMES.ACCESS_CHANGED);
      const closed = waitForClose(editor.socket);
      editor.socket.send(
        JSON.stringify({
          event: 'update',
          data: {
            updateId: randomUUID(),
            updateBase64: Buffer.from(bytes).toString('base64'),
          },
        }),
      );
      await atBarrier;
      const removal = application.get(BoardService).removeMember(ownerId, board.id, viewerId);
      release();
      expect(await acknowledged).toMatchObject({ data: { seq: '1' } });
      await removal;
      expect(await changed).toMatchObject({ data: { role: null } });
      await expect(closed).resolves.toBe(CLOSE_POLICY_VIOLATION);
      const rows = (await database.query(
        `SELECT b.latest_seq::text AS seq,
                (SELECT count(*)::integer FROM board_updates WHERE board_id = $1) AS updates,
                (SELECT count(*)::integer FROM update_receipts WHERE board_id = $1) AS receipts
         FROM boards b WHERE b.id = $1`,
        [board.id],
      )) as { seq: string; updates: number; receipts: number }[];
      expect(rows[0]).toEqual({ seq: '1', updates: 1, receipts: 1 });
    } finally {
      release();
      await closeWebSocket(editor.socket);
    }
  });

  it('rejects a write when the session expires after ready', async () => {
    const board = await createUpdateBoard();
    const owner = await joinRoom(board.url, sessionCookie);
    try {
      const { bytes } = makeNodeUpdate(owner.ready.snapshotBase64, 'Expired session node');
      await database.query('UPDATE "session" SET "expiresAt" = $1 WHERE "userId" = $2', [
        new Date(0),
        ownerId,
      ]);
      expect(await sendUpdate(owner.socket, randomUUID(), bytes)).toMatchObject({
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: ERROR_CODES.UNAUTHENTICATED },
      });
      const rows = (await database.query(
        'SELECT latest_seq::text AS seq FROM "boards" WHERE id = $1',
        [board.id],
      )) as { seq: string }[];
      expect(rows[0]!.seq).toBe('0');
    } finally {
      await closeWebSocket(owner.socket);
    }
  });
});
