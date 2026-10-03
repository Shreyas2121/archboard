export const RELEASE_METHOD = Object.freeze({
  warmup: 5,
  samples: 100,
  openingSamples: 20,
  gestureSamples: 20,
  pointerMovesPerGesture: 120,
  frameTargetMs: 32,
  openingTargetMs: 2000,
  visibilityTargetMs: 500,
  users: 5,
  simulatedRttMs: 100,
  percentile: 'nearest rank: ceil(n * q) - 1, sorted ascending',
});

export function summarize(samples) {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error('Timing samples must be nonempty, finite and nonnegative.');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  return {
    samplesMs: [...samples],
    count: samples.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    varianceMsSquared:
      samples.reduce((total, value) => total + (value - mean) ** 2, 0) / samples.length,
  };
}

/** Numeric stage data only. IDs, payloads, URLs, tokens and error dumps never enter reports. */
export function safeStageMetric(value) {
  const names = new Set([
    'collaboration.room_queue',
    'collaboration.validation_queue',
    'collaboration.validation_worker',
    'collaboration.db_write',
    'collaboration.ack',
  ]);
  if (!value || !names.has(value.event)) return null;
  const durationMs = value.durationMs ?? value.latencyMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  return { event: value.event, durationMs };
}
