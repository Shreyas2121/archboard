import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  aiRunResponseSchema,
  MAX_AI_REQUEST_BYTES,
  MAX_IMPORT_REQUEST_BYTES,
  type AiCreateRun,
} from '@archboard/contracts';
import { AUTH_REQUEST_ACTOR, type RequestActor } from '../auth/application/index.js';
import { fail } from '../../platform/http/api-boundary.js';
import { ApiExceptionFilter } from '../../platform/http/api-exception.filter.js';
import { configureProtectedResponses } from '../../platform/http/protected-response.js';
import { configureProductHttp } from '../../platform/http/product-http.js';
import { RuntimeAdmission } from '../../platform/lifecycle/runtime-admission.js';
import { AiController } from './ai.controller.js';
import { AiEvents } from './ai-events.js';
import { AiHttpService } from './application/http-service.js';
import { AiRunApplication } from './application/run-application.js';
import { AiPrivateIdentity } from './application/private-identity.js';
import { AiProviderRegistry } from './application/provider-registry.js';
import { AiIntentService } from './application/intent-service.js';
import { AiRunCoordinator } from './application/run-coordinator.js';
import { AiRunSubscriptions } from './application/run-subscriptions.js';
import { AiConnectionGate } from './application/connection-gate.js';
import { AiAdmissionService } from './application/admission-service.js';
import { AiResultCache } from './application/result-cache.js';
import { InMemoryAiPersistence } from './infrastructure/testing/in-memory-ai-persistence.js';
import { AesGcmAiPayloadCipher } from './infrastructure/persistence/payload-cipher.js';
import {
  fixturePersistencePolicy,
  fixtureAiResult,
  TEST_ACTOR,
  TEST_KEY,
  TEST_KEY_VERSION,
} from './infrastructure/testing/persistence-fixtures.js';
import { FIXTURE_MODEL_PROFILE } from './infrastructure/testing/fixture-config.js';
import type { AiProvider } from './application/provider.js';
import { AiOperations } from './application/operations.js';

const ACCEPTED = 202;
const OK = 200;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const CONFLICT = 409;
const GONE = 410;
const RATE_LIMITED = 429;
const TOO_LARGE = 413;
const UNAVAILABLE = 503;
const MAX_TURNS = 100;
const TWO = 2;
const INPUT_TOKENS = 65_536;
const CONTEXT_TOKENS = 131_072;
const ORIGIN = 'http://localhost:5173';
const body = {
  schemaVersion: 1,
  task: 'diagram-described',
  target: { kind: 'new-board' },
  prompt: 'Reviewed design',
  history: [],
};
@Module({})
class FixtureModule {}

describe('AI-C09 in-memory Nest HTTP transport', () => {
  let app: NestExpressApplication;
  let store: InMemoryAiPersistence;
  let runs: AiRunCoordinator;
  let calls: number;
  let ai: AiHttpService;
  let policy: ReturnType<typeof fixturePersistencePolicy>;
  let operations: AiOperations;
  let providerWait: Promise<void> | undefined;
  beforeEach(async () => {
    calls = 0;
    operations = new AiOperations();
    providerWait = undefined;
    store = new InMemoryAiPersistence();
    policy = fixturePersistencePolicy({
      AI_MODEL_PROFILES: JSON.stringify([
        {
          ...FIXTURE_MODEL_PROFILE,
          maximumInputTokens: INPUT_TOKENS,
          contextWindowTokens: CONTEXT_TOKENS,
        },
      ]),
    });
    const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
    const admission = new AiAdmissionService(policy);
    const intents = new AiIntentService(
      store,
      cipher,
      admission,
      new AiResultCache(cipher, policy.cache),
    );
    const runtime = new RuntimeAdmission();
    runtime.setOwnership(true);
    runtime.setSchemaCompatible(true);
    runs = new AiRunCoordinator(intents, runtime, policy, () => store.clock.getTime());
    const adapter: AiProvider = {
      id: 'openai',
      implementation: 'test-fixture',
      capabilities: () => ({
        streaming: true,
        structuredOutput: true,
        schemaVersions: [policy.versions.schema],
        promptCaching: false,
        contextWindowTokens: CONTEXT_TOKENS,
        maximumOutputTokens: FIXTURE_MODEL_PROFILE.maximumOutputTokens,
      }),
      stream: async function* () {
        calls++;
        if (providerWait) await providerWait;
        yield {
          type: 'completed',
          text: JSON.stringify({ result: fixtureAiResult }),
          requestId: null,
          usage: {
            status: 'known',
            uncachedInputTokens: 1,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: [],
            outputTokens: 1,
            separatelyBilledReasoningTokens: 0,
            reasoningTokens: null,
          },
        };
      },
    };
    const application = new AiRunApplication(
      new AiPrivateIdentity(TEST_KEY),
      new AiProviderRegistry('test', policy, [adapter]),
      runs,
    );
    ai = new AiHttpService(
      policy,
      {
        application,
        runs,
        admission,
        persistence: store,
        subscriptions: new AiRunSubscriptions(runs, new AiConnectionGate(policy)),
      },
      operations,
    );
    const actor: RequestActor = {
      require: async (headers) => {
        const id =
          headers.cookie === 'session=owner'
            ? TEST_ACTOR
            : headers.cookie === 'session=other'
              ? 'other-actor'
              : null;
        if (!id) fail('UNAUTHENTICATED', 'Sign in to continue.');
        return {
          userId: id,
          user: { id, name: 'Fixture', image: null, email: 'fixture@example.test' },
        };
      },
    };
    app = await NestFactory.create<NestExpressApplication>(
      {
        module: FixtureModule,
        controllers: [AiController],
        providers: [
          { provide: AUTH_REQUEST_ACTOR, useValue: actor },
          { provide: AiHttpService, useValue: ai },
          AiEvents,
        ],
      },
      { bodyParser: false, logger: false },
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    configureProtectedResponses(app);
    configureProductHttp(app, [ORIGIN]);
    await app.init();
  });
  afterEach(async () => {
    await runs.drain();
    await app.close();
  });
  it('disables creation/cache/reads while retaining authorized cancellation and safe availability', async () => {
    const created = { id: await ready() };
    const subscription = ai.open(TEST_ACTOR, created.id);
    operations.setPaidEnabled(false);
    await expect(subscription.next()).rejects.toMatchObject({ code: 'AI_DISABLED' });
    subscription.close();
    await expect(ai.create(TEST_ACTOR, randomUUID(), body as AiCreateRun)).rejects.toMatchObject({
      code: 'AI_DISABLED',
    });
    await expect(ai.read(TEST_ACTOR, created.id)).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(await ai.availability(TEST_ACTOR, null)).toMatchObject({
      available: false,
      reason: 'disabled',
      allowance: null,
    });
    expect(() => ai.open(TEST_ACTOR, created.id)).toThrow();
    await expect(ai.cancel(TEST_ACTOR, created.id)).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(store.state.runs.get(created.id)?.phase).toBe('completed');
    await expect(ai.cancel('other-actor', created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  async function create(input: object = body, key: string = randomUUID()) {
    return request(app.getHttpServer())
      .post('/api/v1/ai/runs')
      .set('cookie', 'session=owner')
      .set('Idempotency-Key', key)
      .send(input);
  }
  it('allows disabled cancellation of active work and preserves unknown spending', async () => {
    let release!: () => void;
    providerWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const created = await ai.create(TEST_ACTOR, randomUUID(), body as AiCreateRun);
      expect(calls).toBe(1);
      operations.setPaidEnabled(false);
      expect(await ai.cancel(TEST_ACTOR, created.id)).toMatchObject({
        state: 'outcome-unknown',
        content: { status: 'unavailable' },
      });
      expect(store.state.reservations.get(created.id)?.status).toBe('unknown');
      expect(store.state.payloads.size).toBe(0);
    } finally {
      release();
    }
  });
  async function ready() {
    const response = await create();
    expect(response.status).toBe(ACCEPTED);
    const id = aiRunResponseSchema.parse(response.body).data.id;
    for (let turn = 0; turn < MAX_TURNS && !store.state.settlements.has(id); turn++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(store.state.settlements.has(id)).toBe(true);
    return id;
  }
  it('uses strict private envelopes; replay and SSE reconnect never generate', async () => {
    const key = randomUUID();
    const first = await create(body, key);
    expect(first.status).toBe(ACCEPTED);
    const id = aiRunResponseSchema.parse(first.body).data.id;
    for (let turn = 0; turn < MAX_TURNS && !store.state.settlements.has(id); turn++)
      await new Promise((resolve) => setImmediate(resolve));
    const replay = await create(body, key);
    expect(aiRunResponseSchema.parse(replay.body).data.id).toBe(id);
    const get = await request(app.getHttpServer())
      .get(`/api/v1/ai/runs/${id}`)
      .set('cookie', 'session=owner');
    expect(get.status).toBe(OK);
    expect(get.headers['cache-control']).toBe('no-store');
    expect(aiRunResponseSchema.parse(get.body).data.state).toBe('needs-input');
    expect(JSON.stringify(get.body)).not.toMatch(
      /snapshot|fingerprint|provider|microUsd|dispatchToken/,
    );
    for (const lastEventId of ['0', String(Number.MAX_SAFE_INTEGER)]) {
      const events = await request(app.getHttpServer())
        .get(`/api/v1/ai/runs/${id}/events`)
        .set('cookie', 'session=owner')
        .set('Last-Event-ID', lastEventId);
      expect(events.status).toBe(OK);
      expect(events.headers['cache-control']).toBe('no-store');
      expect(events.headers['content-type']).toContain('text/event-stream');
      expect(events.text).toContain('event: result-available');
      expect(events.text).not.toContain(fixtureAiResult.explanation);
    }
    expect(calls).toBe(1);
    expect((await create({ ...body, prompt: 'changed' }, key)).status).toBe(CONFLICT);
  });
  it('rejects unauthenticated, forged and cross-user reads without disclosure', async () => {
    const id = await ready();
    for (const suffix of ['', '/events', '/cancel']) {
      const route = `/api/v1/ai/runs/${id}${suffix}`;
      const call =
        suffix === '/cancel'
          ? request(app.getHttpServer()).post(route).send({ schemaVersion: 1 })
          : request(app.getHttpServer()).get(route);
      expect((await call).status).toBe(UNAUTHORIZED);
      const other =
        suffix === '/cancel'
          ? request(app.getHttpServer()).post(route).send({ schemaVersion: 1 })
          : request(app.getHttpServer()).get(route);
      expect((await other.set('cookie', 'session=other')).status).toBe(NOT_FOUND);
    }
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/ai/runs/${randomUUID()}`)
          .set('cookie', 'session=owner')
      ).status,
    ).toBe(NOT_FOUND);
    expect(calls).toBe(1);
  });
  it.each(['FORBIDDEN', 'BOARD_ARCHIVED', 'NOT_FOUND'] as const)(
    'rechecks current board permission (%s) for reads, streams, cancellation and availability',
    async (code) => {
      const boardId = randomUUID();
      const created = await create({ ...body, target: { kind: 'board', boardId } });
      const id = aiRunResponseSchema.parse(created.body).data.id;
      store.denied.set(JSON.stringify([TEST_ACTOR, boardId]), code);
      const expected =
        code === 'FORBIDDEN' ? FORBIDDEN : code === 'NOT_FOUND' ? NOT_FOUND : CONFLICT;
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/ai/runs/${id}`)
            .set('cookie', 'session=owner')
        ).status,
      ).toBe(expected);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/ai/runs/${id}/events`)
            .set('cookie', 'session=owner')
        ).status,
      ).toBe(expected);
      expect(
        (
          await request(app.getHttpServer())
            .post(`/api/v1/ai/runs/${id}/cancel`)
            .set('cookie', 'session=owner')
            .send({ schemaVersion: 1 })
        ).status,
      ).toBe(expected);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/ai/availability?boardId=${boardId}`)
            .set('cookie', 'session=owner')
        ).status,
      ).toBe(expected);
    },
  );
  it('returns advisory durable allowance without promising an unknown reset', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/ai/availability')
      .set('cookie', 'session=owner');
    expect(response.status).toBe(OK);
    expect(response.body.data).toMatchObject({ available: true, allowance: { resetsAt: null } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(calls).toBe(0);
  });
  it('cancellation is idempotent and expired reads never generate or renew retention', async () => {
    const id = await ready();
    for (let attempt = 0; attempt < TWO; attempt++) {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/ai/runs/${id}/cancel`)
        .set('cookie', 'session=owner')
        .send({ schemaVersion: 1 });
      expect(response.status).toBe(OK);
      expect(aiRunResponseSchema.parse(response.body).data.state).toBe('needs-input');
    }
    const expiry = store.state.runs.get(id)!.payloadExpiresAt!;
    store.clock = new Date(expiry.getTime() + 1);
    const expired = await request(app.getHttpServer())
      .get(`/api/v1/ai/runs/${id}`)
      .set('cookie', 'session=owner');
    expect(aiRunResponseSchema.parse(expired.body).data.content).toEqual({
      status: 'expired',
      expiredAt: expiry.toISOString(),
    });
    const stream = await request(app.getHttpServer())
      .get(`/api/v1/ai/runs/${id}/events`)
      .set('cookie', 'session=owner');
    expect(stream.text).toContain('event: content-expired');
    const receipt = [...store.state.receipts.values()].find((receipt) => receipt.runId === id)!;
    store.clock = new Date(receipt.expiresAt.getTime() + 1);
    const replay = await create(body, receipt.key);
    expect(replay.status).toBe(GONE);
    expect(replay.body.error.code).toBe('AI_RESULT_EXPIRED');
    expect(calls).toBe(1);
    expect(store.state.runs.get(id)!.payloadExpiresAt).toEqual(expiry);
  });
  it('enforces actor poll frequency with authoritative Retry-After', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai/availability')
      .set('cookie', 'session=owner');
    for (const row of store.state.ledger.values())
      if (row.metric === 'poll') row.committed = String(policy.limits.pollsPerMinute);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/ai/runs/${randomUUID()}`)
      .set('cookie', 'session=owner');
    expect(response.status).toBe(RATE_LIMITED);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(calls).toBe(0);
  });
  it('rejects malformed body, unknown fields, untrusted configuration, invalid headers and token queries', async () => {
    expect((await create({ ...body, provider: 'openai' })).status).toBe(BAD_REQUEST);
    expect((await create(body, 'forged')).status).toBe(BAD_REQUEST);
    const id = await ready();
    for (const path of [
      `/api/v1/ai/runs/${id}?token=secret`,
      `/api/v1/ai/runs/forged`,
      `/api/v1/ai/availability?role=owner`,
    ]) {
      const response = await request(app.getHttpServer()).get(path).set('cookie', 'session=owner');
      expect(response.status).toBe(BAD_REQUEST);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/ai/runs/${id}/events`)
          .set('cookie', 'session=owner')
          .set('Last-Event-ID', '01')
      ).status,
    ).toBe(BAD_REQUEST);
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/ai/runs')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(BAD_REQUEST);
    expect(malformed.headers['cache-control']).toBe('no-store');
  });
  it('rejects oversized bodies and foreign origins before generation', async () => {
    // Above the unchanged import parser ceiling but inside AI's transport allowance:
    // this reaches strict prompt validation (400), rather than a parser size error (413).
    const withinAiTransport = await create({
      ...body,
      prompt: 'x'.repeat(MAX_IMPORT_REQUEST_BYTES + 1),
    });
    expect(withinAiTransport.status).toBe(BAD_REQUEST);
    expect(withinAiTransport.body.error.code).toBe('VALIDATION_ERROR');
    const large = await request(app.getHttpServer())
      .post('/api/v1/ai/runs')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(MAX_AI_REQUEST_BYTES) }));
    expect(large.status).toBe(TOO_LARGE);
    expect(large.headers['cache-control']).toBe('no-store');
    const origin = await request(app.getHttpServer())
      .post('/api/v1/ai/runs')
      .set('origin', 'https://evil.example')
      .set('cookie', 'session=owner')
      .send(body);
    expect(origin.status).toBe(FORBIDDEN);
    const alternateCase = await request(app.getHttpServer())
      .get('/API/v1/AI/availability')
      .set('origin', 'https://evil.example')
      .set('cookie', 'session=owner');
    expect(alternateCase.status).toBe(FORBIDDEN);
    const crossSite = await request(app.getHttpServer())
      .get('/api/v1/ai/availability')
      .set('sec-fetch-site', 'cross-site')
      .set('cookie', 'session=owner');
    expect(crossSite.status).toBe(FORBIDDEN);
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/ai/availability')
      .set('origin', ORIGIN)
      .set('cookie', 'session=owner');
    expect(allowed.status).toBe(OK);
    expect(calls).toBe(0);
  });
  it('disabled availability is safe and disabled reads do not start providers', async () => {
    jest
      .spyOn(ai, 'availability')
      .mockImplementation((actor, board) => new AiHttpService(null).availability(actor, board));
    jest
      .spyOn(ai, 'read')
      .mockImplementation((actor, id) => new AiHttpService(null).read(actor, id));
    const availability = await request(app.getHttpServer())
      .get('/api/v1/ai/availability')
      .set('cookie', 'session=owner');
    expect(availability.body.data).toEqual({
      schemaVersion: 1,
      available: false,
      reason: 'disabled',
      allowance: null,
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/ai/runs/${randomUUID()}`)
      .set('cookie', 'session=owner');
    expect(response.status).toBe(UNAVAILABLE);
    expect(response.body.error.code).toBe('AI_DISABLED');
    expect(calls).toBe(0);
  });
});
