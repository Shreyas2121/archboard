import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, safeStageMetric } from './report.mjs';

test('nearest rank retains raw outliers, input order and population variance', () => {
  const samples = Array.from({ length: 20 }, (_, index) => index + 1).reverse();
  const report = summarize(samples);
  assert.equal(report.p50Ms, 10);
  assert.equal(report.p95Ms, 19);
  assert.equal(report.maxMs, 20);
  assert.equal(report.varianceMsSquared, 33.25);
  assert.deepEqual(report.samplesMs, samples);
  for (const invalid of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(invalid));
});
test('stage reports select safe numeric fields and discard content', () => {
  assert.deepEqual(
    safeStageMetric({
      event: 'collaboration.ack',
      latencyMs: 20,
      token: 'synthetic-secret',
      body: 'private',
    }),
    { event: 'collaboration.ack', durationMs: 20 },
  );
  assert.equal(safeStageMetric({ event: 'private content', durationMs: 1 }), null);
  assert.equal(safeStageMetric({ event: 'collaboration.db_write', durationMs: Infinity }), null);
});
