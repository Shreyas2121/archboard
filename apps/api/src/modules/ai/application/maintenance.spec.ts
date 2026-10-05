import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { RuntimeAdmission } from '../../../platform/lifecycle/runtime-admission.js';
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
import { AiIntentService } from './intent-service.js';
import { AiAdmissionService } from './admission-service.js';
import { AiResultCache } from './result-cache.js';
import { AiMaintenance } from './maintenance.js';
import { AiOperations } from './operations.js';
const TWO = 2;
const SHUTDOWN_MS = 1000;
const INTERVAL_MS = 30_000;

function setup() {
  const store = new InMemoryAiPersistence();
  const policy = fixturePersistencePolicy();
  const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
  const ops = new AiOperations();
  const intents = new AiIntentService(
    store,
    cipher,
    new AiAdmissionService(policy),
    new AiResultCache(cipher, policy.cache),
    ops,
  );
  const runtime = new RuntimeAdmission();
  runtime.setOwnership(true);
  runtime.setSchemaCompatible(true);
  const maintenance = new AiMaintenance(store, intents, runtime, TEST_NAMESPACE, ops);
  return { store, policy, cipher, ops, intents, runtime, maintenance };
}
it('expires at fixed TTL, restores entry/byte capacity, and preserves receipts/accounting', async () => {
  const f = setup();
  const input = fixtureAiIntent();
  const { run } = await f.intents.create(input);
  const dispatched = await f.intents.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
  const settlement = fixtureSettlement(dispatched);
  await f.intents.settle(TEST_NAMESPACE, TEST_ACTOR, settlement, fixtureAiResult);
  await f.intents.settle(TEST_NAMESPACE, TEST_ACTOR, settlement, fixtureAiResult);
  expect(f.ops.snapshot().settled_micro_usd).toBe('2');
  expect((await f.intents.create({ ...input, key: randomUUID() })).source).toBe('cache');
  expect(f.ops.snapshot().cache_hits).toBe('1');
  f.store.clock = new Date(f.store.clock.getTime() + f.policy.cache.ttlMs);
  await f.maintenance.tick();
  expect(f.ops.snapshot()).toMatchObject({
    retained_entries: '0',
    retained_bytes: '0',
    cleanup_deleted: '1',
    cleanup_backlog: '0',
  });
  expect(f.store.state.cache.size).toBe(0);
  expect(f.store.state.receipts.size).toBe(TWO);
  expect(f.store.state.settlements.size).toBe(1);
  expect(f.store.state.reservations.get(run.id)?.status).toBe('settled');
  expect((await f.intents.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
});
it('recovers an abandoned dispatch after restart as unknown without another attempt', async () => {
  const f = setup();
  const { run } = await f.intents.create(fixtureAiIntent());
  await f.intents.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
  f.store.clock = run.deadlineAt;
  f.ops.setPaidEnabled(false); // cleanup/recovery continues while spending is disabled
  await f.maintenance.tick();
  await f.maintenance.tick();
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
  expect(f.store.state.reservations.get(run.id)?.status).toBe('unknown');
  expect(f.store.state.attempts).toHaveLength(1);
  expect(f.ops.snapshot().unknown_outcomes).toBe('1');
});
it('discovers an expired dispatch lease even while the original total deadline is still future', async () => {
  const f = setup();
  const { run } = await f.intents.create(fixtureAiIntent());
  await f.intents.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
  f.store.state.runs.get(run.id)!.leaseExpiresAt = f.store.clock;
  expect(run.deadlineAt.getTime()).toBeGreaterThan(f.store.clock.getTime());
  await f.maintenance.tick();
  expect(f.store.state.runs.get(run.id)?.phase).toBe('outcome-unknown');
  expect(f.store.state.reservations.get(run.id)?.status).toBe('unknown');
  expect(f.store.state.attempts).toHaveLength(1);
});
it('bounds batches, excludes other namespaces and reports remaining backlog', async () => {
  const f = setup();
  const count = 65;
  for (let i = 0; i < count; i++) {
    const payload = f.cipher.seal(
      {
        deploymentNamespace: TEST_NAMESPACE,
        actorUserId: TEST_ACTOR,
        originRunId: randomUUID(),
        id: randomUUID(),
        schemaVersion: 1,
        keyVersion: TEST_KEY_VERSION,
        expiresAt: f.store.clock,
      },
      fixtureAiResult,
    );
    f.store.state.payloads.set(payload.id, payload);
  }
  const other = f.cipher.seal(
    {
      deploymentNamespace: 'other',
      actorUserId: TEST_ACTOR,
      originRunId: randomUUID(),
      id: randomUUID(),
      schemaVersion: 1,
      keyVersion: TEST_KEY_VERSION,
      expiresAt: f.store.clock,
    },
    fixtureAiResult,
  );
  f.store.state.payloads.set(other.id, other);
  await f.maintenance.tick();
  expect(f.ops.snapshot().cleanup_backlog).toBe('1');
  expect(f.store.state.payloads.size).toBe(TWO);
  await f.maintenance.tick();
  expect(f.store.state.payloads.size).toBe(1);
  expect(f.store.state.payloads.has(other.id)).toBe(true);
});
it('schedules with a fake clock only while runtime owns admission and stops its timer', async () => {
  jest.useFakeTimers();
  try {
    const f = setup();
    const run = jest.spyOn(f.store, 'run');
    f.runtime.setSchemaCompatible(false);
    f.maintenance.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    f.runtime.setSchemaCompatible(true);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await f.maintenance.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
it('does not overlap passes, stops scheduling, and bounds shutdown even with stalled persistence', async () => {
  jest.useFakeTimers();
  try {
    const f = setup();
    const run = jest.spyOn(f.store, 'run').mockImplementation(() => new Promise(() => undefined));
    const first = f.maintenance.tick();
    expect(f.maintenance.tick()).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    const closing = f.maintenance.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(SHUTDOWN_MS);
    await closing;
    await f.maintenance.tick();
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
