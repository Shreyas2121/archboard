import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { aiRunResponseSchema } from '@archboard/contracts';
import { AuthModule, BetterAuthRuntime, configureAuthHttp } from '../../../auth/index.js';
import { RuntimeAdmission } from '../../../../platform/lifecycle/runtime-admission.js';
import { ApiExceptionFilter } from '../../../../platform/http/api-exception.filter.js';
import { AiController } from '../../ai.controller.js';
import { AiEvents } from '../../ai-events.js';
import { AiHttpService } from '../../application/http-service.js';
import { AiRunCoordinator } from '../../application/run-coordinator.js';
import { AiRunSubscriptions } from '../../application/run-subscriptions.js';
import { AiConnectionGate } from '../../application/connection-gate.js';
import { AiRunApplication } from '../../application/run-application.js';
import { AiPrivateIdentity } from '../../application/private-identity.js';
import { AiProviderRegistry } from '../../application/provider-registry.js';
import type { AiProvider } from '../../application/provider.js';
import { fixtureApiConfig, FIXTURE_MODEL_PROFILE } from '../testing/fixture-config.js';
import { BoardEntity, BoardMemberEntity } from '../../../boards/infrastructure/entities/index.js';
import { InitialDatabaseFoundation1789300000000 } from '../../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { AiPersistenceFoundation1791072000000 } from '../../../../migrations/1791072000000-AiPersistenceFoundation.js';
import { AiAdmissionFoundation1791072000001 } from '../../../../migrations/1791072000001-AiAdmissionFoundation.js';
import { AiResultCache1791072000002 } from '../../../../migrations/1791072000002-AiResultCache.js';
import { AiMaintenance1791072000003 } from '../../../../migrations/1791072000003-AiMaintenance.js';
import { AiResultCache } from '../../application/result-cache.js';
import { AiMaintenance } from '../../application/maintenance.js';
import { AiOperations } from '../../application/operations.js';
import { AiAdmissionService } from '../../application/admission-service.js';
import { estimateAiReservation } from '../../application/pricing.js';
import { snapshotAiConfiguration } from '../../application/persistence.js';
import { DATABASE_ENTITIES } from '../../../../platform/database/database-entities.js';
import { BoardPermissionService } from '../../../boards/application/index.js';
import { PostgresBoardAuthorityReader } from '../../../boards/infrastructure/postgres-board-authority-reader.js';
import { AiIntentService } from '../../application/intent-service.js';
import {
  type AiPersistence,
  type AiPersistenceScope,
  type AiRunRecord,
  type AiLedgerKey,
} from '../../application/persistence.js';
import { PostgresAiPersistence } from './postgres-ai-persistence.js';
import { AesGcmAiPayloadCipher } from './payload-cipher.js';
import {
  AiRunEntity,
  AiReceiptEntity,
  AiReservationEntity,
  AiSettlementEntity,
  AiPayloadEntity,
  AiCounterEntity,
  AiBudgetPeriodEntity,
} from './entities.js';
import {
  fixtureAiIntent,
  fixtureAiResult,
  fixtureSettlement,
  fixturePersistencePolicy,
  TEST_KEY,
  TEST_KEY_VERSION,
  TEST_ACTOR,
  TEST_NAMESPACE,
} from '../testing/persistence-fixtures.js';

// PREPARED ONLY. Never invoke during the user's database-verification pause.
const TEST_TIMEOUT_MS = 90_000;
const FOUR = 4;
const TWO = 2;
const LOCK_WAIT_MS = 40;
const READ_WITH_LOCK_TIMEOUT_MS = 5_000;
const schema = 'archboard_aic05_' + process.pid + '_' + randomUUID().replaceAll('-', '');
let admin: DataSource;
let source: DataSource;
let integrationDatabaseUrl: string;
let store: PostgresAiPersistence;
let service: AiIntentService;
const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
const fresh = () =>
  fixtureAiIntent({
    fingerprint: randomUUID().replaceAll('-', '').repeat(TWO),
    requestHash: randomUUID().replaceAll('-', '').repeat(TWO),
  });
jest.setTimeout(TEST_TIMEOUT_MS);
beforeAll(async () => {
  const direct = process.env.DATABASE_DIRECT_URL;
  if (!direct)
    throw new Error(
      'Prepared AI integration tests require an explicitly selected direct test database.',
    );
  admin = new DataSource({ type: 'postgres', url: direct, synchronize: false });
  await admin.initialize();
  // Identifier contains only fixed ASCII, pid and a generated UUID, never user input.
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const url = new URL(direct);
  url.searchParams.set('options', '-c search_path=' + schema);
  integrationDatabaseUrl = url.toString();
  source = new DataSource({
    type: 'postgres',
    url: url.toString(),
    entities: [...DATABASE_ENTITIES],
    migrations: [
      InitialDatabaseFoundation1789300000000,
      RetainCompactedUpdateReceipts1790426800000,
      AiPersistenceFoundation1791072000000,
      AiAdmissionFoundation1791072000001,
      AiResultCache1791072000002,
      AiMaintenance1791072000003,
    ],
    synchronize: false,
    migrationsRun: false,
    extra: { max: FOUR },
  });
  await source.initialize();
  await source.runMigrations();
  await source.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)', [
    TEST_ACTOR,
    'Fixture Actor',
    'aic05-fixture@example.test',
  ]);
  const authority = new BoardPermissionService(new PostgresBoardAuthorityReader(source));
  store = new PostgresAiPersistence(source, authority);
  service = new AiIntentService(store, cipher, new AiAdmissionService(fixturePersistencePolicy()));
});
afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  if (admin?.isInitialized) {
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await admin.destroy();
  }
});
// These HTTP/session/stream fixtures are prepared only and excluded by unit Jest.
@Module({})
class AiHttpIntegrationModule {}
describe('AI-C09 real PostgreSQL and HttpOnly session transport (deferred acceptance)', () => {
  const HTTP_OK = 200;
  const HTTP_ACCEPTED = 202;
  const HTTP_UNAUTHORIZED = 401;
  const HTTP_NOT_FOUND = 404;
  const HTTP_FORBIDDEN = 403;
  const HTTP_CONFLICT = 409;
  const INPUT_TOKENS = 65_536;
  const CONTEXT_TOKENS = 131_072;
  const MAX_TURNS = 100;
  const POLL_MS = 10;
  const STREAM_TIMEOUT_MS = 15_000;
  const ORIGIN = 'http://localhost:5173';
  let app: NestExpressApplication;
  let actor: string;
  let cookie: string;
  let runs: AiRunCoordinator;
  let intents: AiIntentService;
  let policy: ReturnType<typeof fixturePersistencePolicy>;
  let calls = 0;
  beforeAll(async () => {
    const config = fixtureApiConfig({
      DATABASE_URL: integrationDatabaseUrl,
      DATABASE_DIRECT_URL: integrationDatabaseUrl,
    });
    const runtime = new RuntimeAdmission();
    runtime.setOwnership(true);
    runtime.setSchemaCompatible(true);
    policy = fixturePersistencePolicy({
      AI_DEPLOYMENT_NAMESPACE: 'http-' + randomUUID(),
      AI_MODEL_PROFILES: JSON.stringify([
        {
          ...FIXTURE_MODEL_PROFILE,
          maximumInputTokens: INPUT_TOKENS,
          contextWindowTokens: CONTEXT_TOKENS,
        },
      ]),
    });
    const admission = new AiAdmissionService(policy);
    const persistence = new PostgresAiPersistence(
      source,
      new BoardPermissionService(new PostgresBoardAuthorityReader(source)),
      runtime,
    );
    intents = new AiIntentService(
      persistence,
      cipher,
      admission,
      new AiResultCache(cipher, policy.cache),
    );
    runs = new AiRunCoordinator(intents, runtime, policy);
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
    const http = new AiHttpService(policy, {
      application,
      runs,
      admission,
      persistence,
      subscriptions: new AiRunSubscriptions(runs, new AiConnectionGate(policy)),
    });
    app = await NestFactory.create<NestExpressApplication>(
      {
        module: AiHttpIntegrationModule,
        imports: [AuthModule.register(config)],
        controllers: [AiController],
        providers: [
          AiEvents,
          { provide: AiHttpService, useValue: http },
          { provide: RuntimeAdmission, useValue: runtime },
        ],
      },
      { bodyParser: false, logger: false },
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    configureAuthHttp(app, app.get(BetterAuthRuntime), config);
    await app.listen(0, '127.0.0.1');
    const signup = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('origin', ORIGIN)
      .send({
        name: 'AI HTTP fixture',
        email: randomUUID() + '@example.test',
        password: 'ai-http-fixture-test-password',
      });
    expect(signup.status).toBe(HTTP_OK);
    actor = signup.body.user.id;
    const cookies: unknown = signup.headers['set-cookie'];
    if (!Array.isArray(cookies)) throw new Error('Missing fixture session cookie');
    expect(cookies.some((value: string) => value.toLowerCase().includes('httponly'))).toBe(true);
    cookie = (cookies as string[]).map((value) => value.split(';')[0]).join('; ');
  });
  afterAll(async () => {
    await runs?.drain();
    await app?.close();
  });
  async function boardRun() {
    const boardId = randomUUID();
    const now = new Date();
    await source.getRepository(BoardEntity).insert({
      id: boardId,
      ownerUserId: TEST_ACTOR,
      title: 'Private fixture',
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await source
      .getRepository(BoardMemberEntity)
      .insert({ boardId, userId: actor, role: 'editor', createdAt: now });
    const snapshot = snapshotAiConfiguration({
      provider: 'openai',
      profile: policy.profiles[0]!,
      policy,
    });
    const intent = {
      ...fresh(),
      deploymentNamespace: policy.deploymentNamespace,
      actorUserId: actor,
      boardId,
      snapshot,
      reservation: estimateAiReservation(snapshot, policy.limits),
    };
    const run = (await intents.create(intent)).run;
    return { boardId, run };
  }
  it('real session creation/replay/status/terminal SSE make one fixture provider call', async () => {
    const key = randomUUID();
    const input = {
      schemaVersion: 1,
      task: 'diagram-described',
      target: { kind: 'new-board' },
      prompt: 'Reviewed fixture design',
    };
    const create = () =>
      request(app.getHttpServer())
        .post('/api/v1/ai/runs')
        .set('origin', ORIGIN)
        .set('cookie', cookie)
        .set('Idempotency-Key', key)
        .send(input);
    const first = await create();
    expect(first.status).toBe(HTTP_ACCEPTED);
    const id = aiRunResponseSchema.parse(first.body).data.id;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const result = await request(app.getHttpServer())
        .get(`/api/v1/ai/runs/${id}`)
        .set('cookie', cookie);
      if (aiRunResponseSchema.parse(result.body).data.content.status !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    expect(aiRunResponseSchema.parse((await create()).body).data.id).toBe(id);
    const stream = await request(app.getHttpServer())
      .get(`/api/v1/ai/runs/${id}/events`)
      .set('cookie', cookie)
      .set('Last-Event-ID', '0');
    expect(stream.status).toBe(HTTP_OK);
    expect(stream.headers['cache-control']).toBe('no-store');
    expect(stream.text).toContain('event: result-available');
    expect(stream.text).not.toContain(fixtureAiResult.explanation);
    expect(calls).toBe(1);
    expect((await request(app.getHttpServer()).get(`/api/v1/ai/runs/${id}`)).status).toBe(
      HTTP_UNAUTHORIZED,
    );
    const otherSnapshot = snapshotAiConfiguration({
      provider: 'openai',
      profile: policy.profiles[0]!,
      policy,
    });
    const other = (
      await intents.create({
        ...fresh(),
        deploymentNamespace: policy.deploymentNamespace,
        actorUserId: TEST_ACTOR,
        snapshot: otherSnapshot,
        reservation: estimateAiReservation(otherSnapshot, policy.limits),
      })
    ).run;
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/ai/runs/${other.id}`).set('cookie', cookie))
        .status,
    ).toBe(HTTP_NOT_FOUND);
  });
  it.each(['viewer', 'archived', 'revoked'] as const)(
    'rechecks actual %s authority for status and streams',
    async (change) => {
      const { boardId, run } = await boardRun();
      if (change === 'viewer')
        await source
          .getRepository(BoardMemberEntity)
          .update({ boardId, userId: actor }, { role: 'viewer' });
      else if (change === 'archived')
        await source.getRepository(BoardEntity).update({ id: boardId }, { archivedAt: new Date() });
      else await source.getRepository(BoardMemberEntity).delete({ boardId, userId: actor });
      const expected =
        change === 'viewer'
          ? HTTP_FORBIDDEN
          : change === 'archived'
            ? HTTP_CONFLICT
            : HTTP_NOT_FOUND;
      for (const suffix of ['', '/events']) {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/ai/runs/${run.id}${suffix}`)
          .set('cookie', cookie);
        expect(response.status).toBe(expected);
        expect(response.headers['cache-control']).toBe('no-store');
      }
    },
  );
  it('closes an active stream after real membership revocation without replay or generation', async () => {
    const { boardId, run } = await boardRun();
    const address = app.getHttpServer().address() as AddressInfo;
    const before = calls;
    const frames: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error('Stream failed to close after revocation'));
      }, STREAM_TIMEOUT_MS);
      const client = httpGet(
        {
          host: '127.0.0.1',
          port: address.port,
          path: `/api/v1/ai/runs/${run.id}/events`,
          headers: { cookie, origin: ORIGIN },
        },
        (response) => {
          response.on('data', (chunk: Buffer) => {
            frames.push(chunk.toString());
            if (frames.length === 1)
              void source
                .getRepository(BoardMemberEntity)
                .delete({ boardId, userId: actor })
                .catch(reject);
          });
          response.on('end', () => {
            clearTimeout(timer);
            resolve();
          });
          response.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        },
      );
      client.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain('event: status');
    expect(calls).toBe(before);
  });
  it('real sign-out invalidates the cookie for status, stream and cancellation', async () => {
    const { run } = await boardRun();
    const before = calls;
    const signout = await request(app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('origin', ORIGIN)
      .set('cookie', cookie)
      .send({});
    expect(signout.status).toBe(HTTP_OK);
    for (const suffix of ['', '/events', '/cancel']) {
      const path = `/api/v1/ai/runs/${run.id}${suffix}`;
      const call =
        suffix === '/cancel'
          ? request(app.getHttpServer()).post(path).send({ schemaVersion: 1 })
          : request(app.getHttpServer()).get(path);
      const response = await call.set('cookie', cookie);
      expect(response.status).toBe(HTTP_UNAUTHORIZED);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(calls).toBe(before);
  });
});
async function fund(run: AiRunRecord) {
  await new AiAdmissionService(fixturePersistencePolicy()).admit(
    store,
    run.deploymentNamespace,
    run.actorUserId,
    run.id,
  );
  return service.markDispatch(run.deploymentNamespace, run.actorUserId, run.id);
}
describe('AI-C05 PostgreSQL persistence (deferred acceptance)', () => {
  it('commits unlimited development admission and settlement through the real funding triggers', async () => {
    const policy = fixturePersistencePolicy({
      NODE_ENV: 'development',
      AI_DEPLOYMENT_NAMESPACE: randomUUID(),
      AI_GLOBAL_BUDGET_MICRO_USD: '1',
      AI_DAILY_BUDGET_MICRO_USD: '1',
      AI_MONTHLY_BUDGET_MICRO_USD: '1',
    });
    const snapshot = snapshotAiConfiguration({
      provider: policy.provider,
      profile: policy.profiles[0]!,
      policy,
    });
    const intent = fixtureAiIntent({
      snapshot,
      deploymentNamespace: policy.deploymentNamespace,
      reservation: estimateAiReservation(snapshot, policy.limits),
    });
    const local = new AiIntentService(
      store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
      new AiAdmissionService(policy),
    );
    const first = (await local.create(intent)).run;
    await local.create({
      ...intent,
      key: randomUUID(),
      fingerprint: 'e'.repeat(TEST_KEY.length),
      requestHash: 'f'.repeat(TEST_KEY.length),
    });
    const dispatched = await local.markDispatch(
      intent.deploymentNamespace,
      intent.actorUserId,
      first.id,
    );
    await local.settle(
      intent.deploymentNamespace,
      intent.actorUserId,
      fixtureSettlement(dispatched),
      fixtureAiResult,
    );
    expect(
      (await local.read(intent.deploymentNamespace, intent.actorUserId, first.id)).run.phase,
    ).toBe('completed');
  });
  it('reads fresh and budget usage in a batch without materializing missing allowance rows', async () => {
    const namespace = randomUUID();
    const base = {
      deploymentNamespace: namespace,
      scope: 'actor' as const,
      subject: TEST_ACTOR,
      periodStart: new Date(0),
    };
    const keys: AiLedgerKey[] = [
      { ...base, kind: 'capacity', metric: 'fresh', period: 'day' },
      { ...base, kind: 'budget', metric: 'micro-usd', period: 'lifetime' },
      { ...base, kind: 'capacity', metric: 'fresh', period: 'minute' },
    ];
    await store.run(async (scope) => {
      await scope.lockAdmission(namespace, TEST_ACTOR);
      await scope.saveLedger({
        ...(await scope.getLedger(keys[0]!)),
        committed: '3',
        reserved: '0',
      });
      await scope.saveLedger({
        ...(await scope.getLedger(keys[1]!)),
        committed: '12',
        reserved: '7',
      });
    });
    const rows = await store.run(async (scope) => {
      await scope.lockAdmission(namespace, TEST_ACTOR);
      return scope.readLedgers(keys);
    });
    expect(rows).toEqual([
      { ...keys[0], committed: '3', reserved: '0' },
      { ...keys[1], committed: '12', reserved: '7' },
      { ...keys[2], committed: '0', reserved: '0' },
    ]);
    expect(
      await source.getRepository(AiCounterEntity).countBy({ deploymentNamespace: namespace }),
    ).toBe(1);
    expect(
      await source.getRepository(AiBudgetPeriodEntity).countBy({ deploymentNamespace: namespace }),
    ).toBe(1);
  });
  it.each([
    ['AI_DAILY_BUDGET_MICRO_USD', '6'],
    ['AI_GLOBAL_CONCURRENCY', '1'],
    ['AI_PROVIDER_RPM', '3'],
    ['AI_PROVIDER_INPUT_TPM', '3000'],
    ['AI_PROVIDER_OUTPUT_TPM', '300'],
  ])(
    'C06: serializes real concurrent %s reservations across repository instances',
    async (control, limit) => {
      const policy = fixturePersistencePolicy({
        AI_DEPLOYMENT_NAMESPACE: 'race-' + randomUUID(),
        AI_ACTOR_CONCURRENCY: control === 'AI_GLOBAL_CONCURRENCY' ? '1' : '100',
        AI_GLOBAL_CONCURRENCY: '100',
        [control]: limit,
      });
      const snapshot = snapshotAiConfiguration({
        provider: 'openai',
        profile: policy.profiles[0]!,
        policy,
      });
      const first = new AiIntentService(store, cipher, new AiAdmissionService(policy));
      const secondStore = new PostgresAiPersistence(
        source,
        new BoardPermissionService(new PostgresBoardAuthorityReader(source)),
      );
      const second = new AiIntentService(secondStore, cipher, new AiAdmissionService(policy));
      const input = () => ({
        ...fresh(),
        deploymentNamespace: policy.deploymentNamespace,
        snapshot,
        reservation: estimateAiReservation(snapshot, policy.limits),
      });
      const results = await Promise.allSettled([first.create(input()), second.create(input())]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(
        await source
          .getRepository(AiRunEntity)
          .countBy({ deploymentNamespace: policy.deploymentNamespace }),
      ).toBe(1);
      const wallet = await source.getRepository(AiBudgetPeriodEntity).findOneByOrFail({
        deploymentNamespace: policy.deploymentNamespace,
        scope: 'global',
        subject: '',
        period: 'lifetime',
      });
      expect(wallet.reservedMicroUsd).toBe('6');
    },
  );
  it('C06: rejects a forged funded phase without the required allocations', async () => {
    const { run } = await new AiIntentService(store, cipher).create(fresh());
    await expect(
      source.transaction(async (manager) => {
        await manager.update(AiReservationEntity, run.id, {
          status: 'reserved',
          fundedAt: new Date(),
        });
        await manager.update(AiRunEntity, run.id, { phase: 'admitted' });
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    expect(
      (await source.getRepository(AiReservationEntity).findOneByOrFail({ runId: run.id })).status,
    ).toBe('pending');
  });
  it('C06: preserves unknown liability over a fake-clock calendar transition in real transactions', async () => {
    const policy = fixturePersistencePolicy({
      AI_DEPLOYMENT_NAMESPACE: 'rollover-' + randomUUID(),
      AI_DAILY_BUDGET_MICRO_USD: '10',
      AI_MONTHLY_BUDGET_MICRO_USD: '10',
    });
    const snapshot = snapshotAiConfiguration({
      provider: 'openai',
      profile: policy.profiles[0]!,
      policy,
    });
    const input = () => ({
      ...fresh(),
      deploymentNamespace: policy.deploymentNamespace,
      snapshot,
      reservation: estimateAiReservation(snapshot, policy.limits),
    });
    const current = new AiIntentService(store, cipher, new AiAdmissionService(policy));
    const { run } = await current.create(input());
    const started = await current.markDispatch(policy.deploymentNamespace, TEST_ACTOR, run.id);
    await current.settle(
      policy.deploymentNamespace,
      TEST_ACTOR,
      fixtureSettlement(started, {
        mode: 'unknown',
        phase: 'outcome-unknown',
        actualMicroUsd: null,
        usage: { status: 'unknown' },
      }),
    );
    const DAY_MS = 86_400_000;
    const future: AiPersistence = {
      run: <T>(work: (scope: AiPersistenceScope) => Promise<T>) =>
        store.run((scope) =>
          work(
            new Proxy(scope, {
              get: (target, property) => {
                if (property === 'now') return async () => new Date(Date.now() + DAY_MS);
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        ),
    };
    await expect(
      new AiIntentService(future, cipher, new AiAdmissionService(policy)).create(input()),
    ).rejects.toMatchObject({ code: 'AI_ALLOWANCE_REACHED' });
    expect(
      (
        await source.getRepository(AiBudgetPeriodEntity).findOneByOrFail({
          deploymentNamespace: policy.deploymentNamespace,
          scope: 'global',
          subject: '',
          period: 'lifetime',
        })
      ).reservedMicroUsd,
    ).toBe('6');
  });
  it('coordinates two repository instances across concurrent same-key and different-key creation', async () => {
    const input = fresh();
    const second = new AiIntentService(
      new PostgresAiPersistence(
        source,
        new BoardPermissionService(new PostgresBoardAuthorityReader(source)),
      ),
      cipher,
      new AiAdmissionService(fixturePersistencePolicy()),
    );
    const results = await Promise.all([
      service.create(input),
      second.create(input),
      second.create({ ...input, key: randomUUID() }),
    ]);
    expect(new Set(results.map((item) => item.run.id)).size).toBe(1);
    expect(await source.getRepository(AiReceiptEntity).countBy({ runId: results[0]!.run.id })).toBe(
      TWO,
    );
    expect(
      await source.getRepository(AiReservationEntity).countBy({ runId: results[0]!.run.id }),
    ).toBe(1);
  });
  it('holds namespace admission locks across separate connections until transaction completion', async () => {
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = store.run(async (scope) => {
      await scope.lockAdmission(TEST_NAMESPACE, TEST_ACTOR);
      acquired();
      await barrier;
    });
    await ready;
    let finished = false;
    const contender = service.create(fresh()).then(() => {
      finished = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      expect(finished).toBe(false);
    } finally {
      release();
      await holder;
      await contender;
    }
  });
  it('reads the owned run while another connection holds accounting admission locks', async () => {
    const { run } = await service.create(fresh());
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = store.run(async (scope) => {
      await scope.lockAdmission(TEST_NAMESPACE, TEST_ACTOR);
      acquired();
      await barrier;
    });
    await ready;
    const read = service.read(TEST_NAMESPACE, TEST_ACTOR, run.id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observed = await Promise.race([
        read,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Status waited for accounting lock')),
            READ_WITH_LOCK_TIMEOUT_MS,
          );
        }),
      ]);
      expect(observed.run.id).toBe(run.id);
    } finally {
      clearTimeout(timer);
      release();
      await holder;
      await read;
    }
  });
  it('rolls back all creation records on a failed receipt write', async () => {
    const input = fresh();
    const failed: AiPersistence = {
      run: <T>(work: (scope: AiPersistenceScope) => Promise<T>) =>
        store.run((scope) =>
          work(
            new Proxy(scope, {
              get: (target, property) => {
                if (property === 'insertReceipt')
                  return async () => {
                    throw new Error('injected rollback');
                  };
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        ),
    };
    await expect(
      new AiIntentService(
        failed,
        cipher,
        new AiAdmissionService(fixturePersistencePolicy()),
      ).create(input),
    ).rejects.toMatchObject({
      code: 'TEMPORARILY_UNAVAILABLE',
    });
    expect(
      await source.getRepository(AiRunEntity).countBy({ fingerprint: input.fingerprint }),
    ).toBe(0);
    expect(await source.getRepository(AiReceiptEntity).countBy({ key: input.key })).toBe(0);
  });
  it('enforces active uniqueness even against direct duplicate inserts', async () => {
    const { run } = await service.create(fresh());
    await expect(
      source.getRepository(AiRunEntity).insert({ ...run, id: randomUUID() }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });
  it('rejects admitted or dispatching phase without funded admission at deferred commit', async () => {
    const { run } = await new AiIntentService(store, cipher).create(fresh());
    await expect(
      source.transaction(async (manager) => {
        await manager.update(AiRunEntity, run.id, { phase: 'admitted' });
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    expect((await source.getRepository(AiRunEntity).findOneByOrFail({ id: run.id })).phase).toBe(
      'pending-admission',
    );
  });
  it('protects snapshot, receipt and terminal settlement immutability', async () => {
    const { run } = await service.create(fresh());
    await expect(
      source
        .getRepository(AiRunEntity)
        .update(run.id, { snapshot: { ...run.snapshot, model: 'other' } }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      source
        .getRepository(AiReceiptEntity)
        .update({ runId: run.id }, { requestHash: 'd'.repeat(TEST_KEY.length) }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    const started = await fund(run);
    const final = fixtureSettlement(started);
    await Promise.all([
      service.settle(TEST_NAMESPACE, TEST_ACTOR, final, fixtureAiResult),
      service.settle(TEST_NAMESPACE, TEST_ACTOR, final, fixtureAiResult),
    ]);
    expect(await source.getRepository(AiSettlementEntity).countBy({ runId: run.id })).toBe(1);
    await expect(
      source.getRepository(AiSettlementEntity).update(run.id, { actualMicroUsd: '3' }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
  it('encrypts actor-private payloads and keeps safe accounting after physical payload removal', async () => {
    const { run } = await service.create(fresh());
    const started = await fund(run);
    await service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(started), fixtureAiResult);
    const payload = await source
      .getRepository(AiPayloadEntity)
      .findOneByOrFail({ originRunId: run.id });
    expect(payload.ciphertext.toString()).not.toContain('Private result');
    expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).result).toEqual(
      fixtureAiResult,
    );
    await expect(service.read(TEST_NAMESPACE, 'other-actor', run.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(cipher.open(payload)).toEqual(fixtureAiResult);
    await source.getRepository(AiPayloadEntity).delete(payload.id);
    expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
    expect(await source.getRepository(AiSettlementEntity).countBy({ runId: run.id })).toBe(1);
    expect(await source.getRepository(AiReceiptEntity).countBy({ runId: run.id })).toBe(1);
  });
  it('rechecks current board permissions and archive status before receipt/result disclosure', async () => {
    const boardId = randomUUID();
    await source.query('INSERT INTO boards(id,owner_user_id,title) VALUES ($1,$2,$3)', [
      boardId,
      TEST_ACTOR,
      'Fixture board',
    ]);
    const input = fresh();
    input.boardId = boardId;
    const { run } = await service.create(input);
    await source.query('UPDATE boards SET archived_at=clock_timestamp() WHERE id=$1', [boardId]);
    await expect(service.create(input)).rejects.toMatchObject({ code: 'BOARD_ARCHIVED' });
    await expect(service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).rejects.toMatchObject({
      code: 'BOARD_ARCHIVED',
    });
  });
  it('denies a downgraded or removed editor before replay and run disclosure', async () => {
    const boardId = randomUUID();
    const editor = 'aic05-editor';
    await source.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)', [
      editor,
      'Fixture editor',
      'aic05-editor@example.test',
    ]);
    await source.query('INSERT INTO boards(id,owner_user_id,title) VALUES ($1,$2,$3)', [
      boardId,
      TEST_ACTOR,
      'Fixture board',
    ]);
    await source.query(
      'INSERT INTO board_members(board_id,user_id,role,created_at) VALUES ($1,$2,$3,clock_timestamp())',
      [boardId, editor, 'editor'],
    );
    const input = fresh();
    input.boardId = boardId;
    input.actorUserId = editor;
    const { run } = await service.create(input);
    await source.query('UPDATE board_members SET role=$3 WHERE board_id=$1 AND user_id=$2', [
      boardId,
      editor,
      'viewer',
    ]);
    await expect(service.create(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.read(TEST_NAMESPACE, editor, run.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await source.query('DELETE FROM board_members WHERE board_id=$1 AND user_id=$2', [
      boardId,
      editor,
    ]);
    await expect(service.create(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.read(TEST_NAMESPACE, editor, run.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('retains maximum reservation liability for uncertain execution', async () => {
    const { run } = await service.create(fresh());
    const started = await fund(run);
    await service.settle(
      TEST_NAMESPACE,
      TEST_ACTOR,
      fixtureSettlement(started, {
        mode: 'unknown',
        phase: 'outcome-unknown',
        actualMicroUsd: null,
        usage: { status: 'unknown' },
        failureCode: 'AI_OUTCOME_UNKNOWN',
      }),
    );
    expect(
      await source.getRepository(AiReservationEntity).findOneByOrFail({ runId: run.id }),
    ).toMatchObject({
      status: 'unknown',
      maximumMicroUsd: fixtureAiIntent().reservation.maximumMicroUsd,
    });
    await expect(
      service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(started)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('rejects negative capacities and non-UTC budget period starts', async () => {
    const base = {
      deploymentNamespace: TEST_NAMESPACE,
      scope: 'global' as const,
      subject: '',
      periodStart: new Date('2026-10-04T10:00:00Z'),
    };
    await expect(
      source.getRepository(AiCounterEntity).insert({
        ...base,
        metric: 'provider-input',
        period: 'minute',
        committed: '-1',
        reserved: '0',
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      source
        .getRepository(AiBudgetPeriodEntity)
        .insert({ ...base, period: 'day', committedMicroUsd: '0', reservedMicroUsd: '0' }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
  it('fences competing expired-worker recovery and late completion without redispatch', async () => {
    const intent = fresh();
    const { run } = await service.create(intent);
    const dispatched = await service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    // Simulates durable intent left behind by a terminated worker, with no provider I/O.
    await source.getRepository(AiRunEntity).update(run.id, {
      leaseExpiresAt: new Date(0),
    });
    await expect(
      service.claimAttempt(TEST_NAMESPACE, TEST_ACTOR, run.id, dispatched.dispatchToken!),
    ).rejects.toThrow();
    await Promise.all([
      service.recover(TEST_NAMESPACE, TEST_ACTOR, run.id),
      service.recover(TEST_NAMESPACE, TEST_ACTOR, run.id),
    ]);
    await expect(
      service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(dispatched), fixtureAiResult),
    ).rejects.toThrow();
    expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).run.phase).toBe(
      'outcome-unknown',
    );
    expect((await service.create(intent)).source).toBe('replayed');
    await expect(service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id)).rejects.toThrow();
  });
  it('AI-C18 maintenance discovers expired leases before total deadlines across repository instances', async () => {
    const policy = fixturePersistencePolicy();
    const funded = new AiIntentService(store, cipher, new AiAdmissionService(policy));
    const { run } = await funded.create(fresh());
    await funded.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    await source.getRepository(AiRunEntity).update(run.id, { leaseExpiresAt: new Date(0) });
    const runtime = new RuntimeAdmission();
    runtime.setOwnership(true);
    runtime.setSchemaCompatible(true);
    const second = new PostgresAiPersistence(
      source,
      new BoardPermissionService(new PostgresBoardAuthorityReader(source)),
    );
    const secondIntents = new AiIntentService(second, cipher, new AiAdmissionService(policy));
    const workers = [
      new AiMaintenance(store, funded, runtime, TEST_NAMESPACE, new AiOperations()),
      new AiMaintenance(second, secondIntents, runtime, TEST_NAMESPACE, new AiOperations()),
    ];
    await Promise.all(workers.map((worker) => worker.tick()));
    expect((await funded.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).run.phase).toBe(
      'outcome-unknown',
    );
    expect(await source.getRepository(AiSettlementEntity).countBy({ runId: run.id })).toBe(1);
    expect(
      await source.getRepository(AiReservationEntity).findOneBy({ runId: run.id }),
    ).toMatchObject({ status: 'unknown' });
    await Promise.all(workers.map((worker) => worker.onModuleDestroy()));
  });
  it('reuses one encrypted payload for concurrent exact-cache keys without new paid reservations', async () => {
    const policy = fixturePersistencePolicy();
    const cached = new AiIntentService(
      store,
      cipher,
      new AiAdmissionService(policy),
      new AiResultCache(cipher, policy.cache),
    );
    const input = fresh();
    const { run } = await cached.create(input);
    const dispatched = await cached.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    await cached.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(dispatched), fixtureAiResult);
    const results = await Promise.all([
      cached.create({ ...input, key: randomUUID() }),
      cached.create({ ...input, key: randomUUID() }),
    ]);
    expect(results.every((value) => value.source === 'cache' && value.run.id === run.id)).toBe(
      true,
    );
    const payloads = await source.getRepository(AiPayloadEntity).countBy({ originRunId: run.id });
    expect(payloads).toBe(1);
    expect(await source.getRepository(AiReservationEntity).countBy({ runId: run.id })).toBe(1);
  });
  it('serializes capacity eviction and settlement, cascading indexes while retaining accounting', async () => {
    const policy = fixturePersistencePolicy();
    const cached = new AiIntentService(
      store,
      cipher,
      new AiAdmissionService(policy),
      new AiResultCache(cipher, { ...policy.cache, entries: 1, actorEntries: 1 }),
    );
    const inputs = [fresh(), fresh()];
    const admitted = await Promise.all(inputs.map((input) => cached.create(input)));
    const dispatched = await Promise.all(
      admitted.map(({ run }) => cached.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id)),
    );
    await Promise.all(
      dispatched.map((run) =>
        cached.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run), fixtureAiResult),
      ),
    );
    expect(
      await source.getRepository(AiPayloadEntity).countBy({ deploymentNamespace: TEST_NAMESPACE }),
    ).toBe(1);
    const snapshots = await Promise.all(
      admitted.map(({ run }) => cached.read(TEST_NAMESPACE, TEST_ACTOR, run.id)),
    );
    expect(snapshots.map((value) => value.content).sort()).toEqual(['available', 'expired']);
    for (const input of inputs) expect((await cached.create(input)).source).toBe('replayed');
  });
  it('isolates an actual FK cache write failure with a savepoint and still commits known settlement', async () => {
    const policy = fixturePersistencePolicy();
    const faulty: AiPersistence = {
      run: (work) =>
        store.run((scope) =>
          work(
            new Proxy(scope, {
              get(target, property) {
                if (property === 'putCache')
                  return (entry: Parameters<AiPersistenceScope['putCache']>[0]) =>
                    target.putCache({ ...entry, payloadId: randomUUID() });
                const value: unknown = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        ),
    };
    const cached = new AiIntentService(
      faulty,
      cipher,
      new AiAdmissionService(policy),
      new AiResultCache(cipher, policy.cache),
    );
    const input = fresh();
    const { run } = await cached.create(input);
    const dispatched = await cached.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    await cached.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(dispatched), fixtureAiResult);
    expect((await cached.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('available');
    expect((await cached.create(input)).source).toBe('replayed');
    expect(await source.getRepository(AiSettlementEntity).countBy({ runId: run.id })).toBe(1);
  });
  it('AI-C17 concurrent maintenance cascades expired content while retaining settled accounting', async () => {
    const policy = fixturePersistencePolicy();
    const funded = new AiIntentService(
      store,
      cipher,
      new AiAdmissionService(policy),
      new AiResultCache(cipher, policy.cache),
    );
    const input = fresh();
    input.snapshot = { ...input.snapshot, resultTtlMs: 1 };
    const { run } = await funded.create(input);
    const dispatched = await funded.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    await funded.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(dispatched), fixtureAiResult);
    const result = await source.getRepository(AiRunEntity).findOneByOrFail({ id: run.id });
    expect(result.payloadId).not.toBeNull();
    const expiryWaitMs = 20;
    await new Promise((resolve) => setTimeout(resolve, expiryWaitMs));
    const runtime = new RuntimeAdmission();
    runtime.setOwnership(true);
    runtime.setSchemaCompatible(true);
    const workers = [
      new AiMaintenance(store, funded, runtime, TEST_NAMESPACE, new AiOperations()),
      new AiMaintenance(store, funded, runtime, TEST_NAMESPACE, new AiOperations()),
    ];
    await Promise.all(workers.map((worker) => worker.tick()));
    expect(await source.getRepository(AiPayloadEntity).countBy({ id: result.payloadId! })).toBe(0);
    expect((await funded.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
    expect(await source.getRepository(AiReceiptEntity).countBy({ runId: run.id })).toBe(1);
    expect(await source.getRepository(AiSettlementEntity).countBy({ runId: run.id })).toBe(1);
    expect(
      await source.getRepository(AiReservationEntity).findOneBy({ runId: run.id }),
    ).toMatchObject({ status: 'settled' });
    await Promise.all(workers.map((worker) => worker.onModuleDestroy()));
  });
  it('AI-C17 restart cleanup preserves unknown liabilities and receipts after a failed maintenance pass', async () => {
    // PREPARED ONLY: real transaction/failure/restart acceptance remains deferred.
    const deadlineMs = 1000;
    const recoveryWaitMs = 1100;
    const policy = fixturePersistencePolicy();
    const operations = new AiOperations();
    const funded = new AiIntentService(
      store,
      cipher,
      new AiAdmissionService(policy),
      new AiResultCache(cipher, policy.cache),
      operations,
    );
    const input = fresh();
    input.snapshot = { ...input.snapshot, deadlineMs };
    const { run } = await funded.create(input);
    await funded.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    await new Promise((resolve) => setTimeout(resolve, recoveryWaitMs));
    const runtime = new RuntimeAdmission();
    runtime.setOwnership(true);
    runtime.setSchemaCompatible(true);
    const restarted = new AiMaintenance(store, funded, runtime, TEST_NAMESPACE, operations);
    jest.spyOn(store, 'run').mockRejectedValueOnce(new Error('simulated persistence outage'));
    await restarted.tick();
    expect(operations.snapshot().maintenance_failures).toBe('1');
    operations.setPaidEnabled(false);
    await restarted.tick();
    await restarted.tick();
    expect((await funded.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).run.phase).toBe(
      'outcome-unknown',
    );
    expect(
      await source.getRepository(AiReservationEntity).findOneBy({ runId: run.id }),
    ).toMatchObject({ status: 'unknown' });
    expect(await source.getRepository(AiReceiptEntity).countBy({ runId: run.id })).toBe(1);
    expect(await source.getRepository(AiSettlementEntity).countBy({ runId: run.id })).toBe(1);
    expect((await funded.create(input)).source).toBe('replayed');
    await restarted.onModuleDestroy();
  });
  it('round trips the AI forward migration in an independent empty schema', async () => {
    // This isolated migration test is explicitly deferred with the entire suite.
    const isolated = schema + '_migration';
    await admin.query('CREATE SCHEMA "' + isolated + '"');
    const url = new URL(process.env.DATABASE_DIRECT_URL!);
    url.searchParams.set('options', '-c search_path=' + isolated);
    const test = new DataSource({ type: 'postgres', url: url.toString(), synchronize: false });
    try {
      await test.initialize();
      const runner = test.createQueryRunner();
      await runner.connect();
      try {
        await new InitialDatabaseFoundation1789300000000().up(runner);
        const migration = new AiPersistenceFoundation1791072000000();
        await migration.up(runner);
        await migration.down(runner);
        await migration.up(runner);
        await new AiAdmissionFoundation1791072000001().up(runner);
        const cacheMigration = new AiResultCache1791072000002();
        await cacheMigration.up(runner);
        await cacheMigration.down(runner);
        await cacheMigration.up(runner);
        const maintenanceMigration = new AiMaintenance1791072000003();
        await maintenanceMigration.up(runner);
        await maintenanceMigration.down(runner);
        await maintenanceMigration.up(runner);
        const rows: { count: string }[] = await runner.query(
          "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'ai_%'",
          [isolated],
        );
        const AI_TABLES = 10;
        expect(rows[0]?.count).toBe(String(AI_TABLES));
      } finally {
        await runner.release();
      }
    } finally {
      if (test.isInitialized) await test.destroy();
      await admin.query('DROP SCHEMA IF EXISTS "' + isolated + '" CASCADE');
    }
  });
});
