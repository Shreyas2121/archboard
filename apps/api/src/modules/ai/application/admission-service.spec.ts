import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { AiAdmissionService, AiAdmissionError, aiPeriodStart } from './admission-service.js';
import { AiConnectionGate } from './connection-gate.js';
import { AiIntentService } from './intent-service.js';
import { estimateAiReservation, priceAiUsage } from './pricing.js';
import { snapshotAiConfiguration, type AiIntent, type AiRunRecord } from './persistence.js';
import { fixtureAiPolicy } from '../infrastructure/testing/fixture-config.js';
import {
  fixtureAiIntent,
  fixtureAiResult,
  fixtureSettlement,
  TEST_KEY,
  TEST_KEY_VERSION,
} from '../infrastructure/testing/persistence-fixtures.js';
import { InMemoryAiPersistence } from '../infrastructure/testing/in-memory-ai-persistence.js';
import { AesGcmAiPayloadCipher } from '../infrastructure/persistence/payload-cipher.js';
const MINUTE = 60_000;
const SECOND = 1000;
const DAY = 86_400_000;
const THREE = 3;
const TWO = 2;
const MAX_BIGINT = '9223372036854775807';
function setup(overrides: NodeJS.ProcessEnv = {}) {
  const policy = fixtureAiPolicy({
    AI_CREATE_BURST: '100',
    AI_CREATE_PER_MINUTE: '100',
    AI_PROVIDER_INPUT_TPM: '100000',
    AI_PROVIDER_OUTPUT_TPM: '100000',
    AI_GLOBAL_CONCURRENCY: '10',
    AI_ACTOR_CONCURRENCY: '10',
    ...overrides,
  });
  const snapshot = snapshotAiConfiguration({
    provider: 'openai',
    profile: policy.profiles[0]!,
    policy,
  });
  const store = new InMemoryAiPersistence();
  const admission = new AiAdmissionService(policy);
  const service = new AiIntentService(
    store,
    new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    admission,
  );
  const intent = (actor = 'fixture-actor'): AiIntent =>
    fixtureAiIntent({
      actorUserId: actor,
      snapshot,
      reservation: estimateAiReservation(snapshot, policy.limits),
      key: randomUUID(),
      fingerprint: randomUUID().replaceAll('-', '').repeat(TWO),
    });
  return { policy, snapshot, store, admission, service, intent };
}
const budget = (store: InMemoryAiPersistence, period: string, scope = 'global') =>
  [...store.state.ledger.values()].filter(
    (row) => row.kind === 'budget' && row.period === period && row.scope === scope,
  );
const unsent = (run: AiRunRecord) =>
  fixtureSettlement(run, {
    mode: 'unsent',
    phase: 'cancelled',
    actualMicroUsd: '0',
    usage: { status: 'unknown' },
  });
describe('integer AI pricing and full-attempt conservative reservation', () => {
  it('availability includes current reservations and unknown liabilities across rollover', async () => {
    const f = setup({
      AI_DAILY_BUDGET_MICRO_USD: '6',
      AI_MONTHLY_BUDGET_MICRO_USD: '6',
      AI_GLOBAL_BUDGET_MICRO_USD: '6',
    });
    const input = f.intent();
    const before = await f.admission.availability(
      f.store,
      input.deploymentNamespace,
      input.actorUserId,
      null,
    );
    expect(before).toMatchObject({
      available: true,
      allowance: { remainingMicroUsd: '6', resetsAt: null },
    });
    const run = (await f.service.create(input)).run;
    const held = await f.admission.availability(
      f.store,
      input.deploymentNamespace,
      input.actorUserId,
      null,
    );
    expect(held).toMatchObject({
      available: false,
      reason: 'allowance-reached',
      allowance: { remainingMicroUsd: '0', resetsAt: null },
    });
    const dispatched = await f.service.markDispatch(
      input.deploymentNamespace,
      input.actorUserId,
      run.id,
    );
    await f.service.settle(
      input.deploymentNamespace,
      input.actorUserId,
      fixtureSettlement(dispatched, {
        mode: 'unknown',
        phase: 'outcome-unknown',
        usage: { status: 'unknown' },
        actualMicroUsd: null,
        failureCode: 'AI_OUTCOME_UNKNOWN',
      }),
    );
    f.store.clock = new Date(f.store.clock.getTime() + DAY);
    const unknown = await f.admission.availability(
      f.store,
      input.deploymentNamespace,
      input.actorUserId,
      null,
    );
    expect(unknown).toMatchObject({
      available: false,
      allowance: { remainingMicroUsd: '0', resetsAt: null },
    });
  });
  it('availability consumes poll frequency and rechecks board authority', async () => {
    const f = setup({ AI_POLLS_PER_MINUTE: '1' });
    const input = f.intent();
    await f.admission.availability(f.store, input.deploymentNamespace, input.actorUserId, null);
    await expect(
      f.admission.availability(f.store, input.deploymentNamespace, input.actorUserId, null),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const board = randomUUID();
    f.store.denied.set(JSON.stringify([input.actorUserId, board]), 'FORBIDDEN');
    await expect(
      f.admission.availability(f.store, input.deploymentNamespace, input.actorUserId, board),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('covers per-category upward rounding when full input is split among read/write/uncached classes', () => {
    const { snapshot } = setup();
    const split = {
      ...snapshot,
      prices: {
        ...snapshot.prices,
        cacheReadMicroUsdPerMillion: '1',
        cacheWrites: [{ writeClass: 'write', microUsdPerMillion: '1' }],
      },
    };
    const maximum = estimateAiReservation(split, { repairs: 0, rejectionRetries: 0 });
    expect(maximum.maximumMicroUsd).toBe('4');
    const usage = {
      status: 'known' as const,
      uncachedInputTokens: 1,
      cacheReadInputTokens: 1,
      cacheWriteInputTokens: [{ writeClass: 'write', tokens: 1 }],
      outputTokens: 1,
      separatelyBilledReasoningTokens: 0,
      reasoningTokens: null,
    };
    expect(priceAiUsage(split, usage)).toBe(maximum.maximumMicroUsd);
  });
  it('reserves full input/output for all repairs/retries without assuming a cache hit', () => {
    const { snapshot, policy } = setup();
    expect(estimateAiReservation(snapshot, policy.limits)).toEqual({
      maximumMicroUsd: '6',
      inputTokens: '3000',
      outputTokens: '300',
      maximumAttempts: THREE,
    });
  });
  it('rounds disjoint billable categories upward without counting included reasoning twice', () => {
    const { snapshot } = setup();
    const priced = {
      ...snapshot,
      prices: {
        ...snapshot.prices,
        uncachedInputMicroUsdPerMillion: '1000001',
        cacheReadMicroUsdPerMillion: '500001',
        cacheWrites: [{ writeClass: 'long', microUsdPerMillion: '2000001' }],
        outputMicroUsdPerMillion: '1000001',
        separateReasoningMicroUsdPerMillion: '1000001',
      },
    };
    expect(
      priceAiUsage(priced, {
        status: 'known',
        uncachedInputTokens: 1,
        cacheReadInputTokens: 1,
        cacheWriteInputTokens: [{ writeClass: 'long', tokens: 1 }],
        outputTokens: 1,
        separatelyBilledReasoningTokens: 1,
        reasoningTokens: 1,
      }),
    ).toBe('10');
    expect(
      BigInt(estimateAiReservation(priced, { repairs: 0, rejectionRetries: 0 }).maximumMicroUsd),
    ).toBeGreaterThan(
      BigInt(estimateAiReservation(snapshot, { repairs: 0, rejectionRetries: 0 }).maximumMicroUsd),
    );
  });
  it('rejects unknown pricing/classes, double classes, zero prices and bigint overflow', () => {
    const { snapshot } = setup();
    expect(() => priceAiUsage(snapshot, { status: 'unknown' })).toThrow();
    const usage = fixtureSettlement({
      id: randomUUID(),
      dispatchToken: randomUUID(),
    } as AiRunRecord).usage;
    if (usage.status !== 'known') throw new Error('fixture');
    expect(() =>
      priceAiUsage(snapshot, {
        ...usage,
        cacheWriteInputTokens: [{ writeClass: 'missing', tokens: 1 }],
      }),
    ).toThrow();
    expect(() =>
      priceAiUsage(snapshot, {
        ...usage,
        cacheWriteInputTokens: [
          { writeClass: 'missing', tokens: 1 },
          { writeClass: 'missing', tokens: 1 },
        ],
      }),
    ).toThrow();
    expect(() =>
      estimateAiReservation(
        { ...snapshot, prices: { ...snapshot.prices, outputMicroUsdPerMillion: '0' } },
        { repairs: 0, rejectionRetries: 0 },
      ),
    ).toThrow();
    expect(() =>
      estimateAiReservation(
        {
          ...snapshot,
          maximumOutputTokens: Number.MAX_SAFE_INTEGER,
          prices: { ...snapshot.prices, outputMicroUsdPerMillion: MAX_BIGINT },
        },
        { repairs: 1, rejectionRetries: 1 },
      ),
    ).toThrow();
  });
});
describe('durable admission with fake-clock transactional contention', () => {
  it('funds intent/receipt/counters/allocations atomically and does not double-reserve replay', async () => {
    const c = setup();
    const input = c.intent();
    const { run } = await c.service.create(input);
    expect(run.phase).toBe('admitted');
    expect(budget(c.store, 'lifetime')[0]?.reserved).toBe('6');
    expect((await c.service.create(input)).source).toBe('replayed');
    expect((await c.service.create({ ...input, key: randomUUID() })).source).toBe('deduplicated');
    expect(budget(c.store, 'lifetime')[0]?.reserved).toBe('6');
    expect(c.store.state.allocations.filter((row) => row.runId === run.id).length).toBeGreaterThan(
      1,
    );
  });
  it('counts cheap requests on replay and failed funding with a precise window Retry-After', async () => {
    const c = setup({ AI_CREATE_BURST: '1', AI_DAILY_BUDGET_MICRO_USD: '1' });
    const input = c.intent();
    await expect(c.service.create(input)).rejects.toMatchObject({ code: 'AI_ALLOWANCE_REACHED' });
    expect(c.store.state.runs.size).toBe(0);
    expect(c.store.state.allocations).toHaveLength(0);
    await expect(c.service.create(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 1,
    });
    c.store.clock = new Date(c.store.clock.getTime() + SECOND);
    await expect(c.service.create(input)).rejects.toMatchObject({ code: 'AI_ALLOWANCE_REACHED' });
  });
  it.each(['AI_ACTOR_CONCURRENCY', 'AI_GLOBAL_CONCURRENCY'] as const)(
    'serializes contention at %s without partial paid intent',
    async (control) => {
      const c = setup({ AI_ACTOR_CONCURRENCY: '1', [control]: '1' });
      const results = await Promise.allSettled([
        c.service.create(c.intent()),
        c.service.create(
          c.intent(control === 'AI_GLOBAL_CONCURRENCY' ? 'another-actor' : 'fixture-actor'),
        ),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(c.store.state.runs.size).toBe(1);
      expect(budget(c.store, 'lifetime')[0]?.reserved).toBe('6');
    },
  );
  it.each([
    'AI_DAILY_BUDGET_MICRO_USD',
    'AI_MONTHLY_BUDGET_MICRO_USD',
    'AI_GLOBAL_BUDGET_MICRO_USD',
    'AI_ACTOR_DAILY_BUDGET_MICRO_USD',
  ] as const)('atomically enforces %s', async (control) => {
    const c = setup({ [control]: '6' });
    await c.service.create(c.intent());
    await expect(c.service.create(c.intent())).rejects.toMatchObject({
      code: 'AI_ALLOWANCE_REACHED',
    });
    expect(c.store.state.runs.size).toBe(1);
  });
  it.each(['AI_PROVIDER_RPM', 'AI_PROVIDER_INPUT_TPM', 'AI_PROVIDER_OUTPUT_TPM'] as const)(
    'fails closed when %s cannot reserve full allowance',
    async (control) => {
      const c = setup({
        [control]:
          control === 'AI_PROVIDER_INPUT_TPM'
            ? '1000'
            : control === 'AI_PROVIDER_OUTPUT_TPM'
              ? '100'
              : '1',
      });
      await expect(c.service.create(c.intent())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(c.store.state.allocations).toHaveLength(0);
      expect(c.store.state.runs.size).toBe(0);
    },
  );
  it('does not refill fresh quotas on restart and uses fixed UTC minute/day boundaries', async () => {
    const c = setup({ AI_FRESH_PER_MINUTE: '1' });
    const { run } = await c.service.create(c.intent());
    await c.service.settle(c.policy.deploymentNamespace, run.actorUserId, unsent(run));
    const restarted = new AiIntentService(
      c.store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
      new AiAdmissionService(c.policy),
    );
    await expect(restarted.create(c.intent())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    });
    c.store.clock = new Date(c.store.clock.getTime() + MINUTE);
    expect((await restarted.create(c.intent())).run.phase).toBe('admitted');
    expect(aiPeriodStart(new Date('2026-11-01T00:00:00.001Z'), 'month').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
  it('claims every attempt once within total bounds, records failed calls and transfers reserved tokens across minutes', async () => {
    const c = setup();
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    c.store.clock = new Date(c.store.clock.getTime() + MINUTE);
    await c.service.claimAttempt(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
      started.dispatchToken!,
    );
    await c.service.claimAttempt(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
      started.dispatchToken!,
    );
    await expect(
      c.service.claimAttempt(
        c.policy.deploymentNamespace,
        run.actorUserId,
        run.id,
        started.dispatchToken!,
      ),
    ).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(c.store.state.attempts).toHaveLength(THREE);
    await c.service.settle(
      c.policy.deploymentNamespace,
      run.actorUserId,
      fixtureSettlement(started, { phase: 'failed' }),
    );
    const requests = [...c.store.state.ledger.values()].filter(
      (row) =>
        row.kind === 'capacity' && row.metric === 'provider-request' && row.period === 'minute',
    );
    expect(requests.map((row) => row.committed).sort()).toEqual(['1', '2']);
  });
  it('settles money and releases concurrency once; dispatched quota stays consumed', async () => {
    const c = setup();
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    const final = fixtureSettlement(started);
    await c.service.settle(c.policy.deploymentNamespace, run.actorUserId, final, fixtureAiResult);
    await c.service.settle(c.policy.deploymentNamespace, run.actorUserId, final);
    expect(budget(c.store, 'lifetime')[0]).toMatchObject({ committed: '2', reserved: '0' });
    expect(
      [...c.store.state.ledger.values()]
        .filter((row) => row.metric === 'concurrency')
        .every((row) => row.reserved === '0'),
    ).toBe(true);
    expect(
      [...c.store.state.ledger.values()].find(
        (row) => row.metric === 'provider-input' && row.period === 'minute',
      )?.committed,
    ).toBe('1000');
  });
  it('carries unknown liability over UTC day/month despite private result expiry and frees local execution capacity', async () => {
    const c = setup({ AI_DAILY_BUDGET_MICRO_USD: '10', AI_MONTHLY_BUDGET_MICRO_USD: '10' });
    c.store.clock = new Date('2026-10-31T23:59:00Z');
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    await c.service.settle(
      c.policy.deploymentNamespace,
      run.actorUserId,
      fixtureSettlement(started, {
        mode: 'unknown',
        phase: 'outcome-unknown',
        actualMicroUsd: null,
        usage: { status: 'unknown' },
      }),
    );
    c.store.clock = new Date(c.store.clock.getTime() + DAY);
    await expect(c.service.create(c.intent())).rejects.toMatchObject({
      code: 'AI_ALLOWANCE_REACHED',
    });
    expect(budget(c.store, 'lifetime')[0]?.reserved).toBe('6');
    expect(
      [...c.store.state.ledger.values()]
        .filter((row) => row.metric === 'concurrency')
        .every((row) => row.reserved === '0'),
    ).toBe(true);
  });
  it('charges known completion across a calendar boundary to origin and settlement periods', async () => {
    const c = setup();
    c.store.clock = new Date('2026-10-31T23:59:30Z');
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    c.store.clock = new Date(c.store.clock.getTime() + MINUTE);
    await c.service.settle(
      c.policy.deploymentNamespace,
      run.actorUserId,
      fixtureSettlement(started),
    );
    expect(budget(c.store, 'day').map((row) => row.committed)).toEqual(['2', '2']);
    expect(budget(c.store, 'month').map((row) => row.committed)).toEqual(['2', '2']);
    expect(budget(c.store, 'lifetime')[0]?.committed).toBe('2');
  });
  it('rolls back all funded effects after receipt/encryption failure', async () => {
    const c = setup();
    c.store.failReceipt = true;
    await expect(c.service.create(c.intent())).rejects.toThrow();
    expect(c.store.state.allocations).toHaveLength(0);
    expect(budget(c.store, 'lifetime')).toHaveLength(0);
  });
  it('blocks disabled, zero/missing budgets, under-reservation and unsupported snapshots before dispatch', async () => {
    const c = setup();
    const disabled = new AiIntentService(
      c.store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
      new AiAdmissionService(null),
    );
    await expect(disabled.create(c.intent())).rejects.toMatchObject({ code: 'AI_DISABLED' });
    for (const value of ['0', undefined]) {
      const invalid = new AiAdmissionService({
        ...c.policy,
        budgets: { ...c.policy.budgets, dailyMicroUsd: value as unknown as string },
      });
      await expect(
        invalid.request(c.store, c.policy.deploymentNamespace, 'actor', null, 'create'),
      ).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    }
    const input = c.intent();
    await expect(
      c.service.create({ ...input, reservation: { ...input.reservation, maximumMicroUsd: '1' } }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNSUPPORTED' });
    expect(c.store.state.runs.size).toBe(0);
  });
  it('bounds status polling independently and SSE leases release idempotently', async () => {
    const c = setup({ AI_POLLS_PER_MINUTE: '1', AI_SSE_CONNECTIONS_PER_ACTOR: '1' });
    await c.admission.request(c.store, c.policy.deploymentNamespace, 'actor', null, 'poll');
    await expect(
      c.admission.request(c.store, c.policy.deploymentNamespace, 'actor', null, 'poll'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
    const connections = new AiConnectionGate(c.policy);
    const release = connections.acquire(c.policy.deploymentNamespace, 'actor');
    expect(() => connections.acquire(c.policy.deploymentNamespace, 'actor')).toThrow(
      AiAdmissionError,
    );
    release();
    release();
    expect(() => connections.acquire(c.policy.deploymentNamespace, 'actor')).not.toThrow();
  });
  it('rejects forged prices and usage beyond claimed capacity without releasing liability', async () => {
    const c = setup();
    const input = c.intent();
    await expect(
      c.service.create({
        ...input,
        snapshot: {
          ...input.snapshot,
          prices: { ...input.snapshot.prices, outputMicroUsdPerMillion: '1' },
        },
      }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNSUPPORTED' });
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    const final = fixtureSettlement(started);
    if (final.usage.status !== 'known') throw new Error('fixture');
    await expect(
      c.service.settle(c.policy.deploymentNamespace, run.actorUserId, {
        ...final,
        usage: { ...final.usage, outputTokens: Number.MAX_SAFE_INTEGER },
      }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNSUPPORTED' });
    await expect(
      c.service.settle(c.policy.deploymentNamespace, run.actorUserId, {
        ...final,
        mode: 'unsent',
        phase: 'failed',
        actualMicroUsd: '0',
      }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNSUPPORTED' });
    expect(budget(c.store, 'lifetime')[0]?.reserved).toBe('6');
    expect(c.store.state.settlements.size).toBe(0);
  });
  it('rolls back monetary settlement if result encryption cannot commit', async () => {
    const c = setup();
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    const failed = new AiIntentService(
      c.store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION, 1),
      c.admission,
    );
    await expect(
      failed.settle(
        c.policy.deploymentNamespace,
        run.actorUserId,
        fixtureSettlement(started),
        fixtureAiResult,
      ),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    expect(budget(c.store, 'lifetime')[0]).toMatchObject({ reserved: '6', committed: '0' });
    expect(c.store.state.reservations.get(run.id)?.status).toBe('reserved');
    expect(c.store.state.settlements.size).toBe(0);
  });
  it('retains actor spending when an optional daily ceiling is enabled after restart', async () => {
    const c = setup();
    const { run } = await c.service.create(c.intent());
    const started = await c.service.markDispatch(
      c.policy.deploymentNamespace,
      run.actorUserId,
      run.id,
    );
    await c.service.settle(
      c.policy.deploymentNamespace,
      run.actorUserId,
      fixtureSettlement(started),
    );
    const policy = setup({ AI_ACTOR_DAILY_BUDGET_MICRO_USD: '7' }).policy;
    const snapshot = snapshotAiConfiguration({
      provider: 'openai',
      profile: policy.profiles[0]!,
      policy,
    });
    const restarted = new AiIntentService(
      c.store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
      new AiAdmissionService(policy),
    );
    await expect(
      restarted.create({
        ...c.intent(),
        snapshot,
        reservation: estimateAiReservation(snapshot, policy.limits),
      }),
    ).rejects.toMatchObject({ code: 'AI_ALLOWANCE_REACHED' });
    expect(budget(c.store, 'day', 'actor')[0]?.committed).toBe('2');
  });
});
