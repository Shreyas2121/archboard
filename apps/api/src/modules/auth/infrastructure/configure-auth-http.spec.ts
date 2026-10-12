import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { loadApiConfig } from '../../../platform/config/index.js';
import {
  RuntimeAdmission,
  RuntimeAdmissionModule,
} from '../../../platform/lifecycle/runtime-admission.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';
import { configureAuthHttp } from './configure-auth-http.js';

const WEB_ORIGIN = 'http://localhost:5173';
const HTTP_UNAVAILABLE = 503;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

@Module({ imports: [RuntimeAdmissionModule] })
class HttpFixtureModule {}

describe('HTTP admission responses without a database', () => {
  let application: NestExpressApplication;
  let authCalls: number;

  beforeEach(async () => {
    authCalls = 0;
    application = await NestFactory.create<NestExpressApplication>(HttpFixtureModule, {
      bodyParser: false,
      logger: false,
    });
    configureAuthHttp(
      application,
      {
        auth: {
          handler: () => {
            authCalls++;
            return Promise.resolve(new Response());
          },
        },
      } as unknown as BetterAuthRuntime,
      loadApiConfig({
        NODE_ENV: 'development',
        ALLOWED_WEB_ORIGINS: WEB_ORIGIN,
        PUBLIC_API_ORIGIN: 'http://localhost:10000',
        PORT: '10000',
        DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
        DATABASE_DIRECT_URL: 'postgresql://unused:unused@localhost/unused',
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
      }),
    );
    await application.init();
  });

  afterEach(async () => {
    await application.close();
  });
  it('allows local login only after admission and with the exact local origin', async () => {
    const admission = application.get(RuntimeAdmission);
    admission.setOwnership(true);
    admission.setSchemaCompatible(true);
    await request(application.getHttpServer())
      .post('/api/auth/sign-in/local')
      .set('Origin', WEB_ORIGIN)
      .expect(HTTP_OK);
    expect(authCalls).toBe(1);
  });
  it.each(['/api/auth/sign-in/local', '/api/auth/sign-in/local/', '/api/auth/%73ign-in/local'])(
    'refuses missing Origin before the local auth handler for %s',
    async (path) => {
      const admission = application.get(RuntimeAdmission);
      admission.setOwnership(true);
      admission.setSchemaCompatible(true);
      await request(application.getHttpServer()).post(path).expect(HTTP_FORBIDDEN);
      expect(authCalls).toBe(0);
    },
  );

  it.each(['/api/v1/me', '/api/v1/ai/availability', '/api/auth/get-session'])(
    'lets the allowed frontend read a refusal for %s before auth or product work',
    async (path) => {
      const response = await request(application.getHttpServer())
        .get(path)
        .set('Origin', WEB_ORIGIN)
        .expect(HTTP_UNAVAILABLE);

      expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.error).toMatchObject({
        code: 'TEMPORARILY_UNAVAILABLE',
        message: 'Service temporarily unavailable.',
      });
      expect(authCalls).toBe(0);
    },
  );

  it('does not grant a foreign origin access to admission errors', async () => {
    const response = await request(application.getHttpServer())
      .get('/api/v1/ai/availability')
      .set('Origin', 'https://untrusted.example')
      .expect(HTTP_UNAVAILABLE);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(authCalls).toBe(0);
  });

  it('refuses a malformed product body before parsing it', async () => {
    const response = await request(application.getHttpServer())
      .post('/api/v1/ai/runs')
      .set('Origin', WEB_ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(HTTP_UNAVAILABLE);

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.body.error.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(authCalls).toBe(0);
  });
});
