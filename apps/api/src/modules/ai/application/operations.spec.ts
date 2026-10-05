import { jest } from '@jest/globals';
import { AiOperations } from './operations.js';
import { fixtureAiIntent } from '../infrastructure/testing/persistence-fixtures.js';
const FAILURES = 3;
const COOLDOWN_MS = 30_000;

it('isolates breaker configurations and permits only one funded half-open caller', () => {
  let clock = 0;
  const ops = new AiOperations(() => clock);
  const snapshot = fixtureAiIntent().snapshot;
  for (let i = 0; i < FAILURES; i++) ops.acquire(snapshot)('failure');
  expect(() => ops.assertFresh(snapshot)).toThrow();
  expect(() => ops.assertFresh({ ...snapshot, model: 'another-model' })).not.toThrow();
  clock = COOLDOWN_MS;
  const release = ops.acquire(snapshot);
  expect(() => ops.acquire(snapshot)).toThrow();
  release('failure');
  release('healthy'); // one lease cannot settle twice
  expect(() => ops.assertFresh(snapshot)).toThrow();
  clock += COOLDOWN_MS;
  ops.acquire(snapshot)('healthy');
  expect(() => ops.assertFresh(snapshot)).not.toThrow();
});
it('has no automatic paid probes and handles canceled probes conservatively', () => {
  let clock = 0;
  const ops = new AiOperations(() => clock);
  const snapshot = fixtureAiIntent().snapshot;
  for (let i = 0; i < FAILURES; i++) ops.acquire(snapshot)('failure');
  clock = COOLDOWN_MS;
  ops.acquire(snapshot)('neutral');
  expect(() => ops.assertFresh(snapshot)).toThrow();
});
it('fails closed on a broken switch and allows a trusted operator to stop spending', () => {
  const ops = new AiOperations();
  ops.setPaidEnabled(false);
  expect(() => ops.assertPaid()).toThrow();
  ops.setPaidEnabled(true);
  expect(() => ops.assertPaid()).not.toThrow();
  expect(
    new AiOperations(Date.now, () => {
      throw new Error('private-path');
    }).disabled,
  ).toBe(true);
});
it('reports only allowlisted aggregate values, conserves usage and tolerates sink failure', () => {
  const sink = jest.fn<(value: string) => void>();
  const ops = new AiOperations(Date.now, () => false, sink);
  ops.usage({
    status: 'known',
    uncachedInputTokens: 1,
    cacheReadInputTokens: 2,
    cacheWriteInputTokens: [{ writeClass: 'private-label', tokens: 3 }],
    outputTokens: 4,
    separatelyBilledReasoningTokens: 0,
    reasoningTokens: 2,
  });
  ops.usage({ status: 'unknown' });
  ops.add('private-prompt' as 'fresh_calls');
  ops.add('fresh_calls', -1);
  ops.report();
  const text = sink.mock.calls[0]![0];
  expect(text).not.toMatch(/private|model|actor|email|fingerprint|requestId/);
  expect(ops.snapshot()).toMatchObject({
    uncached_input_tokens: '1',
    cache_read_tokens: '2',
    billable_cache_write_tokens: '3',
    billable_output_tokens: '4',
    fresh_calls: '0',
  });
  expect(() =>
    new AiOperations(
      Date.now,
      () => false,
      () => {
        throw new Error('secret');
      },
    ).report(),
  ).not.toThrow();
});
