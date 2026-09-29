import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

import { GRAPH_SCHEMA_VERSION } from '../packages/contracts/dist/index.js';
import { SYNC_DATABASE_VERSION } from '../packages/sync-client/dist/index.js';

import { samePendingWork, updateSafety } from '../apps/web/src/platform/update/update-policy.ts';
import {
  prepareActiveEditorsForUpdate,
  registerUpdateSession,
  unregisterUpdateSession,
} from '../apps/web/src/features/editor/application/update-sessions.ts';

const board = (schema, ids = ['update-a']) => ({
  namespace: {
    deploymentOrigin: 'https://app.example',
    userId: 'account-a',
    boardId: 'board-a',
    graphSchemaVersion: schema,
  },
  pendingCount: ids.length,
  updateIds: ids,
});

test('worker and pending-board schemas must both be supported', () => {
  const compatible = {
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    syncDatabaseVersion: SYNC_DATABASE_VERSION,
    openClientCount: 1,
  };
  assert.equal(updateSafety(compatible, []), 'compatible');
  assert.equal(updateSafety(compatible, [board(GRAPH_SCHEMA_VERSION)]), 'compatible');
  assert.equal(updateSafety(null, []), 'unsupported-worker');
  assert.equal(updateSafety({ ...compatible, openClientCount: 2 }, []), 'other-tabs-open');
  assert.equal(
    updateSafety({ ...compatible, graphSchemaVersion: GRAPH_SCHEMA_VERSION + 1 }, []),
    'unsupported-worker',
  );
  assert.equal(
    updateSafety({ ...compatible, syncDatabaseVersion: SYNC_DATABASE_VERSION + 1 }, []),
    'unsupported-worker',
  );
  assert.equal(
    updateSafety(compatible, [board(GRAPH_SCHEMA_VERSION + 1)]),
    'unsupported-local-schema',
  );
});

test('pending handoff compares exact namespaces and update IDs', () => {
  assert.equal(samePendingWork([board(1, ['a', 'b'])], [board(1, ['b', 'a'])]), true);
  assert.equal(samePendingWork([board(1, ['a'])], [board(1, ['b'])]), false);
  assert.equal(samePendingWork([board(1)], [board(2)]), false);
  assert.equal(samePendingWork([board(1)], []), false);
});

test('the generated-worker compatibility responder reports schemas and open clients', async () => {
  let listener;
  const source = readFileSync(
    new URL('../apps/web/public/worker-compatibility.js', import.meta.url),
    'utf8',
  );
  runInNewContext(source, {
    self: {
      addEventListener: (_type, callback) => (listener = callback),
      clients: { matchAll: async () => [{}] },
    },
  });
  let response;
  let work;
  listener({
    data: { type: 'ARCHBOARD_UPDATE_COMPATIBILITY' },
    ports: [{ postMessage: (value) => (response = value) }],
    waitUntil: (value) => (work = value),
  });
  await work;
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    type: 'ARCHBOARD_UPDATE_COMPATIBILITY',
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    syncDatabaseVersion: SYNC_DATABASE_VERSION,
    openClientCount: 1,
  });
});

test('the production worker imports and precaches its compatibility responder', () => {
  const worker = readFileSync(new URL('../apps/web/dist/sw.js', import.meta.url), 'utf8');
  assert.match(worker, /importScripts\("\/worker-compatibility\.js"\)/);
  assert.match(worker, /url:"worker-compatibility\.js"/);
});

test('failed editor preparation waits for every editor before canceling the handoff', async () => {
  const events = [];
  const first = {
    prepareForUpdate: async () => {
      events.push('first failed');
      throw new Error('storage is unavailable');
    },
    cancelUpdatePreparation: () => events.push('first canceled'),
    close: async () => undefined,
  };
  const second = {
    prepareForUpdate: async () => {
      await Promise.resolve();
      events.push('second finished');
    },
    cancelUpdatePreparation: () => events.push('second canceled'),
    close: async () => undefined,
  };
  registerUpdateSession(first);
  registerUpdateSession(second);
  try {
    await assert.rejects(prepareActiveEditorsForUpdate(), /storage is unavailable/);
    assert.deepEqual(events, [
      'first failed',
      'second finished',
      'first canceled',
      'second canceled',
    ]);
  } finally {
    unregisterUpdateSession(first);
    unregisterUpdateSession(second);
  }
});
