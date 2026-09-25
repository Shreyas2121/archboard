import { ERROR_CODES, GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import {
  createGraphDocument,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import { afterEach, describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Y from 'yjs';

import {
  MAX_VALIDATION_QUEUE_DEPTH,
  MAX_VALIDATION_WORKERS,
  VALIDATION_TIMEOUT_MS,
} from '../../../../platform/config/index.js';
import { createCausalGapFixtures } from '../yjs-compatibility/causal-gap.fixtures.js';
import {
  createLimitOverflowValidationFixture,
  createLimitValidationFixture,
  createMalformedValidationFixture,
  createTypicalValidationFixture,
  createValidationFixture,
} from './validation-worker.fixtures.js';
import {
  VALIDATION_FAILURE_KINDS,
  VALIDATION_WORKER_DIRECTIVES,
  ValidationWorkerError,
  ValidationWorkerPool,
} from './index.js';

const workerUrl = pathToFileURL(
  resolve(
    process.cwd(),
    'dist/modules/collaboration/infrastructure/validation-worker/validation-worker.entry.js',
  ),
);
const pools: ValidationWorkerPool[] = [];
const FAULT_INJECTION_TIMEOUT_MS = 1_500;

function pool(
  options: ConstructorParameters<typeof ValidationWorkerPool>[0] = {},
): ValidationWorkerPool {
  const created = new ValidationWorkerPool({ ...options, workerUrl });
  pools.push(created);
  return created;
}

function expectUnchanged(actual: Uint8Array, snapshot: Uint8Array): void {
  expect(actual).toEqual(snapshot);
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(async (created) => created.close()));
});

describe('validation-worker', () => {
  it('uses the named operational bounds by default', () => {
    const created = pool();
    expect(created.timeoutMs).toBe(VALIDATION_TIMEOUT_MS);
    expect(created.maxWorkers).toBe(MAX_VALIDATION_WORKERS);
    expect(created.maxQueueDepth).toBe(MAX_VALIDATION_QUEUE_DEPTH);
  });

  it.each([
    ['typical', createTypicalValidationFixture],
    ['limit', createLimitValidationFixture],
  ])('decodes and validates the %s candidate in a real worker', async (_name, fixtureFactory) => {
    const input = fixtureFactory();
    const acceptedSnapshot = input.acceptedState.slice();
    const updateSnapshot = input.update.slice();

    const result = await pool().validate(input);
    const candidate = createGraphDocument();
    try {
      Y.applyUpdate(candidate, result.candidateState);
      validateGraphDocument(candidate);
      expect(projectGraphDocument(candidate).nodes.length).toBeGreaterThan(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.heapUsedBytes).toBeGreaterThan(0);
    } finally {
      candidate.destroy();
    }
    expectUnchanged(input.acceptedState, acceptedSnapshot);
    expectUnchanged(input.update, updateSnapshot);
  });

  it.each([
    [
      'malformed input',
      createMalformedValidationFixture,
      ERROR_CODES.DOCUMENT_INVALID,
      VALIDATION_FAILURE_KINDS.DOCUMENT_INVALID,
    ],
    [
      'document limit',
      createLimitOverflowValidationFixture,
      ERROR_CODES.DOCUMENT_LIMIT,
      VALIDATION_FAILURE_KINDS.DOCUMENT_LIMIT,
    ],
  ])('rejects %s without mutating accepted state', async (_name, fixtureFactory, code, kind) => {
    const input = fixtureFactory();
    const acceptedSnapshot = input.acceptedState.slice();
    await expect(pool().validate(input)).rejects.toMatchObject({
      name: 'ValidationWorkerError',
      code,
      kind,
      retryable: false,
    });
    expectUnchanged(input.acceptedState, acceptedSnapshot);
  });

  it('rejects a causal gap without mutating accepted state', async () => {
    const fixture = createCausalGapFixtures()[0]!;
    const input = createValidationFixture({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      boundaries: [],
      steps: [],
    });
    const acceptedSnapshot = input.acceptedState.slice();
    await expect(
      pool().validate({ ...input, update: fixture.dependentUpdate }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CAUSAL_GAP,
      kind: VALIDATION_FAILURE_KINDS.CAUSAL_GAP,
    });
    expectUnchanged(input.acceptedState, acceptedSnapshot);
  });

  it.each([
    ['timeout', VALIDATION_WORKER_DIRECTIVES.HANG, VALIDATION_FAILURE_KINDS.TIMEOUT],
    ['worker crash', VALIDATION_WORKER_DIRECTIVES.CRASH, VALIDATION_FAILURE_KINDS.WORKER_FAILURE],
  ])('isolates a %s without mutating accepted state', async (_name, directive, kind) => {
    const input = createValidationFixture({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      boundaries: [],
      steps: [],
    });
    const acceptedSnapshot = input.acceptedState.slice();
    const created = pool({ timeoutMs: FAULT_INJECTION_TIMEOUT_MS });
    created.injectNextWorkerDirective(directive);
    await expect(created.validate(input)).rejects.toMatchObject({
      code: ERROR_CODES.SERVER_BUSY,
      kind,
      retryable: true,
    });
    expect(created.activeWorkerCount).toBe(0);
    expectUnchanged(input.acceptedState, acceptedSnapshot);
  });

  it('rejects explicitly when the bounded queue is full', async () => {
    const input = createValidationFixture({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      boundaries: [],
      steps: [],
    });
    const acceptedSnapshot = input.acceptedState.slice();
    const created = pool({
      timeoutMs: FAULT_INJECTION_TIMEOUT_MS,
      maxWorkers: 1,
      maxQueueDepth: 1,
    });
    created.injectNextWorkerDirective(VALIDATION_WORKER_DIRECTIVES.HANG);
    const running = created.validate(input);
    const queued = created.validate(input);

    await expect(created.validate(input)).rejects.toMatchObject({
      code: ERROR_CODES.SERVER_BUSY,
      kind: VALIDATION_FAILURE_KINDS.OVERLOADED,
      retryable: true,
    });
    await expect(running).rejects.toBeInstanceOf(ValidationWorkerError);
    await expect(queued).resolves.toMatchObject({ ok: true });
    expectUnchanged(input.acceptedState, acceptedSnapshot);
  });
});
