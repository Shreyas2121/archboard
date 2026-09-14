import { cpus, totalmem } from 'node:os';

import {
  createLimitValidationFixture,
  createTypicalValidationFixture,
} from '../dist/modules/collaboration/infrastructure/validation-worker/validation-worker.fixtures.js';
import { ValidationWorkerPool } from '../dist/modules/collaboration/infrastructure/validation-worker/index.js';

const SAMPLE_COUNT = 5;

function round(value) {
  return Math.round(value * 100) / 100;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(name, createFixture) {
  const fixture = createFixture();
  const pool = new ValidationWorkerPool();
  const elapsed = [];
  let peakWorkerHeapBytes = 0;
  try {
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const startedAt = performance.now();
      const result = await pool.validate(fixture);
      elapsed.push(performance.now() - startedAt);
      peakWorkerHeapBytes = Math.max(peakWorkerHeapBytes, result.heapUsedBytes);
    }
  } finally {
    await pool.close();
  }
  return {
    fixture: name,
    acceptedStateBytes: fixture.acceptedState.byteLength,
    updateBytes: fixture.update.byteLength,
    sampleCount: SAMPLE_COUNT,
    elapsedMs: {
      total: round(elapsed.reduce((sum, value) => sum + value, 0)),
      min: round(Math.min(...elapsed)),
      median: round(median(elapsed)),
      max: round(Math.max(...elapsed)),
    },
    peakWorkerHeapBytes,
  };
}

const cpu = cpus()[0];
const output = {
  measuredAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  hardware: {
    cpuModel: cpu?.model ?? 'unavailable',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  note: 'Local bounded-worker measurements; not a production performance claim.',
  results: [
    await measure('typical', createTypicalValidationFixture),
    await measure('limit', createLimitValidationFixture),
  ],
};

console.log(JSON.stringify(output, null, 2));
