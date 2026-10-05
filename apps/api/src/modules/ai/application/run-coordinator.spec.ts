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

const MAX_RESULT_BYTES = 524288;
const DEADLINE_MS = 120000;
const MAX_TURNS = 100;
const TWO = 2;
const RETRY_WAIT_MS = 300;
const DRAIN_MS = 100;
const SETTLEMENT_WAIT_MS = 20;
const SMALL_OUTPUT_BYTES = 4;
const CACHE_FRAMING_INPUT_CEILING = 200;
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
function setup(stream: AiProvider['stream']) {
  const store = new InMemoryAiPersistence();
  const policy = fixturePersistencePolicy();
  const intents = new AiIntentService(
    store,
    new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    new AiAdmissionService(policy),
  );
  const runtime = new RuntimeAdmission();
  runtime.setOwnership(true);
  runtime.setSchemaCompatible(true);
  const runs = new AiRunCoordinator(intents, runtime, policy, () => store.clock.getTime());
  const intent = fixtureAiIntent();
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
  return { store, policy, intents, runtime, runs, intent, request, adapter };
}
async function finish(runs: AiRunCoordinator, id: string, store: InMemoryAiPersistence) {
  for (let turn = 0; turn < MAX_TURNS && !store.state.settlements.has(id); turn++)
    await new Promise((r) => setImmediate(r));
  expect(store.state.settlements.has(id)).toBe(true);
  await runs.drain();
}
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
