import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { AiResult } from '@archboard/contracts';
import { AiIntentService } from './intent-service.js';
import { AiAdmissionService } from './admission-service.js';
import { AiResultCache } from './result-cache.js';
import type { AiIntent, AiRunRecord } from './persistence.js';
import type { AiPolicy } from './operator-policy.js';
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

const TWO = 2;
const TTL_MS = 900000;
const BYTE_OVERHEAD = 28;
const OTHER_KEY = 'f'.repeat(TEST_KEY.length);
const fresh = (overrides: Partial<AiIntent> = {}) =>
  fixtureAiIntent({ fingerprint: randomUUID().replaceAll('-', '').repeat(TWO), ...overrides });
function setup(
  limits: Partial<AiPolicy['cache']> = {},
  store = new InMemoryAiPersistence(),
  key = TEST_KEY,
) {
  const policy = fixturePersistencePolicy();
  const cipher = new AesGcmAiPayloadCipher(key, TEST_KEY_VERSION);
  const cache = new AiResultCache(cipher, { ...policy.cache, ...limits });
  const service = new AiIntentService(store, cipher, new AiAdmissionService(policy), cache);
  return { store, policy, cipher, cache, service };
}
async function complete(
  f: ReturnType<typeof setup>,
  input = fresh(),
  result: AiResult = fixtureAiResult,
): Promise<AiRunRecord> {
  const { run } = await f.service.create(input);
  const dispatched = await f.service.markDispatch(
    input.deploymentNamespace,
    input.actorUserId,
    run.id,
  );
  await f.service.settle(
    input.deploymentNamespace,
    input.actorUserId,
    fixtureSettlement(dispatched),
    result,
  );
  return (await f.service.read(input.deploymentNamespace, input.actorUserId, run.id)).run;
}
it('hits under a new key without another reservation or copy, and receipts replay without sliding TTL', async () => {
  const f = setup();
  const input = fresh();
  const run = await complete(f, input);
  const originalExpiry = run.payloadExpiresAt!.getTime();
  f.store.clock = new Date(f.store.clock.getTime() + 1);
  const key = randomUUID();
  const hit = await f.service.create({ ...input, key });
  expect(hit.source).toBe('cache');
  expect(hit.run.id).toBe(run.id);
  expect(f.store.state.payloads.size).toBe(1);
  expect(f.store.state.reservations.size).toBe(1);
  expect(hit.run.payloadExpiresAt!.getTime()).toBe(originalExpiry);
  expect((await f.service.create({ ...input, key })).source).toBe('replayed');
});
it('serializes simultaneous hit and miss requests rather than admitting multiple paid intents', async () => {
  const f = setup();
  const input = fresh();
  const starts = await Promise.all([
    f.service.create(input),
    f.service.create({ ...input, key: randomUUID() }),
  ]);
  expect(starts.map((value) => value.source).sort()).toEqual(['created', 'deduplicated']);
  const dispatched = await f.service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, starts[0]!.run.id);
  await f.service.settle(
    TEST_NAMESPACE,
    TEST_ACTOR,
    fixtureSettlement(dispatched),
    fixtureAiResult,
  );
  const hits = await Promise.all([
    f.service.create({ ...input, key: randomUUID() }),
    f.service.create({ ...input, key: randomUUID() }),
  ]);
  expect(hits.every((value) => value.source === 'cache')).toBe(true);
  expect(f.store.state.reservations.size).toBe(1);
});
it('reauthorizes before cache returns and receipt replay after revocation', async () => {
  const f = setup();
  const input = fresh({ boardId: randomUUID() });
  await complete(f, input);
  f.store.denied.set(JSON.stringify([TEST_ACTOR, input.boardId]), 'NOT_FOUND');
  await expect(f.service.create({ ...input, key: randomUUID() })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(f.service.create(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(f.store.state.reservations.size).toBe(1);
});
it('rejects cross-actor, cross-board and changed task/snapshot even for a forged matching fingerprint', async () => {
  for (const changed of [
    { actorUserId: 'other-actor' },
    { boardId: randomUUID() },
    { task: 'propose-design' as const },
  ]) {
    const f = setup();
    const input = fresh();
    await complete(f, input);
    const result = await f.service.create({ ...input, ...changed, key: randomUUID() });
    expect(result.source).toBe('created');
    expect(f.store.state.payloads.size).toBe(1);
  }
});
it('expiry reads never submit inference; old receipt stays expired while an explicit new key is a miss', async () => {
  const f = setup();
  const input = fresh();
  const run = await complete(f, input);
  f.store.clock = new Date(f.store.clock.getTime() + TTL_MS);
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
  expect((await f.service.create(input)).source).toBe('replayed');
  expect(f.store.state.reservations.size).toBe(1);
  expect((await f.service.create({ ...input, key: randomUUID() })).source).toBe('created');
});
it('enforces actor entry caps and evicts content/index without modifying immutable accounting', async () => {
  const f = setup({ actorEntries: 1 });
  const first = await complete(f);
  const original = f.store.state.settlements.get(first.id);
  f.store.clock = new Date(f.store.clock.getTime() + 1);
  const second = await complete(f);
  expect(f.store.state.payloads.size).toBe(1);
  expect(f.store.state.cache.size).toBe(1);
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, first.id)).content).toBe('expired');
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, second.id)).content).toBe('available');
  expect(f.store.state.settlements.get(first.id)).toEqual(original);
  expect(f.store.state.receipts.size).toBe(TWO);
  expect(f.store.state.reservations.size).toBe(TWO);
});
it('enforces global entries across actors', async () => {
  const f = setup({ entries: 1 });
  const first = await complete(f);
  await complete(f, fresh({ actorUserId: 'other-actor' }));
  expect(f.store.state.payloads.size).toBe(1);
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, first.id)).content).toBe('expired');
});
it.each(['bytes', 'actorBytes'] as const)(
  'accounts for ciphertext and authentication overhead in %s caps',
  async (limit) => {
    const bytes = Buffer.byteLength(JSON.stringify(fixtureAiResult)) + BYTE_OVERHEAD;
    const f = setup({ [limit]: bytes });
    const first = await complete(f);
    await complete(f);
    expect(f.store.state.payloads.size).toBe(1);
    expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, first.id)).content).toBe('expired');
    expect([...f.store.state.payloads.values()].reduce((sum, p) => sum + p.byteLength, 0)).toBe(
      bytes,
    );
  },
);
it('capacity too small commits truthful completed metadata without storing oversized content', async () => {
  const f = setup({ actorBytes: 1 });
  const run = await complete(f);
  expect(run.phase).toBe('completed');
  expect(f.store.state.payloads.size).toBe(0);
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
  expect(f.store.state.reservations.get(run.id)?.status).toBe('settled');
});
it.each(['failed', 'refused', 'incomplete', 'cancelled', 'outcome-unknown'] as const)(
  'does not index terminal %s',
  async (phase) => {
    const f = setup();
    const input = fresh();
    const { run } = await f.service.create(input);
    const dispatched = await f.service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
    await f.service.settle(
      TEST_NAMESPACE,
      TEST_ACTOR,
      fixtureSettlement(dispatched, {
        phase,
        ...(phase === 'outcome-unknown'
          ? { mode: 'unknown', actualMicroUsd: null, usage: { status: 'unknown' } }
          : {}),
      }),
    );
    expect(f.store.state.cache.size).toBe(0);
    expect(f.store.state.payloads.size).toBe(0);
  },
);
it('counts noncacheable private output in the same unique-payload capacity', async () => {
  const f = setup({ entries: 1 });
  const first = await complete(f);
  const input = fresh();
  const { run } = await f.service.create(input);
  const dispatched = await f.service.markDispatch(TEST_NAMESPACE, TEST_ACTOR, run.id);
  await f.service.settle(
    TEST_NAMESPACE,
    TEST_ACTOR,
    fixtureSettlement(dispatched, {
      mode: 'unknown',
      actualMicroUsd: null,
      usage: { status: 'unknown' },
    }),
    fixtureAiResult,
  );
  expect(f.store.state.payloads.size).toBe(1);
  expect(f.store.state.cache.size).toBe(0);
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, first.id)).content).toBe('expired');
});
it('contains cache-index write failure while retaining completed content and receipt replay', async () => {
  const f = setup();
  f.store.failCache = true;
  const input = fresh();
  const run = await complete(f, input);
  expect(run.phase).toBe('completed');
  expect(f.store.state.payloads.size).toBe(1);
  expect(f.store.state.cache.size).toBe(0);
  expect((await f.service.create(input)).source).toBe('replayed');
});
it('contains content write failure without rolling back settlement or evicting prior results', async () => {
  const f = setup({ entries: 1 });
  const first = await complete(f);
  f.store.failPayload = true;
  const input = fresh();
  const run = await complete(f, input);
  expect(run.phase).toBe('completed');
  expect(f.store.state.payloads.size).toBe(1);
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, first.id)).content).toBe('available');
  expect((await f.service.create(input)).source).toBe('replayed');
});
it('unavailable/rotated content keys and tampered ciphertext are never cache hits', async () => {
  const f = setup();
  const input = fresh();
  const run = await complete(f, input);
  const rotated = setup({}, f.store, OTHER_KEY);
  expect((await rotated.service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
  const open = jest.spyOn(rotated.cipher, 'open');
  expect((await rotated.service.create({ ...input, key: randomUUID() })).source).toBe('created');
  expect(open).toHaveBeenCalledTimes(1);
  const payload = f.store.state.payloads.get(run.payloadId!)!;
  payload.ciphertext[0] = payload.ciphertext[0]! ^ 1;
  expect((await f.service.read(TEST_NAMESPACE, TEST_ACTOR, run.id)).content).toBe('expired');
});
it('bounded cleanup cascades indexes and preserves paid receipts/reservations', async () => {
  const f = setup();
  const input = fresh();
  await complete(f, input);
  f.store.clock = new Date(f.store.clock.getTime() + TTL_MS);
  await f.store.run((scope) => scope.deleteExpiredPayloads(TEST_NAMESPACE, 1));
  expect(f.store.state.payloads.size).toBe(0);
  expect(f.store.state.cache.size).toBe(0);
  expect((await f.service.create(input)).source).toBe('replayed');
  expect(f.store.state.reservations.size).toBe(1);
});
