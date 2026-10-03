import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import {
  ERROR_CODES,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardInviteResponseSchema,
  boardListResponseSchema,
  currentUserResponseSchema,
  invitePreviewResponseSchema,
} from '@archboard/contracts';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { AppModule } from '../../app.module.js';
import { configureCollaborationWebSockets } from '../../modules/collaboration/infrastructure/websocket/index.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { BetterAuthRuntime, configureAuthHttp } from '../../modules/auth/index.js';
import { loadApiConfig } from '../config/index.js';
import { DATABASE_ENTITIES } from '../database/database-entities.js';

const ORIGIN = 'http://localhost:5173';
const SCHEMA_SUFFIX_LENGTH = 8;
const TEST_TIMEOUT_MS = 90_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNAVAILABLE = 503;
const HTTP_RATE_LIMITED = 429;
const LARGE_BODY_CHARACTERS = 70_000;
const LARGE_QUERY_CHARACTERS = 2_100;
const MINIMUM_SECRET_LENGTH = 8;
const INVITE_REQUEST_BURST = 122;
const SCHEMA = `archboard_p309_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, SCHEMA_SUFFIX_LENGTH)}`;

jest.setTimeout(TEST_TIMEOUT_MS);

function scopedUrl(directUrl: string): string {
  const url = new URL(directUrl);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return url.toString();
}

describe('Phase 3 REST boundary', () => {
  let admin: Pool;
  let database: DataSource;
  let application: NestExpressApplication;
  let cookie: string;

  beforeAll(async () => {
    const directUrl = process.env.DATABASE_DIRECT_URL;
    if (!directUrl)
      throw new Error('DATABASE_DIRECT_URL is required for REST boundary integration.');
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
      extra: { max: 4, options: `-c search_path=${SCHEMA}` },
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
      BETTER_AUTH_SECRET: 'p309-auth-integration-secret-32chars',
      GITHUB_CLIENT_ID: 'Ov23liExampleClientId1234567890',
      GITHUB_CLIENT_SECRET: '0123456789abcdef0123456789abcdef01234567',
    });
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureCollaborationWebSockets(application);
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.init();
    const signup = await request(application.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('origin', ORIGIN)
      .send({
        name: 'REST owner',
        email: `p309-${randomUUID()}@example.test`,
        password: 'p309-test-password-32-characters',
      });
    expect(signup.status).toBe(HTTP_OK);
    const setCookies: unknown = signup.headers['set-cookie'];
    if (!Array.isArray(setCookies))
      throw new Error('Sign-up response did not set a session cookie.');
    cookie = (setCookies as string[]).map((header) => header.split(';', 1)[0]).join('; ');
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

  it('excludes auth, product, unknown and parser-error responses from generic HTTP caches', async () => {
    const responses = [
      await request(application.getHttpServer()).get('/api/v1/me'),
      await request(application.getHttpServer()).get('/api/v1/me').set('cookie', cookie),
      await request(application.getHttpServer()).get('/api/missing'),
      await request(application.getHttpServer()).get('/api/auth/get-session').set('cookie', cookie),
      await request(application.getHttpServer()).get('/health/missing'),
      await request(application.getHttpServer())
        .post('/api/auth/sign-out')
        .set('origin', 'https://hostile.invalid')
        .send({}),
      await request(application.getHttpServer())
        .post('/api/v1/boards')
        .set('content-type', 'application/json')
        .send('{'),
    ];
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('maps cross-route responses and failures to contract envelopes with one request ID', async () => {
    const unauthenticated = await request(application.getHttpServer()).get('/api/v1/me');
    expect(unauthenticated.status).toBe(HTTP_UNAUTHORIZED);
    const unauthorizedError = apiErrorEnvelopeSchema.parse(unauthenticated.body);
    expect(unauthorizedError.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
    expect(unauthorizedError.error.requestId).toBe(unauthenticated.headers['x-request-id']);

    const me = await request(application.getHttpServer()).get('/api/v1/me').set('cookie', cookie);
    expect(me.status).toBe(HTTP_OK);
    currentUserResponseSchema.parse(me.body);

    const invalid = await request(application.getHttpServer())
      .post('/api/v1/boards')
      .set('cookie', cookie)
      .set('idempotency-key', randomUUID())
      .send({ title: 'Valid', extra: true });
    expect(invalid.status).toBe(HTTP_BAD_REQUEST);
    expect(apiErrorEnvelopeSchema.parse(invalid.body).error.code).toBe(
      ERROR_CODES.VALIDATION_ERROR,
    );

    const created = await request(application.getHttpServer())
      .post('/api/v1/boards')
      .set('cookie', cookie)
      .set('idempotency-key', randomUUID())
      .send({ title: 'REST boundary board' });
    expect(created.status).toBe(HTTP_CREATED);
    const board = boardDetailResponseSchema.parse(created.body).data;
    const listed = await request(application.getHttpServer())
      .get('/api/v1/boards')
      .set('cookie', cookie);
    expect(listed.status).toBe(HTTP_OK);
    expect(boardListResponseSchema.parse(listed.body).data.some((row) => row.id === board.id)).toBe(
      true,
    );

    const absent = await request(application.getHttpServer())
      .get(`/api/v1/boards/${randomUUID()}`)
      .set('cookie', cookie);
    expect(absent.status).toBe(HTTP_NOT_FOUND);
    expect(apiErrorEnvelopeSchema.parse(absent.body).error.code).toBe(ERROR_CODES.NOT_FOUND);
    const wrongRoute = await request(application.getHttpServer()).get('/api/v1/unknown-route');
    expect(wrongRoute.status).toBe(HTTP_NOT_FOUND);
    expect(apiErrorEnvelopeSchema.parse(wrongRoute.body).error.requestId).toBe(
      wrongRoute.headers['x-request-id'],
    );
  });

  it('bounds JSON and query input before application work', async () => {
    const largeBody = await request(application.getHttpServer())
      .post('/api/v1/boards')
      .set('cookie', cookie)
      .set('idempotency-key', randomUUID())
      .send({ title: 'x'.repeat(LARGE_BODY_CHARACTERS) });
    expect(largeBody.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(apiErrorEnvelopeSchema.parse(largeBody.body).error.code).toBe(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
    );

    const malformed = await request(application.getHttpServer())
      .post('/api/v1/boards')
      .set('cookie', cookie)
      .set('content-type', 'application/json')
      .send('{"title":');
    expect(malformed.status).toBe(HTTP_BAD_REQUEST);
    expect(apiErrorEnvelopeSchema.parse(malformed.body).error.code).toBe(
      ERROR_CODES.VALIDATION_ERROR,
    );

    const largeQuery = await request(application.getHttpServer())
      .get(`/api/v1/boards?search=${'x'.repeat(LARGE_QUERY_CHARACTERS)}`)
      .set('cookie', cookie);
    expect(largeQuery.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(apiErrorEnvelopeSchema.parse(largeQuery.body).error.requestId).toBe(
      largeQuery.headers['x-request-id'],
    );
  });

  it('publishes shared-schema OpenAPI and omits invitation secrets from structured logs', async () => {
    const document = await request(application.getHttpServer()).get('/api/v1/openapi.json');
    expect(document.status).toBe(HTTP_OK);
    expect(document.body.openapi).toBe('3.1.0');
    expect(
      document.body.paths['/api/v1/boards'].post.responses[String(HTTP_CREATED)].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/BoardDetailResponse');
    expect(
      document.body.paths['/api/v1/invites/accept'].post.responses[String(HTTP_GONE)].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/ApiError');
    expect(document.body.paths['/api/v1/boards/{id}/invites'].post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
      ]),
    );
    expect(document.body.components.schemas.ApiError).toEqual(
      z.toJSONSchema(apiErrorEnvelopeSchema, { io: 'output' }),
    );

    const board = await request(application.getHttpServer())
      .post('/api/v1/boards')
      .set('cookie', cookie)
      .set('idempotency-key', randomUUID())
      .send({ title: 'Private board title' });
    const boardId = boardDetailResponseSchema.parse(board.body).data.id;
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const created = await request(application.getHttpServer())
        .post(`/api/v1/boards/${boardId}/invites`)
        .set('cookie', cookie)
        .set('idempotency-key', randomUUID())
        .send({ role: 'viewer' });
      expect(created.status).toBe(HTTP_CREATED);
      const invite = boardInviteResponseSchema.parse(created.body).data;
      const token = new URL(invite.inviteUrl!).pathname.split('/').at(-1)!;
      const preview = await request(application.getHttpServer())
        .post('/api/v1/invites/preview')
        .set('cookie', cookie)
        .send({ token });
      expect(preview.status).toBe(HTTP_OK);
      invitePreviewResponseSchema.parse(preview.body);
      const logs = info.mock.calls.map((entry) => String(entry[0])).join('\n');
      expect(logs).toContain('requestId');
      expect(logs).toContain('actorId');
      expect(logs).toContain('boardId');
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(invite.inviteUrl!);
      expect(logs).not.toContain('Private board title');
      expect(logs).not.toContain('cookie');
      expect(logs).not.toContain('token_hash');
      const publicResponses = JSON.stringify([document.body, preview.body]);
      for (const secretName of [
        'DATABASE_URL',
        'DATABASE_DIRECT_URL',
        'BETTER_AUTH_SECRET',
        'GITHUB_CLIENT_SECRET',
      ]) {
        expect(publicResponses).not.toContain(secretName);
        const value = process.env[secretName];
        if (value && value.length >= MINIMUM_SECRET_LENGTH)
          expect(publicResponses).not.toContain(value);
      }
    } finally {
      info.mockRestore();
    }
  });

  it('bounds invitation requests and returns a safe retry response', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      let limited: Awaited<ReturnType<ReturnType<typeof request>['get']>> | undefined;
      for (let attempt = 0; attempt < INVITE_REQUEST_BURST; attempt += 1) {
        const response = await request(application.getHttpServer()).post('/api/v1/invites/preview');
        if (response.status === HTTP_RATE_LIMITED) {
          limited = response;
          break;
        }
        expect(response.status).toBe(HTTP_UNAUTHORIZED);
      }
      expect(limited?.status).toBe(HTTP_RATE_LIMITED);
      expect(apiErrorEnvelopeSchema.parse(limited?.body).error.code).toBe(ERROR_CODES.RATE_LIMITED);
      expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      info.mockRestore();
    }
  });

  it('keeps liveness process-only and fails readiness when a migration is missing', async () => {
    expect((await request(application.getHttpServer()).get('/health/live')).body).toEqual({
      status: 'live',
    });
    const healthy = await request(application.getHttpServer()).get('/health/ready');
    expect(healthy.status).toBe(HTTP_OK);
    expect(healthy.body).toEqual({ status: 'ready' });
    await database.createQueryBuilder().delete().from('migrations').execute();
    const unavailable = await request(application.getHttpServer()).get('/health/ready');
    expect(unavailable.status).toBe(HTTP_UNAVAILABLE);
    expect(apiErrorEnvelopeSchema.parse(unavailable.body).error.code).toBe(
      ERROR_CODES.TEMPORARILY_UNAVAILABLE,
    );
    expect((await request(application.getHttpServer()).get('/health/live')).body).toEqual({
      status: 'live',
    });
  });
});
