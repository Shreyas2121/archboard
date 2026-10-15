import { jest } from '@jest/globals';
import { AsyncLocalStorage } from 'node:async_hooks';
import { RuntimeAdmission } from '../../../platform/lifecycle/runtime-admission.js';
import { InMemoryAiPersistence } from '../infrastructure/testing/in-memory-ai-persistence.js';
import { AesGcmAiPayloadCipher } from '../infrastructure/persistence/payload-cipher.js';
import {
  fixtureAiIntent,
  fixtureAiResult,
  fixturePersistencePolicy,
  TEST_KEY,
  TEST_KEY_VERSION,
} from '../infrastructure/testing/persistence-fixtures.js';
import { AiAdmissionService } from './admission-service.js';
import { AiIntentService } from './intent-service.js';
import { AiRunCoordinator } from './run-coordinator.js';
import { AiProviderError, type AiProvider, type ProviderEvent } from './provider.js';
import { AiRunSubscriptions } from './run-subscriptions.js';
import { AiConnectionGate } from './connection-gate.js';
import { AiOperations } from './operations.js';
import { snapshotAiConfiguration } from './persistence.js';
import { AiPersistenceError } from './persistence.js';
import { estimateAiReservation } from './pricing.js';
import { publicAiRun } from './http-service.js';

const MAX_RESULT_BYTES = 524288;
const DEADLINE_MS = 120000;
const MAX_TURNS = 100;
const TWO = 2;
const RETRY_WAIT_MS = 300;
const DRAIN_MS = 100;
const SLOW_READ_MS = 40_000;
const SUBSCRIPTION_IDLE_MS = 30_000;
const SETTLEMENT_WAIT_MS = 20;
const SMALL_OUTPUT_BYTES = 4;
const CACHE_FRAMING_INPUT_CEILING = 200;
const DIGEST_LENGTH = 64;
const usage = {
  status: 'known' as const,
  uncachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: [],
  outputTokens: 1,
  separatelyBilledReasoningTokens: 0,
  reasoningTokens: null,
};
const completed: ProviderEvent = {
  type: 'completed',
  text: JSON.stringify({ result: fixtureAiResult }),
  usage,
  requestId: null,
};
function setup(stream: AiProvider['stream'], overrides: NodeJS.ProcessEnv = {}) {
  const store = new InMemoryAiPersistence();
  const policy = fixturePersistencePolicy(overrides);
  const operations = new AiOperations(() => store.clock.getTime());
  const intents = new AiIntentService(
    store,
    new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    new AiAdmissionService(policy),
    undefined,
    operations,
  );
  const runtime = new RuntimeAdmission();
  runtime.setOwnership(true);
  runtime.setSchemaCompatible(true);
  const runs = new AiRunCoordinator(
    intents,
    runtime,
    policy,
    () => store.clock.getTime(),
    operations,
  );
  const snapshot = snapshotAiConfiguration({
    provider: policy.provider,
    profile: policy.profiles[0]!,
    policy,
  });
  const intent = fixtureAiIntent({
    snapshot,
    reservation: estimateAiReservation(snapshot, policy.limits),
  });
  const request = {
    model: intent.snapshot.model,
    task: intent.task,
    instructions: 'Use the schema',
    messages: [{ role: 'user' as const, text: 'Reviewed context' }],
    maximumOutputTokens: intent.snapshot.maximumOutputTokens,
    maximumResponseBytes: MAX_RESULT_BYTES,
    deadlineAtUnixMs: store.clock.getTime() + DEADLINE_MS,
    promptCache: 'disabled' as const,
  };
  const adapter: AiProvider = {
    id: 'openai',
    implementation: 'test-fixture',
    capabilities: () => {
      throw new Error('unused');
    },
    stream,
  };
  return { store, policy, intents, runtime, runs, intent, request, adapter, operations };
}
it('rechecks the spending switch after admission and before provider dispatch', async () => {
  const stream = jest.fn<AiProvider['stream']>(async function* () {
    yield completed;
  });
  const f = setup(stream);
  const create = f.intents.create.bind(f.intents);
  jest.spyOn(f.intents, 'create').mockImplementation(async (input) => {
    const created = await create(input);
    f.operations.setPaidEnabled(false);
    return created;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(stream).not.toHaveBeenCalled();
  expect(f.store.state.attempts).toHaveLength(0);
  expect(f.store.state.reservations.get(run.id)?.status).toBe('settled');
  expect(f.store.state.settlements.get(run.id)?.actualMicroUsd).toBe('0');
});
it('blocks fresh funded starts while the breaker is open but still replays receipts', async () => {
  const f = setup(async function* () {
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await new Promise((resolve) => setImmediate(resolve));
  const threshold = 3;
  for (let i = 0; i < threshold; i++) f.operations.acquire(f.intent.snapshot)('failure');
  expect((await f.runs.start(f.intent, f.adapter, f.request)).source).toBe('replayed');
  await expect(
    f.runs.start(fixtureAiIntent({ fingerprint: 'd'.repeat(DIGEST_LENGTH) }), f.adapter, f.request),
  ).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
  expect(f.store.state.runs.size).toBe(1);
  await finish(f.runs, run.id, f.store);
});
async function finish(runs: AiRunCoordinator, id: string, store: InMemoryAiPersistence) {
  for (let turn = 0; turn < MAX_TURNS && !store.state.settlements.has(id); turn++)
    await new Promise((r) => setImmediate(r));
  expect(store.state.settlements.has(id)).toBe(true);
  await runs.drain();
}
it('settles an incomplete response without a partial proposal and exposes a safe failure reason', async () => {
  const stream = jest.fn<AiProvider['stream']>(async function* () {
    yield { type: 'text-delta', text: '{"result":' };
    yield { type: 'incomplete', reason: 'output-limit', usage, requestId: null };
  });
  const f = setup(stream);
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  const snapshot = await f.runs.read(f.intent.deploymentNamespace, f.intent.actorUserId, run.id);
  expect(snapshot.run.phase).toBe('incomplete');
  expect(snapshot.result).toBeNull();
  expect(publicAiRun(snapshot)).toMatchObject({
    state: 'failed',
    content: { status: 'unavailable' },
    failure: { code: 'AI_GENERATION_FAILED', reason: 'incomplete' },
  });
  expect(stream).toHaveBeenCalledTimes(1);
});
it('includes conservative cache-prefix framing in input admission before intent or dispatch', async () => {
  const stream = jest.fn<AiProvider['stream']>(async function* () {
    yield completed;
  });
  const f = setup(stream);
  const intent = {
    ...f.intent,
    snapshot: { ...f.intent.snapshot, maximumInputTokens: CACHE_FRAMING_INPUT_CEILING },
  };
  await expect(
    f.runs.start(intent, f.adapter, {
      ...f.request,
      promptCache: 'stable-prefix',
      cachePartition: TEST_KEY,
    }),
  ).rejects.toMatchObject({ code: 'AI_INPUT_TOO_LARGE' });
  expect(stream).not.toHaveBeenCalled();
  expect(f.store.state.runs.size).toBe(0);
});
it('development dispatches a request above the configured input bound and settles its actual usage', async () => {
  const inputTokens = 10_000_000;
  const stream = jest.fn<AiProvider['stream']>(async function* () {
    yield { ...completed, usage: { ...usage, uncachedInputTokens: inputTokens } };
  });
  const f = setup(stream, { NODE_ENV: 'development', AI_GLOBAL_BUDGET_MICRO_USD: '1' });
  const { run } = await f.runs.start(f.intent, f.adapter, {
    ...f.request,
    messages: [{ role: 'user', text: 'x'.repeat(f.intent.snapshot.maximumInputTokens + 1) }],
  });
  await finish(f.runs, run.id, f.store);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('completed');
  expect(f.store.state.settlements.get(run.id)?.usage).toMatchObject({
    uncachedInputTokens: inputTokens,
  });
  expect(BigInt(f.store.state.settlements.get(run.id)!.actualMicroUsd!)).toBeGreaterThan(
    BigInt(f.intent.reservation.maximumMicroUsd),
  );
});
it('commits before dispatch; replay, different-key dedupe and reconnect make one call', async () => {
  let calls = 0;
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const f = setup(async function* () {
    calls++;
    expect(transactionContext.getStore()).not.toBe(true);
    expect(f.store.state.attempts).toHaveLength(1);
    await wait;
    yield completed;
  });
  const transactionContext = new AsyncLocalStorage<boolean>();
  const transact = f.store.run.bind(f.store);
  jest
    .spyOn(f.store, 'run')
    .mockImplementation(async (work) =>
      transact(async (scope) => transactionContext.run(true, () => work(scope))),
    );
  const first = await f.runs.start(f.intent, f.adapter, f.request);
  await f.runs.start(f.intent, f.adapter, f.request);
  const second = await f.runs.start(
    { ...f.intent, key: '11111111-1111-4111-8111-111111111111' },
    f.adapter,
    f.request,
  );
  expect(second.run.id).toBe(first.run.id);
  const subscriptions = new AiRunSubscriptions(f.runs, new AiConnectionGate(f.policy));
  const subscriber = subscriptions.open(
    f.intent.deploymentNamespace,
    f.intent.actorUserId,
    first.run.id,
  );
  await subscriber.next();
  subscriber.close();
  release();
  await finish(f.runs, first.run.id, f.store);
  expect(calls).toBe(1);
  expect(
    (await f.runs.read(f.intent.deploymentNamespace, f.intent.actorUserId, first.run.id)).result,
  ).toEqual(fixtureAiResult);
});
it('repairs invalid complete output once and accounts for both calls', async () => {
  let calls = 0;
  const f = setup(async function* () {
    calls++;
    yield calls === 1 ? { ...completed, text: '{}' } : completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(calls).toBe(TWO);
  expect(f.store.state.attempts).toHaveLength(TWO);
  expect(f.store.state.runs.get(run.id)?.usage).toMatchObject({ outputTokens: 2 });
});
it('retries one definitive rate rejection after backoff, with a durable claim', async () => {
  let calls = 0;
  const f = setup(async function* () {
    calls++;
    if (calls === 1)
      throw new AiProviderError({
        code: 'rate-limited',
        execution: 'definite-rejection',
        usage: { status: 'unknown' },
        retryAfterMs: 1,
        requestId: null,
      });
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
  await finish(f.runs, run.id, f.store);
  expect(calls).toBe(TWO);
  expect(f.store.state.attempts).toHaveLength(TWO);
});
it('does not retry uncertain transmission and retains funding', async () => {
  let calls = 0;
  const f = setup(async function* () {
    calls++;
    throw new Error('private failure');
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(calls).toBe(1);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
  expect(f.store.state.reservations.get(run.id)?.status).toBe('unknown');
});
it('aborts a hung provider on cancellation, fencing its late completion', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const f = setup(async function* () {
    await wait;
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await new Promise((r) => setImmediate(r));
  await f.runs.cancel(f.intent.deploymentNamespace, f.intent.actorUserId, run.id);
  release();
  await finish(f.runs, run.id, f.store);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
  expect(f.store.state.payloads.size).toBe(0);
});
it('recovers dead-worker leases without dispatch and rejects late settlement', async () => {
  let calls = 0;
  const f = setup(async function* () {
    calls++;
    yield completed;
  });
  const { run } = await f.intents.create(f.intent);
  const dispatched = await f.intents.markDispatch(
    f.intent.deploymentNamespace,
    f.intent.actorUserId,
    run.id,
  );
  const durable = f.store.state.runs.get(run.id)!;
  durable.leaseExpiresAt = new Date(f.store.clock.getTime() - 1);
  await expect(
    f.intents.claimAttempt(
      f.intent.deploymentNamespace,
      f.intent.actorUserId,
      run.id,
      dispatched.dispatchToken!,
    ),
  ).rejects.toThrow();
  f.store.clock = new Date(run.deadlineAt.getTime() + 1);
  await f.runs.recover(f.intent.deploymentNamespace, f.intent.actorUserId, run.id);
  await f.runs.start(f.intent, f.adapter, f.request);
  expect(calls).toBe(0);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
});
it('settles after authority revocation but cannot disclose a result', async () => {
  const f = setup(async function* () {
    f.store.denied.set(JSON.stringify([f.intent.actorUserId, null]), 'NOT_FOUND');
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('completed');
  await expect(
    f.runs.read(f.intent.deploymentNamespace, f.intent.actorUserId, run.id),
  ).rejects.toThrow();
});
it('bounded shutdown aborts an uncooperative provider and stops admission', async () => {
  const f = setup(async function* () {
    await new Promise(() => undefined);
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await new Promise((r) => setImmediate(r));
  f.runtime.stop();
  await f.runs.drain(DRAIN_MS);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
  await expect(f.runs.start(f.intent, f.adapter, f.request)).rejects.toThrow();
});
it('settlement outage leaves dispatch intent recoverable and replay never regenerates', async () => {
  let calls = 0;
  const f = setup(async function* () {
    calls++;
    yield completed;
  });
  jest.spyOn(f.intents, 'settle').mockRejectedValue(new Error('outage'));
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await new Promise((r) => setTimeout(r, SETTLEMENT_WAIT_MS));
  await f.runs.drain();
  expect(f.store.state.runs.get(run.id)?.phase).toBe('dispatching');
  await f.runs.start(f.intent, f.adapter, f.request).catch(() => undefined);
  expect(calls).toBe(1);
});
it('bounds complete output and retains unknown liability without repair', async () => {
  let calls = 0;
  const f = setup(async function* () {
    calls++;
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, {
    ...f.request,
    maximumResponseBytes: SMALL_OUTPUT_BYTES,
  });
  await finish(f.runs, run.id, f.store);
  expect(calls).toBe(1);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
  expect(f.store.state.payloads.size).toBe(0);
});
it('snapshot subscriptions reauthorize after revocation and do not cancel work', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const f = setup(async function* () {
    await wait;
    yield completed;
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  const subscriptions = new AiRunSubscriptions(f.runs, new AiConnectionGate(f.policy));
  const connection = subscriptions.open(f.intent.deploymentNamespace, f.intent.actorUserId, run.id);
  await connection.next();
  f.store.denied.set(JSON.stringify([f.intent.actorUserId, null]), 'NOT_FOUND');
  await expect(connection.next()).rejects.toThrow();
  release();
  await finish(f.runs, run.id, f.store);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('completed');
  subscriptions.onModuleDestroy();
});
it('keeps an active slow subscription read alive, then expires an idle consumer', async () => {
  const f = setup(async function* () {
    yield completed;
  });
  const { run } = await f.intents.create(f.intent);
  jest.useFakeTimers();
  const subscriptions = new AiRunSubscriptions(f.runs, new AiConnectionGate(f.policy));
  const connection = subscriptions.open(f.intent.deploymentNamespace, f.intent.actorUserId, run.id);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = jest
    .spyOn(f.runs, 'read')
    .mockResolvedValue({ run, result: null, content: 'pending' });
  try {
    const work = connection.next(() => wait);
    await jest.advanceTimersByTimeAsync(SLOW_READ_MS);
    expect(read).not.toHaveBeenCalled();
    release();
    await work;
    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(SUBSCRIPTION_IDLE_MS);
    await expect(connection.next()).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    subscriptions.onModuleDestroy();
    jest.useRealTimers();
  }
});
it('retries an ambiguous settlement commit without executing the provider again', async () => {
  const stream = jest.fn<AiProvider['stream']>(async function* () {
    yield completed;
  });
  const f = setup(stream);
  const settle = f.intents.settle.bind(f.intents);
  let failed = false;
  jest.spyOn(f.intents, 'settle').mockImplementation(async (...args) => {
    await settle(...args);
    if (!failed) {
      failed = true;
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    }
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(f.store.state.settlements.size).toBe(1);
  expect(f.store.state.payloads.size).toBe(1);
  expect(f.operations.snapshot().settlement_failures).toBe('1');
});
it('publishes a terminal content failure while preserving known charges if encryption rejects the result', async () => {
  const f = setup(async function* () {
    yield completed;
  });
  const settle = f.intents.settle.bind(f.intents);
  jest.spyOn(f.intents, 'settle').mockImplementation(async (...args) => {
    if (args[3]) throw new AiPersistenceError('AI_OUTPUT_INVALID');
    await settle(...args);
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(f.store.state.runs.get(run.id)).toMatchObject({
    phase: 'failed',
    failureCode: 'AI_OUTPUT_INVALID',
  });
  expect(f.store.state.settlements.get(run.id)).toMatchObject({ mode: 'known', usage });
  expect(f.store.state.reservations.get(run.id)?.status).toBe('settled');
  expect(f.store.state.payloads.size).toBe(0);
});
it('settles authoritative failed-provider usage without losing its known charge', async () => {
  const f = setup(async function* () {
    yield await Promise.reject(
      new AiProviderError({
        code: 'overloaded',
        execution: 'may-have-started',
        usage,
        requestId: null,
        retryAfterMs: null,
      }),
    );
  });
  const { run } = await f.runs.start(f.intent, f.adapter, f.request);
  await finish(f.runs, run.id, f.store);
  expect(f.store.state.runs.get(run.id)?.phase).toBe('failed');
  expect(f.store.state.settlements.get(run.id)?.mode).toBe('known');
  expect(f.operations.snapshot().provider_failures).toBe('1');
});
