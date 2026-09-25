import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  apiErrorEnvelopeSchema,
  currentUserResponseSchema,
  ERROR_CODES,
} from '@archboard/contracts';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { jest } from '@jest/globals';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';

import { AppModule } from '../../app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { loadApiConfig } from '../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';
import { BetterAuthRuntime, configureAuthHttp } from './index.js';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const UNTRUSTED_ORIGIN = 'http://untrusted.example';
const TEST_PASSWORD = 'correct-horse-battery-staple';
const TEST_TIMEOUT_MS = 60_000;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NO_CONTENT = 204;
const SCHEMA_RANDOM_SUFFIX_CHARACTERS = 8;
const schemaName = `archboard_p302_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, SCHEMA_RANDOM_SUFFIX_CHARACTERS)}`;

jest.setTimeout(TEST_TIMEOUT_MS);

function scopedDirectUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  return url.toString();
}

function sessionCookies(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const sessionCookie = cookies.find((header) => header.includes('.session_token='));
  expect(sessionCookie).toContain('HttpOnly');
  return cookies.map((header) => header.split(';', 1)[0]).join('; ');
}

describe('current user through real Better Auth cookies', () => {
  let admin: Pool;
  let migrationSource: DataSource;
  let application: NestExpressApplication;
  let apiOrigin: string;
  let testEmail: string;
  let cookie: string;

  beforeAll(async () => {
    const directUrl = process.env.DATABASE_DIRECT_URL;
    if (!directUrl)
      throw new Error('DATABASE_DIRECT_URL is required for isolated auth integration.');
    admin = new Pool({ connectionString: directUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const scopedUrl = scopedDirectUrl(directUrl);
    migrationSource = new DataSource({
      type: 'postgres',
      url: scopedUrl,
      schema: schemaName,
      entities: [...DATABASE_ENTITIES],
      migrations: [InitialDatabaseFoundation1789300000000],
      synchronize: false,
      migrationsRun: false,
      extra: { max: 1, options: `-c search_path=${schemaName}` },
    });
    await migrationSource.initialize();
    await migrationSource.runMigrations({ transaction: 'all' });

    const config = loadApiConfig({
      NODE_ENV: 'test',
      PUBLIC_API_ORIGIN: 'http://localhost:3000',
      ALLOWED_WEB_ORIGINS: FRONTEND_ORIGIN,
      PORT: '3000',
      DATABASE_URL: scopedUrl,
      DATABASE_DIRECT_URL: scopedUrl,
      BETTER_AUTH_SECRET: 'p302-auth-integration-secret-32chars',
      GITHUB_CLIENT_ID: 'Ov23liExampleClientId1234567890',
      GITHUB_CLIENT_SECRET: '0123456789abcdef0123456789abcdef01234567',
    });
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.listen(0, '127.0.0.1');
    const address = application.getHttpServer().address() as AddressInfo;
    apiOrigin = `http://127.0.0.1:${address.port}`;

    testEmail = `p302-${randomUUID()}@example.test`;
    const signup = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { origin: FRONTEND_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Phase 3 User', email: testEmail, password: TEST_PASSWORD }),
    });
    expect(signup.status).toBe(HTTP_OK);
    expect(signup.headers.get('access-control-allow-origin')).toBe(FRONTEND_ORIGIN);
    cookie = sessionCookies(signup);
  });

  afterAll(async () => {
    try {
      await application?.close();
      if (migrationSource?.isInitialized) await migrationSource.destroy();
    } finally {
      if (admin) {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  });

  it('rejects anonymous and forged actor headers with safe request IDs', async () => {
    const response = await fetch(`${apiOrigin}/api/v1/me`, {
      headers: { origin: FRONTEND_ORIGIN, 'x-user-id': 'forged-user' },
    });
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    const error = apiErrorEnvelopeSchema.parse(await response.json());
    expect(error.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
    expect(error.error.requestId).toBeTruthy();
    expect(JSON.stringify(error)).not.toContain('forged-user');
  });

  it('returns only safe current-user fields for an actual cookie and rejects an untrusted origin', async () => {
    const response = await fetch(`${apiOrigin}/api/v1/me`, {
      headers: { origin: FRONTEND_ORIGIN, cookie, 'x-user-id': 'forged-user' },
    });
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get('access-control-allow-origin')).toBe(FRONTEND_ORIGIN);
    const currentUser = currentUserResponseSchema.parse(await response.json());
    expect(currentUser.data).toEqual({
      id: expect.any(String),
      name: 'Phase 3 User',
      email: testEmail,
      image: null,
    });
    expect(JSON.stringify(currentUser)).not.toContain('forged-user');
    expect(JSON.stringify(currentUser)).not.toContain('session_token');

    const preflight = await fetch(`${apiOrigin}/api/v1/me`, {
      method: 'OPTIONS',
      headers: { origin: UNTRUSTED_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).toBe(HTTP_NO_CONTENT);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

    const untrustedSignin = await fetch(`${apiOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: UNTRUSTED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
    });
    expect(untrustedSignin.status).not.toBe(HTTP_OK);
    expect(untrustedSignin.headers.getSetCookie()).toHaveLength(0);
  });

  it('offers only GitHub identity scopes through the configured Better Auth provider', async () => {
    const response = await fetch(`${apiOrigin}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { origin: FRONTEND_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: `${FRONTEND_ORIGIN}/boards` }),
    });
    expect(response.status).toBe(HTTP_OK);
    const result = (await response.json()) as { url: string };
    const authorizationUrl = new URL(result.url);
    expect(authorizationUrl.origin).toBe('https://github.com');
    expect(authorizationUrl.pathname).toBe('/login/oauth/authorize');
    expect(new Set(authorizationUrl.searchParams.get('scope')?.split(' '))).toEqual(
      new Set(['read:user', 'user:email']),
    );
    expect(result.url).not.toContain('0123456789abcdef0123456789abcdef01234567');
  });

  it('invalidates a signed-out cookie and treats an expired database session as unauthenticated', async () => {
    const signout = await fetch(`${apiOrigin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { origin: FRONTEND_ORIGIN, cookie },
    });
    expect(signout.status).toBe(HTTP_OK);
    const afterSignout = await fetch(`${apiOrigin}/api/v1/me`, { headers: { cookie } });
    expect(afterSignout.status).toBe(HTTP_UNAUTHORIZED);

    const signin = await fetch(`${apiOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: FRONTEND_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
    });
    expect(signin.status).toBe(HTTP_OK);
    const refreshedCookie = sessionCookies(signin);
    const signedIn = await fetch(`${apiOrigin}/api/v1/me`, {
      headers: { cookie: refreshedCookie },
    });
    expect(signedIn.status).toBe(HTTP_OK);
    const { data } = currentUserResponseSchema.parse(await signedIn.json());
    await migrationSource.query(
      `UPDATE "session" SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "userId" = $1`,
      [data.id],
    );
    const expired = await fetch(`${apiOrigin}/api/v1/me`, { headers: { cookie: refreshedCookie } });
    expect(expired.status).toBe(HTTP_UNAUTHORIZED);
    expect(apiErrorEnvelopeSchema.parse(await expired.json()).error.code).toBe(
      ERROR_CODES.UNAUTHENTICATED,
    );
  });
});
