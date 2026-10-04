import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { InitialDatabaseFoundation1789300000000 } from '../../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { AiPersistenceFoundation1791072000000 } from '../../../../migrations/1791072000000-AiPersistenceFoundation.js';
import { AiAdmissionFoundation1791072000001 } from '../../../../migrations/1791072000001-AiAdmissionFoundation.js';
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
const schema = 'archboard_aic05_' + process.pid + '_' + randomUUID().replaceAll('-', '');
let admin: DataSource;
let source: DataSource;
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
  source = new DataSource({
    type: 'postgres',
    url: url.toString(),
    entities: [...DATABASE_ENTITIES],
    migrations: [
      InitialDatabaseFoundation1789300000000,
      RetainCompactedUpdateReceipts1790426800000,
      AiPersistenceFoundation1791072000000,
      AiAdmissionFoundation1791072000001,
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
        const rows: { count: string }[] = await runner.query(
          "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'ai_%'",
          [isolated],
        );
        const AI_TABLES = 8;
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
