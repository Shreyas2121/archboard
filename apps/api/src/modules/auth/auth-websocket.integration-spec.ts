import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  GRAPH_SCHEMA_VERSION,
  ERROR_CODES,
  MAX_BOARD_CONNECTIONS,
  MAX_WS_FRAME_BYTES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  serverMessageSchema,
} from '@archboard/contracts';
import { projectGraphDocument, validateGraphDocument } from '@archboard/document-model';
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
import { BoardEntity } from '../boards/infrastructure/entities/board.entity.js';
import { createEmptyBoardSnapshot } from '../boards/infrastructure/empty-board-snapshot.js';
import { BoardSnapshotEntity } from '../collaboration/infrastructure/entities/board-snapshot.entity.js';
import { CollaborationRoomRegistry } from '../collaboration/application/room-registry.js';
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
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
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

describe('authenticated Nest collaboration WebSocket gateway', () => {
  let admin: Pool;
  let database: DataSource;
  let application: NestExpressApplication;
  let websocketUrl: string;
  let authUrl: string;
  let sessionCookie: string;
  let nonmemberCookie: string;
  let nonmemberId: string;
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
      migrations: [InitialDatabaseFoundation1789300000000],
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
    const ownerId = users[0]!.id;
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
});
