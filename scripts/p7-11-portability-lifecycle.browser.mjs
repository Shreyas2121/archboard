// PREPARED ONLY. Requires all Version 1 implementation and explicit browser resumption.
// Use a served production host/API, disposable owner below the cap and isolated DB.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  allEntityGraphFixture,
  normalizeGraphFixtureIds,
} from '../packages/fixtures/dist/index.js';
import { parsePortableJson } from '../packages/export/dist/index.js';
import {
  checkpointDetailResponseSchema,
  boardDetailResponseSchema,
} from '../packages/contracts/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
assert.ok(process.env.P7_WEB_ORIGIN && process.env.P7_API_ORIGIN && process.env.P7_OWNER_STATE);
const web = new URL(process.env.P7_WEB_ORIGIN).origin;
const api = new URL(process.env.P7_API_ORIGIN).origin;
const graph = structuredClone(allEntityGraphFixture);
graph.nodes.find((node) => node.kind === 'note').content.body =
  '<script>globalThis.__unsafe = true</script><img src="https://hostile.invalid/pixel">';
graph.nodes.find((node) => node.kind === 'component').content.externalUrl =
  'https://hostile.invalid/inert';
const file = {
  format: 'archboard',
  formatVersion: 1,
  exportedAt: '2026-10-02T00:00:00.000Z',
  syncStatusAtExport: 'local-only',
  board: { title: 'P7-11 all-kind', description: 'Synthetic fixture' },
  graph,
};
let browser;
let stage = 'configuration';
async function download(page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local recovery', exact: true }).click();
  const result = await event;
  return parsePortableJson(new Uint8Array(await readFile(await result.path())));
}
async function editNotes(page, notes) {
  await page.getByRole('tab', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: `1. ${graph.steps[0].title}`, exact: true }).click();
  await page.getByLabel('Step notes', { exact: true }).fill(notes);
  await page.getByLabel('Step notes', { exact: true }).blur();
}
async function freshWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
async function noApiCache(page) {
  assert.equal(
    await page.evaluate(async () => {
      let count = 0;
      for (const key of await globalThis.caches.keys())
        for (const request of await (await globalThis.caches.open(key)).keys())
          if (/\/api(?:\/|$)/.test(new URL(request.url).pathname)) count++;
      return count;
    }),
    0,
  );
}
async function until(predicate) {
  const deadline = Date.now() + 15_000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for synthetic state.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const options = {
    storageState: process.env.P7_OWNER_STATE,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  };
  const online = await browser.newContext(options);
  const original = await browser.newContext(options);
  const page = await online.newPage();
  const unexpected = [];
  for (const context of [online, original])
    context.on('request', (request) => {
      if (/^https?:/.test(request.url()) && ![web, api].includes(new URL(request.url()).origin))
        unexpected.push(true);
    });
  stage = 'A17 actual all-kind hostile-text file import and parsed download';
  await page.goto(`${web}/boards`);
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await page.getByLabel('JSON file', { exact: true }).setInputFiles({
    name: 'all-kind.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByLabel('New board title', { exact: true }).fill(file.board.title);
  await page
    .getByRole('button', { name: 'Create private board from this file', exact: true })
    .click();
  await page.waitForURL((url) => /^\/boards\/[a-f0-9-]{36}$/.test(url.pathname));
  const board = new URL(page.url()).pathname.split('/').at(-1);
  const imported = await download(page);
  assert.deepEqual(normalizeGraphFixtureIds(imported.graph), normalizeGraphFixtureIds(graph));
  const originalIds = new Set(
    [...graph.nodes, ...graph.edges, ...graph.boundaries, ...graph.steps].map((e) => e.id),
  );
  assert.ok(
    [
      ...imported.graph.nodes,
      ...imported.graph.edges,
      ...imported.graph.boundaries,
      ...imported.graph.steps,
    ].every((e) => !originalIds.has(e.id)),
  );
  assert.equal(await page.evaluate(() => globalThis.__unsafe === true), false);

  stage = 'A16 exact committed checkpoint and lost successful response retry';
  const posted = [];
  await page.route(`**/api/v1/boards/${board}/checkpoints`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posted.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    if (posted.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Checkpoints & JSON', exact: true }).click();
  await page.getByLabel('Checkpoint name (1–120 characters)', { exact: true }).fill('P7-11 frozen');
  await page.getByRole('button', { name: 'Create checkpoint', exact: true }).click();
  await page.getByText('Creation is unconfirmed.', { exact: false }).waitFor();
  await page
    .getByRole('button', { name: 'Retry identical checkpoint request', exact: true })
    .click();
  assert.deepEqual(posted[1], posted[0]);
  const link = page.getByRole('link', { name: 'P7-11 frozen', exact: true });
  await link.waitFor();
  const checkpointPath = await link.getAttribute('href');
  await page.unroute(`**/api/v1/boards/${board}/checkpoints`);
  const checkpointId = checkpointPath.split('/').at(-1);
  const detailUrl = `${api}/api/v1/boards/${board}/checkpoints/${checkpointId}`;
  const frozenResponse = await online.request.get(detailUrl);
  assert.equal(frozenResponse.headers()['cache-control'], 'no-store');
  const frozen = checkpointDetailResponseSchema.parse(await frozenResponse.json()).data;
  assert.deepEqual(frozen.graph, imported.graph);
  await page.getByRole('dialog').press('Escape');

  stage = 'A10/A22 original offline pending work stays in its original namespace';
  const oldPage = await original.newPage();
  await oldPage.goto(`${web}/boards/${board}`);
  await freshWorker(oldPage);
  await original.setOffline(true);
  await editNotes(oldPage, 'Original offline pending notes');
  const pending = await download(oldPage);
  assert.equal(pending.syncStatusAtExport, 'local-only');
  assert.equal(pending.graph.steps[0].notes, 'Original offline pending notes');
  await oldPage.reload();
  assert.equal((await download(oldPage)).graph.steps[0].notes, 'Original offline pending notes');

  stage = 'A16 direct read-only checkpoint and fresh restored board independence';
  const snapshotPage = await online.newPage();
  let sockets = 0;
  snapshotPage.on('websocket', () => sockets++);
  await snapshotPage.goto(`${web}${checkpointPath}`);
  await snapshotPage
    .getByRole('heading', { name: 'Read-only checkpoint: P7-11 frozen', exact: true })
    .waitFor();
  assert.equal(sockets, 0);
  await snapshotPage
    .getByLabel('New private board title', { exact: true })
    .fill('P7-11 isolated restore');
  await snapshotPage
    .getByRole('button', { name: 'Restore as new private board', exact: true })
    .click();
  await snapshotPage.waitForURL((url) => /^\/boards\/[a-f0-9-]{36}$/.test(url.pathname));
  const restoredId = new URL(snapshotPage.url()).pathname.split('/').at(-1);
  assert.notEqual(restoredId, board);
  const restored = await download(snapshotPage);
  assert.deepEqual(
    normalizeGraphFixtureIds(restored.graph),
    normalizeGraphFixtureIds(frozen.graph),
  );
  const frozenIds = new Set(
    [
      ...frozen.graph.nodes,
      ...frozen.graph.edges,
      ...frozen.graph.boundaries,
      ...frozen.graph.steps,
    ].map((e) => e.id),
  );
  assert.ok(
    [
      ...restored.graph.nodes,
      ...restored.graph.edges,
      ...restored.graph.boundaries,
      ...restored.graph.steps,
    ].every((e) => !frozenIds.has(e.id)),
  );
  await editNotes(snapshotPage, 'Restored board independent notes');
  assert.equal((await download(oldPage)).graph.steps[0].notes, 'Original offline pending notes');
  await original.setOffline(false);
  await until(
    async () =>
      boardDetailResponseSchema.parse(
        await (await online.request.get(`${api}/api/v1/boards/${board}`)).json(),
      ).data.latestSeq !== frozen.throughSeq,
  );
  assert.deepEqual(
    checkpointDetailResponseSchema.parse(await (await online.request.get(detailUrl)).json()).data,
    frozen,
  );
  await oldPage.reload();
  assert.equal(new URL(oldPage.url()).pathname, `/boards/${board}`);
  assert.equal((await download(oldPage)).graph.steps[0].notes, 'Original offline pending notes');
  assert.equal(
    (await download(snapshotPage)).graph.steps[0].notes,
    'Restored board independent notes',
  );

  stage = 'A25 active-worker checkpoint cache exclusion and offline direct route';
  await freshWorker(page);
  await page.goto(`${web}${checkpointPath}`);
  await page
    .getByRole('heading', { name: 'Read-only checkpoint: P7-11 frozen', exact: true })
    .waitFor();
  await noApiCache(page);
  await online.setOffline(true);
  await page.reload();
  await page.getByText('Checkpoint unavailable offline.', { exact: false }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Restore as new private board', exact: true }).count(),
    0,
  );
  await noApiCache(page);
  assert.deepEqual(unexpected, []);
  await original.close();
  await online.close();
  process.stdout.write(
    'PASS: A16/A17 original/offline/restored isolation, actual file semantics, hostile inert text, keyed capture retry and A25 worker-cache/direct-route subset.\n',
  );
} catch {
  process.stderr.write(`FAIL: P7-11 ${stage}; private details withheld.\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
