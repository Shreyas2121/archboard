import { spawn } from 'node:child_process';
import { chromium } from '../../../packages/sync-client/node_modules/playwright/index.mjs';
import * as Y from '../../../packages/sync-client/node_modules/yjs/dist/yjs.mjs';
import {
  createGraphDocument,
  createNode,
  projectGraphDocument,
} from '../../../packages/document-model/dist/index.js';

const origin = 'http://127.0.0.1:4173';
const boardId = '00000000-0000-4000-8000-000000000041';
const viewerBoardId = '00000000-0000-4000-8000-000000000042';
const archivedBoardId = '00000000-0000-4000-8000-000000000043';
const missingBoardId = '00000000-0000-4000-8000-000000000044';
const missingDocumentId = '00000000-0000-4000-8000-000000000045';
const accountId = 'offline-editor-account';
const preview = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { cwd: new URL('..', import.meta.url), stdio: 'ignore' },
);
let browser;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      /* Starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Production preview did not start.');
}

function initialBytes() {
  const document = createGraphDocument();
  createNode(document, {
    id: '00000000-0000-4000-8000-000000000050',
    kind: 'note',
    position: { x: 80, y: 120 },
    size: { width: 240, height: 180 },
    title: 'Initial cached node',
    color: 'gray',
    content: { body: 'Cached before disconnect' },
  });
  const bytes = Array.from(Y.encodeStateAsUpdate(document));
  document.destroy();
  return bytes;
}

async function seedCache(page) {
  await page.evaluate(
    async ({ deploymentOrigin, bytes, boards, userId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('archboard-sync-client', 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('boardCache'))
            db.createObjectStore('boardCache', { keyPath: 'namespace' });
          if (!db.objectStoreNames.contains('localSnapshots'))
            db.createObjectStore('localSnapshots', { keyPath: 'namespace' });
          if (!db.objectStoreNames.contains('localUpdates'))
            db.createObjectStore('localUpdates', {
              keyPath: ['namespace', 'localSequence'],
            }).createIndex('byNamespace', 'namespace');
          if (!db.objectStoreNames.contains('outbox')) {
            const store = db.createObjectStore('outbox', { keyPath: ['namespace', 'updateId'] });
            store.createIndex('byNamespace', 'namespace');
            store.createIndex('byNamespaceAndSequence', ['namespace', 'localSequence']);
          }
          if (!db.objectStoreNames.contains('outboxReceipts'))
            db.createObjectStore('outboxReceipts', {
              keyPath: ['namespace', 'updateId'],
            }).createIndex('byNamespace', 'namespace');
          if (!db.objectStoreNames.contains('receivedState'))
            db.createObjectStore('receivedState', { keyPath: 'namespace' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const timestamp = '2026-01-01T10:00:00.000Z';
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          ['boardCache', 'localSnapshots', 'receivedState'],
          'readwrite',
        );
        for (const [id, role, archived, hasDocument = true] of boards) {
          const namespace = JSON.stringify([deploymentOrigin, userId, id, 1]);
          transaction.objectStore('boardCache').put({
            namespace,
            role,
            metadata: {
              archived,
              summary: {
                id,
                title: `Cached ${role} board`,
                description: '',
                archivedAt: archived ? timestamp : null,
                metadataVersion: 1,
                contentUpdatedAt: timestamp,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            },
            cachedAt: timestamp,
            lastServerSequence: '1',
          });
          if (hasDocument)
            transaction.objectStore('localSnapshots').put({
              namespace,
              throughLocalSequence: 1,
              updateBytes: new Uint8Array(bytes),
              updatedAt: timestamp,
            });
          transaction.objectStore('receivedState').put({ namespace, lastServerSequence: '1' });
        }
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem(`archboard:account:${deploymentOrigin}`, JSON.stringify({ userId }));
    },
    {
      deploymentOrigin: origin,
      bytes: initialBytes(),
      boards: [
        [boardId, 'editor', false],
        [viewerBoardId, 'viewer', false],
        [archivedBoardId, 'owner', true],
        [missingDocumentId, 'editor', false, false],
      ],
      userId: accountId,
    },
  );
}

async function localRecords(page, id = boardId) {
  return page.evaluate(
    async ({ deploymentOrigin, userId, boardId: targetId }) => {
      const namespace = JSON.stringify([deploymentOrigin, userId, targetId, 1]);
      const request = globalThis.indexedDB.open('archboard-sync-client', 2);
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const result = await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          ['localSnapshots', 'localUpdates', 'outbox'],
          'readonly',
        );
        const snapshot = transaction.objectStore('localSnapshots').get(namespace);
        const updates = transaction
          .objectStore('localUpdates')
          .index('byNamespace')
          .getAll(namespace);
        const outbox = transaction.objectStore('outbox').index('byNamespace').getAll(namespace);
        transaction.oncomplete = () =>
          resolve({
            snapshot: snapshot.result
              ? { ...snapshot.result, updateBytes: Array.from(snapshot.result.updateBytes) }
              : null,
            updates: updates.result.map((row) => ({
              ...row,
              updateBytes: Array.from(row.updateBytes),
            })),
            outbox: outbox.result.map((row) => ({
              ...row,
              updateBytes: Array.from(row.updateBytes),
              payloadHash: Array.from(row.payloadHash),
            })),
          });
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return result;
    },
    { deploymentOrigin: origin, userId: accountId, boardId: id },
  );
}

function projectionFromRecords(records) {
  const document = createGraphDocument();
  Y.applyUpdate(document, Uint8Array.from(records.snapshot.updateBytes));
  for (const record of records.updates.sort((a, b) => a.localSequence - b.localSequence)) {
    if (record.localSequence > records.snapshot.throughLocalSequence)
      Y.applyUpdate(document, Uint8Array.from(record.updateBytes));
  }
  const projection = projectGraphDocument(document);
  document.destroy();
  return projection;
}

async function demoRecordKeys(page) {
  return page.evaluate(async () => {
    const request = globalThis.indexedDB.open('archboard-sync-client', 2);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['localSnapshots', 'localUpdates', 'outbox'];
    const keys = await Promise.all(
      stores.map(
        (name) =>
          new Promise((resolve, reject) => {
            const transaction = database.transaction(name, 'readonly');
            const query = transaction.objectStore(name).getAllKeys();
            query.onsuccess = () =>
              resolve(query.result.map((key) => `${name}:${JSON.stringify(key)}`));
            query.onerror = () => reject(query.error);
          }),
      ),
    );
    database.close();
    return keys
      .flat()
      .filter((key) => key.includes('local-demo'))
      .sort();
  });
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    viewport: { width: 1440, height: 900 },
  });
  const warmPage = await context.newPage();
  warmPage.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
  await warmPage.goto(`${origin}/demo`);
  await warmPage.evaluate(() => navigator.serviceWorker.ready);
  await warmPage.reload();
  await warmPage.getByText('Saved on this device').first().waitFor();
  expect(
    await warmPage.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    'Service worker did not control the page.',
  );
  await seedCache(warmPage);
  const demoNamespacesBefore = await demoRecordKeys(warmPage);
  expect(demoNamespacesBefore.length > 0, 'Demo had no durable local records to preserve.');
  await context.setOffline(true);
  await warmPage.close();

  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
  const response = await page.goto(`${origin}/boards/${boardId}`, {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.ok(), 'Offline direct editor navigation failed.');
  await page.getByText('Initial cached node').first().waitFor();
  await page.getByText('Offline · cached copy').first().waitFor();
  expect(
    (await page.getByText('Saved on this device · offline').count()) === 0,
    'Hydration alone displayed a new device-save label.',
  );
  expect(
    await page.getByRole('button', { name: /Note.*Context for the team/ }).isEnabled(),
    'Cached editor did not gain writer access.',
  );

  const second = await context.newPage();
  await second.goto(`${origin}/boards/${boardId}`);
  await second.getByText('Read-only · open in another tab').first().waitFor();
  expect(
    await second.getByRole('button', { name: /Note.*Context for the team/ }).isDisabled(),
    'Second tab could edit without the Web Lock.',
  );
  const before = await localRecords(page);
  expect(before.outbox.length === 0, 'Hydration fabricated pending updates.');
  await page.getByRole('button', { name: /Note.*Context for the team/ }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Committed offline note');
  await page.getByRole('textbox', { name: 'Title' }).blur();
  await page.getByText('Saved on this device · offline').first().waitFor();
  const committed = await localRecords(page);
  expect(committed.outbox.length > 0, 'Offline edit did not enter the outbox.');
  expect(
    committed.outbox.every((record) =>
      committed.updates.some(
        (update) =>
          update.updateId === record.updateId &&
          JSON.stringify(update.updateBytes) === JSON.stringify(record.updateBytes),
      ),
    ),
    'Outbox bytes differ from committed local log.',
  );
  const committedProjection = projectionFromRecords(committed);
  expect(
    committedProjection.nodes.some((node) => node.title === 'Committed offline note'),
    'Committed title absent from durable graph.',
  );
  expect(
    committedProjection.nodes.some(
      (node) =>
        node.title === 'Initial cached node' && node.position.x === 80 && node.position.y === 120,
    ),
    'Initial content or geometry changed.',
  );
  await page.close();
  await second.waitForFunction(() =>
    [...globalThis.document.querySelectorAll('button')].some(
      (button) => button.textContent?.includes('Context for the team') && !button.disabled,
    ),
  );
  expect(
    await second.getByRole('button', { name: /Note.*Context for the team/ }).isEnabled(),
    'Second tab did not acquire writer lock after transfer.',
  );
  await second.close();

  const reopened = await context.newPage();
  await reopened.goto(`${origin}/boards/${boardId}`);
  await reopened.getByText('Committed offline note').first().waitFor();
  const after = await localRecords(reopened);
  expect(
    JSON.stringify(projectionFromRecords(after)) === JSON.stringify(committedProjection),
    'Reload did not restore exact committed graph content and geometry.',
  );
  expect(
    JSON.stringify(after.outbox) === JSON.stringify(committed.outbox),
    'Reload changed pending update bytes.',
  );
  await reopened.close();

  for (const [id, label] of [
    [viewerBoardId, 'Read-only · viewer'],
    [archivedBoardId, 'Read-only · archived'],
  ]) {
    const readOnly = await context.newPage();
    await readOnly.goto(`${origin}/boards/${id}`);
    await readOnly.getByText(label).first().waitFor();
    expect(
      await readOnly.getByRole('button', { name: /Note.*Context for the team/ }).isDisabled(),
      `${label} permitted editing.`,
    );
    await readOnly.close();
  }
  for (const id of [missingBoardId, missingDocumentId]) {
    const unavailable = await context.newPage();
    await unavailable.goto(`${origin}/boards/${id}`);
    await unavailable.getByRole('heading', { name: 'Board unavailable offline' }).waitFor();
    expect(
      (await unavailable.getByText('Initial cached node').count()) === 0,
      'Board without a local document borrowed another graph.',
    );
    await unavailable.close();
  }

  const accountSwitch = await context.newPage();
  await accountSwitch.goto(`${origin}/demo`);
  await accountSwitch.evaluate(
    (deploymentOrigin) =>
      localStorage.setItem(
        `archboard:account:${deploymentOrigin}`,
        JSON.stringify({ userId: 'second-account' }),
      ),
    origin,
  );
  await accountSwitch.goto(`${origin}/boards/${boardId}`);
  await accountSwitch.getByRole('heading', { name: 'Board unavailable offline' }).waitFor();
  const demoNamespacesAfter = await demoRecordKeys(accountSwitch);
  expect(
    JSON.stringify(demoNamespacesAfter) === JSON.stringify(demoNamespacesBefore),
    'Account selection changed demo storage.',
  );
  await accountSwitch.evaluate(
    (deploymentOrigin) => localStorage.removeItem(`archboard:account:${deploymentOrigin}`),
    origin,
  );
  await accountSwitch.reload();
  await accountSwitch.getByRole('heading', { name: 'No account available offline' }).waitFor();
  console.log(
    `PASS: Chrome ${browser.version()}, service-worker-controlled offline editor direct route, committed content/geometry and ${committed.outbox.length} pending updates with exact bytes restored, Web Lock transfer, viewer/archive/missing/account isolation, demo namespace preserved`,
  );
  await context.close();
} finally {
  await browser?.close();
  preview.kill();
}
