import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  checkpointBlocker,
  localDurability,
  PortableSubmission,
  PortabilityGeneration,
  RECEIPT_WINDOW_MS,
  isNewPrivateBoard,
} from '../apps/web/src/features/editor/portability/portability-policy.ts';
import {
  capturePortableEnvelope,
  parsePortableJson,
  serializePortableJson,
} from '../packages/export/dist/index.js';
import { allEntityGraphFixture } from '../packages/fixtures/dist/index.js';
import * as contracts from '../packages/contracts/dist/index.js';

const board = { effectiveRole: 'owner', archivedAt: null };
const snapshot = () => ({
  accessDenied: false,
  archived: false,
  boardRole: 'owner',
  writer: { persistence: { savedOnDevice: true, pendingWrites: 0 } },
  sync: { connected: true, ready: true, pendingCount: 0, phase: 'saved-to-server' },
});
const capture = {
  exportedAt: '2026-10-02T00:00:00.000Z',
  board: { title: 'Synthetic portability', description: 'Complete text' },
  graph: allEntityGraphFixture,
};

test('settled persistence and durable ACK are both required; role, archive, cap and freshness gate capture', () => {
  assert.equal(checkpointBlocker(snapshot(), board, true, true, false), null);
  for (const [online, fresh, cap] of [
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ])
    assert.ok(checkpointBlocker(snapshot(), board, online, fresh, cap));
  for (const source of [
    { ...board, effectiveRole: 'viewer' },
    { ...board, archivedAt: '2026-10-02T00:00:00.000Z' },
    undefined,
  ])
    assert.ok(checkpointBlocker(snapshot(), source, true, true, false));
  for (const patch of [
    { accessDenied: true },
    { archived: true },
    { boardRole: 'viewer' },
    { writer: { persistence: { savedOnDevice: true, pendingWrites: 1 } } },
    { writer: { persistence: { savedOnDevice: false, pendingWrites: 0 } } },
    { writer: { persistence: null } },
    { sync: null },
    { sync: { ...snapshot().sync, pendingCount: 1 } },
    { sync: { ...snapshot().sync, ready: false } },
    { sync: { ...snapshot().sync, connected: false } },
    { sync: { ...snapshot().sync, phase: 'syncing' } },
  ])
    assert.ok(checkpointBlocker({ ...snapshot(), ...patch }, board, true, true, false));
});

test('offline, demo, storage failure, unacknowledged and access-ended graphs remain complete local-only JSON', () => {
  const saved = capturePortableEnvelope(capture, localDurability(snapshot(), true));
  assert.equal(saved.syncStatusAtExport, 'server-saved');
  for (const [state, online] of [
    [snapshot(), false],
    [{ ...snapshot(), sync: null }, true],
    [{ ...snapshot(), writer: { persistence: { savedOnDevice: false, pendingWrites: 0 } } }, true],
    [{ ...snapshot(), sync: { ...snapshot().sync, pendingCount: 1 } }, true],
    [{ ...snapshot(), accessDenied: true }, true],
  ]) {
    const file = capturePortableEnvelope(capture, localDurability(state, online));
    assert.equal(file.syncStatusAtExport, 'local-only');
    assert.deepEqual(parsePortableJson(serializePortableJson(file).json).graph, capture.graph);
  }
});

test('frozen submission preserves original bytes, key, and conservative receipt expiry', () => {
  const body = { name: 'Before', expectedSeq: '18' };
  const request = new PortableSubmission('original-key', body, 100);
  body.name = 'After';
  body.expectedSeq = '19';
  request.state = 'uncertain';
  assert.deepEqual(JSON.parse(request.json), { name: 'Before', expectedSeq: '18' });
  assert.equal(request.key, 'original-key');
  assert.equal(request.retryable(100 + RECEIPT_WINDOW_MS - 1), true);
  assert.equal(request.retryable(100 + RECEIPT_WINDOW_MS), false);
  assert.equal(request.retryable(99), false);
  request.state = 'rejected';
  assert.equal(request.retryable(101), false);
});

test('old account/board generations never accept late file/read/creation outcomes', () => {
  const fence = new PortabilityGeneration();
  const old = fence.capture();
  fence.invalidate();
  assert.equal(fence.current(old), false);
  assert.equal(fence.current(fence.capture()), true);
});

test('new-board confirmation requires the current owner and a different source identifier', () => {
  const created = { id: 'new', effectiveRole: 'owner', owner: { id: 'actor' } };
  assert.equal(isNewPrivateBoard(created, 'actor', 'source'), true);
  assert.equal(isNewPrivateBoard(created, 'other', 'source'), false);
  assert.equal(isNewPrivateBoard(created, 'actor', 'new'), false);
  assert.equal(
    isNewPrivateBoard({ ...created, effectiveRole: 'viewer' }, 'actor', 'source'),
    false,
  );
});

async function loadSource(path, ports, globals = {}) {
  const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
  const context = vm.createContext(globals);
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { context },
  );
  await module.link((specifier) => {
    const exports = ports[specifier];
    assert.ok(exports, `Missing test port ${specifier}`);
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await module.evaluate();
  return module.namespace;
}

test('GET board detail becomes an exact cacheable summary, preserving title and description', async () => {
  const timestamp = '2026-10-02T00:00:00.000Z';
  const detail = {
    id: crypto.randomUUID(),
    title: 'Cached metadata',
    description: 'Offline description',
    owner: { id: crypto.randomUUID(), name: 'Synthetic actor', image: null },
    effectiveRole: 'owner',
    archivedAt: null,
    metadataVersion: 1,
    latestSeq: '1',
    contentUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    memberCount: 1,
  };
  const api = await loadSource('../apps/web/src/features/boards/board-api.ts', {
    '@archboard/contracts': contracts,
    '@/platform/api': { apiRequest: async () => ({ data: detail }) },
  });
  const summary = await api.readBoard(detail.id);
  assert.equal('memberCount' in summary, false);
  assert.equal(contracts.boardSummarySchema.safeParse(summary).success, true);
  assert.equal(summary.description, detail.description);
});

test('the actual recovery serializer produces reimportable versioned full-text local JSON', async () => {
  const recovery = await loadSource('../apps/web/src/features/editor/demo/recovery-download.ts', {
    '@archboard/export': { capturePortableEnvelope, serializePortableJson },
    '@/platform/download/portable-download': { downloadPortableEnvelope: () => true },
  });
  const json = recovery.serializeRecoveryArtifact(
    allEntityGraphFixture,
    new Date(capture.exportedAt),
    capture.board,
  );
  const parsed = parsePortableJson(json);
  assert.equal(parsed.syncStatusAtExport, 'local-only');
  assert.deepEqual(parsed.board, capture.board);
  assert.deepEqual(parsed.graph, allEntityGraphFixture);
});

test('download adapter revokes its object URL on both success and failed click without truncating JSON', async () => {
  let revoked = 0;
  let blob;
  let fail = false;
  const anchor = {
    click: () => {
      if (fail) throw new Error('Synthetic download failure');
    },
  };
  const adapter = await loadSource(
    '../apps/web/src/platform/download/portable-download.ts',
    {
      '@archboard/export': { serializePortableJson },
    },
    {
      Blob,
      URL: {
        createObjectURL: (value) => {
          blob = value;
          return 'blob:synthetic';
        },
        revokeObjectURL: () => revoked++,
      },
      document: { createElement: () => anchor },
    },
  );
  const file = capturePortableEnvelope(capture, localDurability(snapshot(), true));
  assert.equal(adapter.downloadPortableEnvelope(file), true);
  assert.equal(anchor.download, 'archboard-local-recovery.json');
  assert.deepEqual(parsePortableJson(await blob.text()), file);
  fail = true;
  assert.throws(() => adapter.downloadPortableEnvelope(file), /Synthetic download failure/);
  assert.equal(revoked, 2);
});

// Execute the actual hook using a minimal hook store, replacing only React and the HTTP port.
// No DOM, browser, database, auth endpoint, or network is involved.
async function harness() {
  const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
  const slots = [];
  const cleanups = [];
  const requests = [];
  let cursor = 0;
  let clock = 1000;
  let active = true;
  let generation = 0;
  let nextKey = 0;
  let response = async () => ({ data: { id: 'created-board' } });
  let auth = async () => generation;
  let confirmations = 0;
  let inspections = 0;
  class ApiClientError extends Error {
    constructor(kind, status = null, code = null) {
      super('Synthetic API failure');
      this.kind = kind;
      this.status = status;
      this.code = code;
    }
  }
  const context = vm.createContext({
    AbortController,
    crypto: { randomUUID: () => `key-${++nextKey}` },
    Date: class extends Date {
      static now() {
        return clock;
      }
    },
  });
  const source = await readFile(
    new URL(
      '../apps/web/src/features/editor/portability/use-portable-creation.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context },
  );
  await module.link((specifier) => {
    const exports =
      specifier === 'react'
        ? {
            useRef: (value) => {
              const index = cursor++;
              return (slots[index] ??= { current: value });
            },
            useState: (value) => {
              const index = cursor++;
              if (!(index in slots)) slots[index] = value;
              return [
                slots[index],
                (next) => {
                  slots[index] = typeof next === 'function' ? next(slots[index]) : next;
                },
              ];
            },
            useEffect: (effect) => {
              const index = cursor++;
              if (!(index in slots)) {
                slots[index] = true;
                cleanups.push(effect());
              }
            },
          }
        : specifier === '@/platform/api'
          ? {
              ApiClientError,
              apiRequest: async (path, schema, options) => {
                requests.push({
                  path,
                  json: JSON.stringify(options.body),
                  key: options.headers['Idempotency-Key'],
                  signal: options.signal,
                });
                return response();
              },
            }
          : { PortableSubmission, HTTP_SERVER_ERROR: 500 };
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await module.evaluate();
  const scope = {
    capture: () => generation,
    authenticate: () => auth(),
    current: () => active,
    accepts: (token) => active && token === generation,
  };
  function render() {
    cursor = 0;
    return module.namespace.usePortableCreation(
      scope,
      '/imports',
      {},
      () => confirmations++,
      async () => inspections++,
    );
  }
  return {
    render,
    requests,
    ApiClientError,
    setResponse: (value) => {
      response = value;
    },
    setAuth: (value) => {
      auth = value;
    },
    advance: () => {
      generation++;
    },
    expire: () => {
      clock += RECEIPT_WINDOW_MS;
    },
    confirmations: () => confirmations,
    inspections: () => inspections,
    dispose: () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup?.());
    },
  };
}

for (const kind of ['network', 'invalid-response', 'server-error']) {
  test(`${kind} creation retains exact request/key and never retries automatically`, async () => {
    const h = await harness();
    h.setResponse(async () => {
      throw new h.ApiClientError(
        kind === 'server-error' ? 'http' : kind,
        kind === 'server-error' ? 503 : null,
      );
    });
    await h.render().submit(() => ({ title: 'Original', file: { graph: 'original' } }));
    assert.equal(h.render().intent.state, 'uncertain');
    assert.equal(h.requests.length, 1);
    await h.render().restart();
    assert.equal(h.inspections(), 0);
    h.setResponse(async () => ({ data: { id: 'confirmed' } }));
    await h.render().submit(() => {
      throw new Error('Changed payload must not be prepared');
    });
    assert.equal(h.requests[0].json, h.requests[1].json);
    assert.equal(h.requests[0].key, h.requests[1].key);
    assert.equal(h.confirmations(), 1);
    assert.equal(h.render().intent, null);
  });
}

test('expected sequence 409 refreshes reads but requires explicit restart and a different key', async () => {
  const h = await harness();
  h.setResponse(async () => {
    throw new h.ApiClientError('http', 409, 'VERSION_CONFLICT');
  });
  await h.render().submit(() => ({ name: 'Checkpoint', expectedSeq: '10' }));
  assert.equal(h.inspections(), 1);
  assert.equal(h.render().intent.state, 'rejected');
  await h.render().submit(() => ({ name: 'Checkpoint', expectedSeq: '11' }));
  assert.equal(h.requests.length, 1);
  await h.render().restart();
  assert.equal(h.requests.length, 1);
  h.setResponse(async () => ({ data: {} }));
  await h.render().submit(() => ({ name: 'Checkpoint', expectedSeq: '11' }));
  assert.notEqual(h.requests[0].key, h.requests[1].key);
  assert.equal(JSON.parse(h.requests[1].json).expectedSeq, '11');
});

test('authorization failure after an uncertain post does not prove the original creation failed', async () => {
  const h = await harness();
  h.setResponse(async () => {
    throw new h.ApiClientError('network');
  });
  await h.render().submit(() => ({ title: 'Unconfirmed' }));
  h.setResponse(async () => {
    throw new h.ApiClientError('http', 403, 'FORBIDDEN');
  });
  await h.render().submit(() => ({ title: 'Changed' }));
  assert.equal(h.render().intent.state, 'uncertain');
  await h.render().restart();
  assert.equal(h.inspections(), 0);
  assert.equal(h.requests[0].key, h.requests[1].key);
});

test('uncertain receipt expiry blocks replay, inspects results, and still requires a separate new submission', async () => {
  const h = await harness();
  h.setResponse(async () => {
    throw new h.ApiClientError('network');
  });
  await h.render().submit(() => ({ title: 'Keep' }));
  h.expire();
  await h.render().submit(() => ({ title: 'Changed' }));
  assert.equal(h.requests.length, 1);
  await h.render().restart();
  assert.equal(h.inspections(), 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.render().intent, null);
});

test('scope generation change suppresses late successful navigation and retains uncertain request', async () => {
  const h = await harness();
  let resolve;
  h.setResponse(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const promise = h.render().submit(() => ({ title: 'Old account' }));
  await new Promise((done) => setImmediate(done));
  h.advance();
  resolve({ data: {} });
  await promise;
  assert.equal(h.confirmations(), 0);
  assert.equal(h.render().intent.state, 'uncertain');
});

test('account loss during authentication prevents submission; unmount aborts a posted request', async () => {
  const h = await harness();
  h.setAuth(async () => {
    h.advance();
  });
  await h.render().submit(() => ({ title: 'Never sent' }));
  assert.equal(h.requests.length, 0);
  h.setAuth(async () => undefined);
  let resolve;
  h.setResponse(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const promise = h.render().submit(() => ({ title: 'Posted' }));
  await new Promise((done) => setImmediate(done));
  h.dispose();
  assert.equal(h.requests[0].signal.aborted, true);
  resolve({ data: {} });
  await promise;
  assert.equal(h.confirmations(), 0);
});
