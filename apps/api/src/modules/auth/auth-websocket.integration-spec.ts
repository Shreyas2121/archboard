import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  GRAPH_SCHEMA_VERSION,
  ERROR_CODES,
  MAX_WS_FRAME_BYTES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  serverMessageSchema,
} from '@archboard/contracts';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import WebSocket from 'ws';
import type { ClientOptions, RawData } from 'ws';

import { AppModule } from '../../app.module.js';
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

jest.setTimeout(AUTH_WEBSOCKET_INTEGRATION_TIMEOUT_MS);

function integrationConfig(): ApiConfig {
  return loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: 'http://localhost:3000',
    ALLOWED_WEB_ORIGINS: ALLOWED_FRONTEND_ORIGIN,
    PORT: '3000',
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
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

describe('Better Auth native WebSocket upgrade', () => {
  let application: NestExpressApplication;
  let websocketUrl: string;
  let authUrl: string;
  let sessionCookie: string;
  let testEmail: string;

  beforeAll(async () => {
    const config = integrationConfig();
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.listen(0, '127.0.0.1');

    const address = application.getHttpServer().address() as AddressInfo;
    authUrl = `http://127.0.0.1:${address.port}`;
    websocketUrl = `ws://127.0.0.1:${address.port}/ws/boards/${randomUUID()}`;

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
  });

  afterAll(async () => {
    try {
      await application?.close();
    } finally {
      if (testEmail !== undefined && process.env.DATABASE_DIRECT_URL !== undefined) {
        const cleanupPool = new Pool({ connectionString: process.env.DATABASE_DIRECT_URL, max: 1 });
        try {
          await cleanupPool.query('DELETE FROM "user" WHERE "email" = $1', [testEmail]);
        } finally {
          await cleanupPool.end();
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
    expect(response.event).toBe(SERVER_EVENT_NAMES.ERROR);
    if (response.event === SERVER_EVENT_NAMES.ERROR) {
      expect(response.data.code).toBe(ERROR_CODES.SERVER_BUSY);
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
