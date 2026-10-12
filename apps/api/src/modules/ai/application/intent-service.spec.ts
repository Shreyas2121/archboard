import { randomUUID } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import { AiIntentService } from './intent-service.js';
import { AiAdmissionService } from './admission-service.js';
import {
  AiPersistenceError,
  aiIntentSchema,
  type AiPersistence,
  type AiRunRecord,
} from './persistence.js';
import { InMemoryAiPersistence } from '../infrastructure/testing/in-memory-ai-persistence.js';
import { AesGcmAiPayloadCipher } from '../infrastructure/persistence/payload-cipher.js';
import {
  fixtureAiIntent,
  fixtureAiResult,
  fixtureSettlement,
  fixturePersistencePolicy,
  TEST_KEY,
  TEST_KEY_VERSION,
  TEST_NAMESPACE,
  TEST_ACTOR,
} from '../infrastructure/testing/persistence-fixtures.js';
const DAY_MS = 86_400_000;
const RESULT_TTL_MS = 900_000;
const TWO = 2;
const THREE = 3;
const setup = (store = new InMemoryAiPersistence()) => ({
  store,
  service: new AiIntentService(store, new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION)),
});
it('reads pending run status without preparing accounting and still rejects revoked board access', async () => {
  const store = new InMemoryAiPersistence();
  const admission = new AiAdmissionService(fixturePersistencePolicy());
  const service = new AiIntentService(
    store,
    new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    admission,
  );
  const intent = fixtureAiIntent({ boardId: randomUUID() });
  const { run } = await service.create(intent);
  const prepare = jest.spyOn(admission, 'prepare');
  store.locks = [];
  expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('pending');
  expect(prepare).not.toHaveBeenCalled();
  expect(store.locks).toEqual(['authority']);
  store.denied.set(JSON.stringify([TEST_ACTOR, intent.boardId]), 'FORBIDDEN');
  await expect(service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
async function fund(store: AiPersistence, run: AiRunRecord): Promise<void> {
  await new AiAdmissionService(fixturePersistencePolicy()).admit(
    store,
    run.deploymentNamespace,
    run.actorUserId,
    run.id,
  );
}
async function dispatched() {
  const context = setup();
  const { run } = await context.service.create(fixtureAiIntent());
  await fund(context.store, run);
  context.service = new AiIntentService(
    context.store,
    new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    new AiAdmissionService(fixturePersistencePolicy()),
  );
  return {
    ...context,
    run: await context.service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id),
  };
}
describe('durable AI intent service with transactional memory adapter', () => {
  it('atomically creates pending intent, reservation and a receipt after current authority', async () => {
    const { store, service } = setup();
    const input = fixtureAiIntent();
    const created = await service.create(input);
    expect(created.source).toBe('created');
    expect(created.run.phase).toBe('pending-admission');
    expect(store.state.receipts.size).toBe(1);
    expect(store.state.reservations.size).toBe(1);
    expect(store.locks).toEqual(['authority', 'global', 'actor', 'fingerprint', 'receipt', 'run']);
    input.snapshot.pricingVersion = 'changed-profile';
    expect(store.state.runs.get(created.run.id)?.snapshot.pricingVersion).toBe(
      'fixture-pricing-v1',
    );
    await expect(
      service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, created.run.id),
    ).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(store.state.runs.get(created.run.id)?.dispatchToken).toBeNull();
  });
  it('rolls back run and reservation when receipt insertion fails', async () => {
    const { store, service } = setup();
    store.failReceipt = true;
    await expect(service.create(fixtureAiIntent())).rejects.toBeInstanceOf(AiPersistenceError);
    expect(store.state.runs.size).toBe(0);
    expect(store.state.reservations.size).toBe(0);
    expect(store.state.receipts.size).toBe(0);
  });
  it('coordinates concurrent replay and active work across distinct keys', async () => {
    const { store, service } = setup();
    const input = fixtureAiIntent();
    const results = await Promise.all([
      service.create(input),
      service.create(input),
      service.create({ ...input, key: randomUUID() }),
    ]);
    expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
    expect(results.map((result) => result.source)).toEqual(['created', 'replayed', 'deduplicated']);
    expect(store.state.receipts.size).toBe(TWO);
  });
  it('rejects changed-body replay and conflicting active fingerprint metadata', async () => {
    const { service } = setup();
    const input = fixtureAiIntent();
    await service.create(input);
    await expect(
      service.create({ ...input, requestHash: 'd'.repeat(TEST_KEY.length) }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      service.create({ ...input, key: randomUUID(), boardId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('retains expired receipt tombstones without new intent', async () => {
    const { store, service } = setup();
    const input = fixtureAiIntent();
    await service.create(input);
    store.clock = new Date(store.clock.getTime() + DAY_MS);
    await expect(service.create(input)).rejects.toMatchObject({ code: 'AI_RESULT_EXPIRED' });
    expect(store.state.runs.size).toBe(1);
    expect(store.state.receipts.size).toBe(1);
  });
  it('separates actors and namespaces even when keys and fingerprints match', async () => {
    const { store, service } = setup();
    const input = fixtureAiIntent();
    await service.create(input);
    await service.create({ ...input, actorUserId: 'another-actor' });
    await service.create({ ...input, deploymentNamespace: 'another-deployment' });
    expect(store.state.runs.size).toBe(THREE);
  });
  it.each(['NOT_FOUND', 'FORBIDDEN', 'BOARD_ARCHIVED'] as const)(
    'rechecks %s authority before replay and payload disclosure',
    async (code) => {
      const { store, service, run } = await dispatched();
      store.denied.set(JSON.stringify([TEST_ACTOR, null]), code);
      await service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run), fixtureAiResult);
      // Accounting completes for the trusted worker, but returns no private data.
      expect(store.state.settlements.size).toBe(1);
      await expect(service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).rejects.toMatchObject({
        code,
      });
      const receipt = [...store.state.receipts.values()][0]!;
      await expect(service.create(fixtureAiIntent({ key: receipt.key }))).rejects.toMatchObject({
        code,
      });
    },
  );
  it('stores only ciphertext privately and safe immutable accounting separately', async () => {
    const { store, service, run } = await dispatched();
    expect(
      await service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run), fixtureAiResult),
    ).toBeUndefined();
    const read = await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id);
    expect(read.result).toEqual(fixtureAiResult);
    expect(read.content).toBe('available');
    expect(
      JSON.stringify([
        ...store.state.runs.values(),
        ...store.state.receipts.values(),
        ...store.state.reservations.values(),
        ...store.state.settlements.values(),
      ]),
    ).not.toContain('Private result');
    const payload = [...store.state.payloads.values()][0]!;
    expect(Buffer.from(payload.ciphertext).toString()).not.toContain('Private result');
    await expect(service.read(TEST_NAMESPACE, 'another-actor', run.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    store.clock = new Date(store.clock.getTime() + RESULT_TTL_MS);
    expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
    expect(await store.run((scope) => scope.deleteExpiredPayloads(TEST_NAMESPACE, 1))).toBe(1);
    expect(store.state.payloads.size).toBe(0);
    expect(store.state.settlements.size).toBe(1);
    expect(store.state.receipts.size).toBe(1);
  });
  it('settles once; identical retries preserve payload and conflicting late effects fail', async () => {
    const { store, service, run } = await dispatched();
    const final = fixtureSettlement(run);
    await service.settle(TEST_NAMESPACE, TEST_ACTOR, final, fixtureAiResult);
    const payloadId = store.state.runs.get(run.id)?.payloadId;
    await service.settle(TEST_NAMESPACE, TEST_ACTOR, final, fixtureAiResult);
    expect(store.state.runs.get(run.id)?.payloadId).toBe(payloadId);
    expect(store.state.payloads.size).toBe(1);
    await expect(
      service.settle(TEST_NAMESPACE, TEST_ACTOR, { ...final, actualMicroUsd: '3' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id)).rejects.toMatchObject({
      code: 'TEMPORARILY_UNAVAILABLE',
    });
  });
  it('fences stale dispatches and refuses unfunded execution', async () => {
    const { store, service, run } = await dispatched();
    await expect(
      service.settle(
        TEST_NAMESPACE,
        TEST_ACTOR,
        fixtureSettlement(run, { dispatchToken: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: 'AI_OUTCOME_UNKNOWN' });
    store.clock = new Date(run.deadlineAt);
    await expect(
      service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run)),
    ).rejects.toMatchObject({ code: 'AI_OUTCOME_UNKNOWN' });
    expect(store.state.settlements.size).toBe(0);
  });
  it('retains maximum liability for unknown execution across payload expiry', async () => {
    const { store, service, run } = await dispatched();
    const final = fixtureSettlement(run, {
      mode: 'unknown',
      phase: 'outcome-unknown',
      actualMicroUsd: null,
      usage: { status: 'unknown' },
      failureCode: 'AI_OUTCOME_UNKNOWN',
    });
    await service.settle(TEST_NAMESPACE, TEST_ACTOR, final);
    store.clock = new Date(store.clock.getTime() + DAY_MS);
    expect(store.state.reservations.get(run.id)).toMatchObject({
      status: 'unknown',
      maximumMicroUsd: fixtureAiIntent().reservation.maximumMicroUsd,
    });
    expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('unavailable');
    await expect(
      service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('records definitely unsent work as zero charge without a dispatch fence', async () => {
    const { store, service } = setup();
    const { run } = await service.create(fixtureAiIntent());
    await service.settle(
      TEST_NAMESPACE,
      TEST_ACTOR,
      fixtureSettlement(run, {
        mode: 'unsent',
        phase: 'cancelled',
        actualMicroUsd: '0',
        usage: { status: 'unknown' },
      }),
    );
    expect(store.state.reservations.get(run.id)?.status).toBe('settled');
    expect(store.state.settlements.get(run.id)?.actualMicroUsd).toBe('0');
  });
  it('settles confirmed unsent execution after durable dispatch intent without charging money', async () => {
    const { store, service, run } = await dispatched();
    await service.settle(
      TEST_NAMESPACE,
      TEST_ACTOR,
      fixtureSettlement(run, {
        mode: 'unsent',
        phase: 'failed',
        actualMicroUsd: '0',
        usage: { status: 'unknown' },
        failureCode: 'AI_GENERATION_FAILED',
      }),
    );
    expect(store.state.reservations.get(run.id)?.status).toBe('settled');
    expect(store.state.settlements.get(run.id)).toMatchObject({
      dispatchToken: run.dispatchToken,
      actualMicroUsd: '0',
    });
  });
  it('rolls back settlement and accounting when bounded encryption fails', async () => {
    const { store, run } = await dispatched();
    const service = new AiIntentService(
      store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION, 1),
      new AiAdmissionService(fixturePersistencePolicy()),
    );
    await expect(
      service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run), fixtureAiResult),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    expect(store.state.runs.get(run.id)?.phase).toBe('dispatching');
    expect(store.state.settlements.size).toBe(0);
    expect(store.state.reservations.get(run.id)?.status).toBe('reserved');
  });
  it('fails closed on missing or substituted private payload without recreating work', async () => {
    const { store, service, run } = await dispatched();
    await service.settle(TEST_NAMESPACE, TEST_ACTOR, fixtureSettlement(run), fixtureAiResult);
    const payload = [...store.state.payloads.values()][0]!;
    payload.originRunId = randomUUID();
    expect((await service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
    expect(store.state.runs.size).toBe(1);
    expect(store.state.receipts.size).toBe(1);
  });
  it('rejects unsafe money and unknown intent fields before a transaction', async () => {
    const { store, service } = setup();
    const input = fixtureAiIntent();
    expect(
      aiIntentSchema.safeParse({
        ...input,
        reservation: { ...input.reservation, maximumMicroUsd: '0' },
      }).success,
    ).toBe(false);
    await expect(
      service.create({ ...input, secret: 'private' } as typeof input),
    ).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(store.locks).toEqual([]);
  });
});
