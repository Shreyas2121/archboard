import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_VALIDATION_QUEUE,
  MAX_VALIDATION_WORKERS,
  VALIDATION_TIMEOUT_MS,
} from '@archboard/contracts';
import {
  createGraphDocument,
  hydrateGraphDocument,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import { FIXED_IDS, minimalGraphFixture } from '@archboard/fixtures';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Y from 'yjs';

import { createCausalGapFixtures } from '../yjs-compatibility/causal-gap.fixtures.js';
import {
  createLimitOverflowValidationFixture,
  createLimitValidationFixture,
  createMalformedValidationFixture,
  createImmutableEndpointValidationFixture,
  createRemovedEntityValidationFixture,
  createRemovedTombstoneValidationFixture,
  createTypicalValidationFixture,
  createValidationFixture,
  createHiddenTextOverflowValidationFixture,
  createHiddenStateOverflowValidationFixture,
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
const WORKER_TEST_TIMEOUT_MS = 15_000;

jest.setTimeout(WORKER_TEST_TIMEOUT_MS);

function pool(
  options: ConstructorParameters<typeof ValidationWorkerPool>[0] = {},
): ValidationWorkerPool {
  const created = new ValidationWorkerPool({ ...options, workerUrl });
  pools.push(created);
  return created;
}

function expectUnchanged(actual: Uint8Array, snapshot: Uint8Array): void {
  // Compare complete bytes without materializing millions of Jest assertion keys.
  expect(Buffer.from(actual).equals(Buffer.from(snapshot))).toBe(true);
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(async (created) => created.close()));
});

describe('validation-worker', () => {
  it('cannot configure worker, timeout or queue capacity above release budgets', () => {
    for (const options of [
      { maxWorkers: MAX_VALIDATION_WORKERS + 1 },
      { timeoutMs: VALIDATION_TIMEOUT_MS + 1 },
      { maxQueueDepth: MAX_VALIDATION_QUEUE + 1 },
    ])
      expect(() => new ValidationWorkerPool(options)).toThrow('published worker budgets');
  });
  it.each([false, true])(
    'reconstructs committed Buffer records in a real worker with remap=%s',
    async (remap) => {
      const fixture = createTypicalValidationFixture();
      const result = await pool().validate({
        acceptedState: Buffer.from(fixture.acceptedState),
        update: new Uint8Array(),
        reconstruction: { updates: [Buffer.from(fixture.update)], remap },
      });
      const document = new Y.Doc();
      try {
        Y.applyUpdate(document, result.candidateState);
        validateGraphDocument(document);
        const projection = projectGraphDocument(document);
        expect(projection.nodes.length).toBeGreaterThan(0);
      } finally {
        document.destroy();
      }
    },
  );
  it('uses the named operational bounds by default', () => {
    const created = pool();
    expect(created.timeoutMs).toBe(VALIDATION_TIMEOUT_MS);
    expect(created.maxWorkers).toBe(MAX_VALIDATION_WORKERS);
    expect(created.maxQueueDepth).toBe(MAX_VALIDATION_QUEUE);
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
      'hidden text cap',
      createHiddenTextOverflowValidationFixture,
      ERROR_CODES.DOCUMENT_LIMIT,
      VALIDATION_FAILURE_KINDS.DOCUMENT_LIMIT,
    ],
    [
      'hidden encoded state cap',
      createHiddenStateOverflowValidationFixture,
      ERROR_CODES.DOCUMENT_LIMIT,
      VALIDATION_FAILURE_KINDS.DOCUMENT_LIMIT,
    ],
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
    [
      'immutable edge endpoint',
      createImmutableEndpointValidationFixture,
      ERROR_CODES.DOCUMENT_INVALID,
      VALIDATION_FAILURE_KINDS.DOCUMENT_INVALID,
    ],
    [
      'accepted entity removal',
      createRemovedEntityValidationFixture,
      ERROR_CODES.DOCUMENT_INVALID,
      VALIDATION_FAILURE_KINDS.DOCUMENT_INVALID,
    ],
    [
      'accepted tombstone removal',
      createRemovedTombstoneValidationFixture,
      ERROR_CODES.DOCUMENT_INVALID,
      VALIDATION_FAILURE_KINDS.DOCUMENT_INVALID,
    ],
  ])('rejects %s without mutating accepted state', async (_name, fixtureFactory, code, kind) => {
    const input = fixtureFactory();
    if (_name === 'hidden encoded state cap') {
      expect(input.acceptedState.byteLength).toBeLessThanOrEqual(MAX_ENCODED_YJS_STATE_BYTES);
      expect(input.update.byteLength).toBeLessThanOrEqual(MAX_CLIENT_UPDATE_BYTES);
    }
    const acceptedSnapshot = input.acceptedState.slice();
    const created = pool();
    await expect(created.validate(input)).rejects.toMatchObject({
      name: 'ValidationWorkerError',
      code,
      kind,
      retryable: false,
    });
    expectUnchanged(input.acceptedState, acceptedSnapshot);
    await expect(created.validate(createTypicalValidationFixture())).resolves.toMatchObject({
      ok: true,
    });
  });

  it.each(createCausalGapFixtures())(
    'rejects $name without mutating accepted state',
    async (fixture) => {
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
    },
  );

  it('rejects oversized input before worker admission and accepts the next valid candidate', async () => {
    const input = createTypicalValidationFixture();
    const created = pool();
    for (const oversized of [
      { ...input, update: new Uint8Array(MAX_CLIENT_UPDATE_BYTES + 1) },
      { ...input, acceptedState: new Uint8Array(MAX_ENCODED_YJS_STATE_BYTES + 1) },
    ]) {
      await expect(created.validate(oversized)).rejects.toMatchObject({
        code: ERROR_CODES.DOCUMENT_LIMIT,
        kind: VALIDATION_FAILURE_KINDS.DOCUMENT_LIMIT,
        retryable: false,
      });
      expect(created.activeWorkerCount).toBe(0);
      expect(created.queueDepth).toBe(0);
    }
    await expect(created.validate(input)).resolves.toMatchObject({ ok: true });
  });

  it.each(['Uint8Array', 'Buffer', 'sliced Buffer', 'subarray'] as const)(
    'preserves queued %s bytes if the caller mutates both inputs',
    async (kind) => {
      const input = createTypicalValidationFixture();
      const created = pool({
        maxWorkers: 1,
        maxQueueDepth: 1,
        timeoutMs: FAULT_INJECTION_TIMEOUT_MS,
      });
      created.injectNextWorkerDirective(VALIDATION_WORKER_DIRECTIVES.HANG);
      const hanging = created.validate(input);
      const fixture = createTypicalValidationFixture();
      const bytes = (value: Uint8Array): Uint8Array => {
        if (kind === 'Buffer') return Buffer.from(value);
        if (kind === 'sliced Buffer')
          return Buffer.concat([Buffer.from([0]), Buffer.from(value), Buffer.from([0])]).subarray(
            1,
            value.length + 1,
          );
        if (kind === 'subarray')
          return Uint8Array.from([0, ...value, 0]).subarray(1, value.length + 1);
        return Uint8Array.from(value);
      };
      const queuedInput = {
        acceptedState: bytes(fixture.acceptedState),
        update: bytes(fixture.update),
      };
      const queued = created.validate(queuedInput);
      queuedInput.update.fill(0);
      queuedInput.acceptedState.fill(0);
      await expect(hanging).rejects.toMatchObject({ kind: VALIDATION_FAILURE_KINDS.TIMEOUT });
      await expect(queued).resolves.toMatchObject({ ok: true });
    },
  );

  it('settles running and queued jobs before idempotent close completes', async () => {
    const created = pool({ maxWorkers: 1, maxQueueDepth: 1 });
    created.injectNextWorkerDirective(VALIDATION_WORKER_DIRECTIVES.HANG);
    const results = Promise.allSettled([
      created.validate(createTypicalValidationFixture()),
      created.validate(createTypicalValidationFixture()),
    ]);
    const firstClose = created.close();
    expect(created.close()).toBe(firstClose);
    await firstClose;
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(created.activeWorkerCount).toBe(0);
    expect(created.queueDepth).toBe(0);
    await expect(created.validate(createTypicalValidationFixture())).rejects.toBeInstanceOf(
      ValidationWorkerError,
    );
  });

  it('accepts a causally complete concurrent move after an independent title edit', async () => {
    const base = hydrateGraphDocument(minimalGraphFixture);
    const accepted = createGraphDocument();
    const remote = createGraphDocument();
    const candidate = createGraphDocument();
    try {
      const baseState = Y.encodeStateAsUpdate(base);
      const baseVector = Y.encodeStateVector(base);
      Y.applyUpdate(accepted, baseState);
      Y.applyUpdate(remote, baseState);
      const acceptedNode = accepted.getMap('nodes').get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
      const title = acceptedNode.get('title') as Y.Text;
      title.delete(0, title.length);
      title.insert(0, 'Independent title');
      const remoteNode = remote.getMap('nodes').get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
      remoteNode.set('position', { x: 80, y: 40 });
      const result = await pool().validate({
        acceptedState: Y.encodeStateAsUpdate(accepted),
        update: Y.encodeStateAsUpdate(remote, baseVector),
      });
      Y.applyUpdate(candidate, result.candidateState);
      const node = projectGraphDocument(candidate).nodes.find(
        (item) => item.id === FIXED_IDS.NODE_A,
      );
      expect(node).toMatchObject({ title: 'Independent title', position: { x: 80, y: 40 } });
    } finally {
      base.destroy();
      accepted.destroy();
      remote.destroy();
      candidate.destroy();
    }
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
    await expect(created.validate(createTypicalValidationFixture())).resolves.toMatchObject({
      ok: true,
    });
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
