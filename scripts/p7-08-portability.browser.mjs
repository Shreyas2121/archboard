// PREPARED ONLY. Browser execution requires explicit resumption; board/API cases also
// require completion of all Version 1 implementation. Use disposable synthetic fixtures
// and an isolated test database. Storage-state files remain outside Git.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { parsePortableJson } from '../packages/export/dist/index.js';
import { applicationIdSchema } from '../packages/contracts/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
assert.ok(
  process.env.P7_WEB_ORIGIN && process.env.P7_OWNER_STATE && process.env.P7_BOARD_ID,
  'Set the served production origin, isolated synthetic owner storage state and source board ID.',
);
const web = new URL(process.env.P7_WEB_ORIGIN).origin;
const boardId = applicationIdSchema.parse(process.env.P7_BOARD_ID);
let browser;
let stage = 'configuration';
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    storageState: process.env.P7_OWNER_STATE,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  stage = 'complete local demo JSON download';
  await page.goto(`${web}/demo`);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local recovery', exact: true }).click();
  const download = await downloadEvent;
  const file = parsePortableJson(new Uint8Array(await readFile(await download.path())));
  assert.equal(file.syncStatusAtExport, 'local-only');
  assert.ok(file.graph.nodes.length);
  stage = 'strict import error preserves file input';
  await page.goto(`${web}/boards`);
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await page.getByLabel('JSON file', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await page.getByRole('alert').filter({ hasText: 'invalid JSON' }).waitFor();
  assert.equal(
    await page.getByLabel('JSON file', { exact: true }).evaluate((input) => input.files.length),
    1,
  );
  stage = 'uncertain import retries identical keyed payload';
  await page.getByLabel('JSON file', { exact: true }).setInputFiles({
    name: 'synthetic.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByLabel('New board title', { exact: true }).fill('P7 synthetic imported recovery');
  const posted = [];
  let loseFirstResponse = true;
  await page.route('**/api/v1/imports', async (route) => {
    const request = route.request();
    posted.push({ key: request.headers()['idempotency-key'], body: request.postData() });
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page
    .getByRole('button', { name: 'Create private board from this file', exact: true })
    .click();
  await page.getByText('Creation is unconfirmed.', { exact: false }).waitFor();
  assert.equal(posted.length, 1);
  assert.equal(
    await page.getByLabel('JSON file', { exact: true }).evaluate((input) => input.files.length),
    1,
  );
  await page.getByRole('button', { name: 'Retry identical import request', exact: true }).click();
  await page.waitForURL((url) => /^\/boards\/[a-f0-9-]{36}$/.test(url.pathname));
  assert.deepEqual(posted[1], posted[0]);
  stage = 'committed checkpoint capture and read-only route';
  await page.goto(`${web}/boards/${boardId}`);
  await page.getByRole('button', { name: 'Checkpoints & JSON', exact: true }).click();
  const name = `Synthetic capture ${crypto.randomUUID()}`;
  await page.getByLabel('Checkpoint name (1–120 characters)', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create checkpoint', exact: true }).click();
  const checkpointLink = page.getByRole('link', { name, exact: true });
  await checkpointLink.waitFor();
  const checkpointPath = await checkpointLink.getAttribute('href');
  const snapshotPage = await context.newPage();
  let sourceWrites = 0;
  let sourceSockets = 0;
  snapshotPage.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      new URL(request.url()).pathname === `/api/v1/boards/${boardId}`
    )
      sourceWrites++;
  });
  snapshotPage.on('websocket', () => sourceSockets++);
  await snapshotPage.goto(new URL(checkpointPath, web).href);
  await snapshotPage
    .getByRole('heading', { name: `Read-only checkpoint: ${name}`, exact: true })
    .waitFor();
  assert.equal(sourceSockets, 0);
  assert.equal(sourceWrites, 0);
  stage = 'restore as new private board';
  await snapshotPage
    .getByLabel('New private board title', { exact: true })
    .fill('P7 synthetic restored checkpoint');
  await snapshotPage
    .getByRole('button', { name: 'Restore as new private board', exact: true })
    .click();
  await snapshotPage.waitForURL((url) => /^\/boards\/[a-f0-9-]{36}$/.test(url.pathname));
  assert.notEqual(new URL(snapshotPage.url()).pathname, `/boards/${boardId}`);
  assert.equal(sourceWrites, 0);
  stage = 'offline checkpoint unavailable and active worker API cache exclusion';
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.goto(new URL(checkpointPath, web).href);
  await page.getByText('Checkpoint unavailable offline.', { exact: false }).waitFor();
  const protectedEntries = await page.evaluate(async () => {
    const urls = [];
    for (const name of await globalThis.caches.keys())
      for (const request of await (await globalThis.caches.open(name)).keys())
        if (/\/api(?:\/|$)/.test(new URL(request.url).pathname)) urls.push(request.url);
    return urls.length;
  });
  assert.equal(protectedEntries, 0);
  await context.close();
  process.stdout.write(
    'PASS: P7-08 served JSON, uncertain import, checkpoint/restore route, offline and worker-cache subset. Remaining evidence matrix cases still require separate proof.\n',
  );
} catch {
  process.stderr.write(
    `FAIL: P7-08 ${stage}; no private payloads, keys, credentials or URLs recorded.\n`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
}
