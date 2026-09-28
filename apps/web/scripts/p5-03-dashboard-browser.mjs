import { spawn } from 'node:child_process';
import { chromium } from '../../../packages/sync-client/node_modules/playwright/index.mjs';

const origin = 'http://127.0.0.1:4173';
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

async function seedCache(page) {
  await page.evaluate(async (deploymentOrigin) => {
    const database = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('archboard-sync-client', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('boardCache'))
          db.createObjectStore('boardCache', { keyPath: 'namespace' });
        if (!db.objectStoreNames.contains('localSnapshots'))
          db.createObjectStore('localSnapshots', { keyPath: 'namespace' });
        if (!db.objectStoreNames.contains('localUpdates')) {
          db.createObjectStore('localUpdates', {
            keyPath: ['namespace', 'localSequence'],
          }).createIndex('byNamespace', 'namespace');
        }
        if (!db.objectStoreNames.contains('receivedState'))
          db.createObjectStore('receivedState', { keyPath: 'namespace' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const timestamp = '2026-01-01T10:00:00.000Z';
    const records = [
      ['account-a', '00000000-0000-4000-8000-000000000001', 'Alpha cached board', false, true],
      ['account-a', '00000000-0000-4000-8000-000000000002', 'Unavailable document', false, false],
      ['account-a', '00000000-0000-4000-8000-000000000003', 'Archived cache', true, true],
      ['account-a', '00000000-0000-4000-8000-000000000006', null, false, false],
      ['account-b', '00000000-0000-4000-8000-000000000004', 'Other account secret', false, true],
      ['local-demo', '00000000-0000-4000-8000-000000000005', 'Demo secret', false, true],
    ];
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['boardCache', 'localSnapshots'], 'readwrite');
      for (const [userId, boardId, title, archived, available] of records) {
        const namespace = JSON.stringify([deploymentOrigin, userId, boardId, 1]);
        transaction.objectStore('boardCache').put({
          namespace,
          role: archived ? 'owner' : 'editor',
          metadata: {
            archived,
            ...(title === null
              ? {}
              : {
                  summary: {
                    id: boardId,
                    title,
                    description: '',
                    archivedAt: archived ? timestamp : null,
                    metadataVersion: 1,
                    contentUpdatedAt: timestamp,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                  },
                }),
          },
          cachedAt: timestamp,
          lastServerSequence: '1',
        });
        if (available)
          transaction.objectStore('localSnapshots').put({
            namespace,
            throughLocalSequence: 1,
            updateBytes: new Uint8Array([1]),
            updatedAt: timestamp,
          });
      }
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    localStorage.setItem(
      `archboard:account:${deploymentOrigin}`,
      JSON.stringify({ userId: 'account-a' }),
    );
  }, origin);
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
  await page.goto(`${origin}/demo`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    'Service worker did not control the page.',
  );
  await seedCache(page);
  await context.setOffline(true);
  const response = await page.goto(`${origin}/boards`, { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), 'Offline direct /boards navigation failed.');
  await page.getByRole('heading', { name: 'Cached boards on this device' }).waitFor();
  await page.getByText('Alpha cached board').waitFor();
  expect(
    (await page.getByText('Other account secret').count()) === 0,
    'Second account leaked into account A list.',
  );
  expect((await page.getByText('Demo secret').count()) === 0, 'Demo leaked into account A list.');
  expect(
    (await page.getByText('Archived cache').count()) === 0,
    'Archived board ignored active filter.',
  );
  expect(
    (await page.getByText('Local document unavailable').count()) === 2,
    'Missing document was not labeled.',
  );
  expect(
    (await page.getByRole('heading', { name: 'Board details unavailable' }).count()) === 1,
    'Missing metadata was not labeled.',
  );
  expect(
    (await page.getByText('Details may be outdated').count()) >= 2,
    'Stale metadata warning missing.',
  );
  expect(
    await page.getByRole('button', { name: 'New board' }).isDisabled(),
    'Create remained active offline.',
  );
  expect(
    (await page.getByRole('link', { name: 'Open board' }).count()) === 1,
    'A locally available board could not be opened.',
  );
  expect(
    await page
      .getByRole('article')
      .filter({ hasText: 'Unavailable document' })
      .getByRole('button', { name: 'Open board' })
      .isDisabled(),
    'A board without a local document appeared openable.',
  );
  for (const name of ['Edit details', 'Archive', 'Duplicate']) {
    expect(
      await page.getByRole('button', { name }).first().isDisabled(),
      `${name} remained active offline.`,
    );
  }
  await page.getByRole('searchbox', { name: 'Search cached titles or IDs' }).fill('Unavailable');
  expect(
    (await page.getByText('Alpha cached board').count()) === 0,
    'Local search did not filter.',
  );
  expect(
    (await page.getByText('Unavailable document').count()) === 1,
    'Local search lost matching board.',
  );
  await page.getByRole('searchbox', { name: 'Search cached titles or IDs' }).fill('');
  await page.getByRole('combobox', { name: 'Show cached' }).click();
  await page.getByRole('option', { name: 'Archived boards' }).click();
  expect((await page.getByText('Archived cache').count()) === 1, 'Local archive filter failed.');
  expect(
    await page.getByRole('button', { name: 'Restore' }).isDisabled(),
    'Restore remained active offline.',
  );

  await page.evaluate(
    (deploymentOrigin) => localStorage.removeItem(`archboard:account:${deploymentOrigin}`),
    origin,
  );
  await page.reload();
  await page.getByRole('heading', { name: 'No account available offline' }).waitFor();
  expect(
    (await page.getByText('Alpha cached board').count()) === 0,
    'Signed-out state exposed cache.',
  );

  await page.evaluate(
    (deploymentOrigin) =>
      localStorage.setItem(
        `archboard:account:${deploymentOrigin}`,
        JSON.stringify({ userId: 'first-use-account' }),
      ),
    origin,
  );
  await page.reload();
  await page.getByRole('heading', { name: 'No boards cached on this device' }).waitFor();
  expect(
    (await page.getByText('Alpha cached board').count()) === 0,
    'First-use account exposed another cache.',
  );

  await page.evaluate(
    (deploymentOrigin) =>
      localStorage.setItem(
        `archboard:account:${deploymentOrigin}`,
        JSON.stringify({ userId: 'account-b' }),
      ),
    origin,
  );
  await page.reload();
  await page.getByText('Other account secret').waitFor();
  expect(
    (await page.getByText('Alpha cached board').count()) === 0,
    'Account A leaked into account B list.',
  );
  const cacheUrls = await page.evaluate(async () =>
    (
      await Promise.all(
        (await globalThis.caches.keys()).map(async (name) =>
          (await (await globalThis.caches.open(name)).keys()).map((request) => request.url),
        ),
      )
    ).flat(),
  );
  expect(
    cacheUrls.every((url) => !/\/(?:api|auth)(?:\/|$)/.test(new URL(url).pathname)),
    'API response entered Cache Storage.',
  );
  console.log(
    `PASS: Chrome ${browser.version()}, ${origin}/boards, service worker controlled, browser offline, selected account isolation, demo exclusion, local search/filter, disabled actions, empty and signed-out states, ${cacheUrls.length} static cache entries`,
  );
  await context.close();
} finally {
  await browser?.close();
  preview.kill();
}
