// PREPARED ONLY. Requires all Version 1 implementation AND explicit browser resumption.
// Served production build + real API/DB, independent synthetic owner/viewer sessions,
// active board with at least two distinct, consecutive steps and an archived readable board.
// Storage-state files stay outside Git. No cookies, payloads, URLs, traces or screenshots printed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as contracts from '../packages/contracts/dist/index.js';
import { projectGraphDocument } from '../packages/document-model/dist/index.js';

const requireSync = createRequire(new URL('../packages/sync-client/package.json', import.meta.url));
const { chromium } = requireSync('playwright');
const Y = requireSync('yjs');
const { getViewportForBounds } = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
)('@xyflow/react');
const required = [
  'P7_WEB_ORIGIN',
  'P7_API_ORIGIN',
  'P7_BOARD_ID',
  'P7_ARCHIVED_BOARD_ID',
  'P7_OWNER_STATE',
  'P7_VIEWER_STATE',
];
assert.ok(
  required.every((key) => process.env[key]),
  'Synthetic fixture configuration is required.',
);
const web = new URL(process.env.P7_WEB_ORIGIN).origin;
const api = new URL(process.env.P7_API_ORIGIN).origin;
const board = contracts.applicationIdSchema.parse(process.env.P7_BOARD_ID);
const archive = contracts.applicationIdSchema.parse(process.env.P7_ARCHIVED_BOARD_ID);
const viewport = { width: 1440, height: 1000 };
const TIMEOUT_MS = 10_000;
const TOLERANCE = 0.01;
let browser;
let stage = 'configuration';
const watches = [];

function observe(page) {
  const watch = {
    graph: null,
    presenter: null,
    presenterFrames: 0,
    durableFrames: 0,
    sentUpdates: 0,
  };
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string' && JSON.parse(payload).event === 'update')
        watch.sentUpdates++;
    });
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      const message = contracts.serverMessageSchema.parse(JSON.parse(payload));
      if (message.event === 'ready') {
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, Buffer.from(message.data.snapshotBase64, 'base64'));
          watch.graph = projectGraphDocument(doc);
        } finally {
          doc.destroy();
        }
      }
      if (message.event === 'presenter') {
        watch.presenter = message.data;
        watch.presenterFrames++;
      }
      if (message.event === 'ack' || message.event === 'update') watch.durableFrames++;
    });
  });
  watches.push(watch);
  return watch;
}
async function until(predicate) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for synthetic presentation state.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function camera(page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new globalThis.DOMMatrixReadOnly(element.style.transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}
async function paint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  );
}
async function waitForCamera(page, expected) {
  await page.waitForFunction(
    ({ expected, tolerance }) => {
      const element = globalThis.document.querySelector('.react-flow__viewport');
      if (!element) return false;
      const matrix = new globalThis.DOMMatrixReadOnly(element.style.transform);
      return (
        Math.abs(matrix.e - expected.x) < tolerance &&
        Math.abs(matrix.f - expected.y) < tolerance &&
        Math.abs(matrix.a - expected.zoom) < tolerance
      );
    },
    { expected, tolerance: TOLERANCE },
  );
}
function near(actual, expected) {
  for (const key of ['x', 'y', 'zoom'])
    assert.ok(Math.abs(actual[key] - expected[key]) < TOLERANCE, 'Unexpected synthetic viewport.');
}
async function expectedCamera(page, step) {
  const bounds = await page.locator('#architecture-canvas').boundingBox();
  assert.ok(bounds);
  // Uses the same pinned public geometry helper, with product bounds from the existing canvas.
  return getViewportForBounds(step.rect, bounds.width, bounds.height, 0.001, 2, 0);
}
async function present(page, step) {
  await page.getByRole('tab', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: `Present ${step.title}`, exact: true }).click();
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const owner = await browser.newContext({ storageState: process.env.P7_OWNER_STATE, viewport });
  const reader = await browser.newContext({ storageState: process.env.P7_VIEWER_STATE, viewport });
  const identities = await Promise.all(
    [owner, reader].map(
      async (context) =>
        contracts.currentUserResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/me`)).json(),
        ).data.id,
    ),
  );
  assert.notEqual(identities[0], identities[1]);
  const boards = await Promise.all(
    [owner, reader].map(
      async (context) =>
        contracts.boardDetailResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/boards/${board}`)).json(),
        ).data,
    ),
  );
  assert.equal(boards[0].effectiveRole, 'owner');
  assert.equal(boards[1].effectiveRole, 'viewer');
  assert.equal(boards[0].archivedAt, null);
  const before = boards[0];
  const ownerPage = await owner.newPage();
  const readerPage = await reader.newPage();
  const ownerWatch = observe(ownerPage);
  const readerWatch = observe(readerPage);
  await Promise.all([ownerPage, readerPage].map((page) => page.goto(`${web}/boards/${board}`)));
  await until(() => ownerWatch.graph !== null && readerWatch.graph !== null);
  const steps = [...ownerWatch.graph.steps].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const [a, b] = steps;
  assert.ok(a && b && a.title && b.title && a.title !== b.title);
  assert.notDeepEqual(a.rect, b.rect);
  stage = 'viewer denial and passive local playback';
  await present(ownerPage, a);
  await present(readerPage, b);
  await paint(readerPage);
  assert.equal(
    await readerPage.getByRole('button', { name: 'Acquire presenter', exact: true }).count(),
    0,
  );
  const localCamera = await camera(readerPage);
  await ownerPage.getByRole('button', { name: 'Acquire presenter', exact: true }).click();
  await ownerPage.getByText('You are presenting live.', { exact: true }).waitFor();
  await ownerPage.getByRole('button', { name: 'Broadcast current step', exact: true }).click();
  await until(() => readerWatch.presenter?.stepId === a.id);
  await paint(readerPage);
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  near(await camera(readerPage), localCamera);
  stage = 'explicit opt-in and A21 pan release';
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).click();
  await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).waitFor();
  await readerPage.waitForFunction(
    () => globalThis.document.querySelector('[data-following="true"]') !== null,
  );
  await waitForCamera(readerPage, await expectedCamera(readerPage, a));
  const canvas = await readerPage.locator('#architecture-canvas').boundingBox();
  assert.ok(canvas);
  await readerPage.mouse.move(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.85);
  await readerPage.mouse.down();
  await readerPage.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.7, {
    steps: 12,
  });
  await readerPage.mouse.up();
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).waitFor();
  await paint(readerPage);
  const panned = await camera(readerPage);
  assert.notDeepEqual(panned, await expectedCamera(readerPage, a));
  await ownerPage.getByRole('button', { name: 'Next presentation step', exact: true }).click();
  await until(() => readerWatch.presenter?.stepId === b.id);
  await paint(readerPage);
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  near(await camera(readerPage), panned);
  stage = 'keyboard unfollow, exit, lease loss and new lease';
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).click();
  const unfollow = readerPage.getByRole('button', { name: 'Unfollow', exact: true });
  await unfollow.focus();
  await unfollow.press('Enter');
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).waitFor();
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).click();
  await readerPage.keyboard.press('Escape');
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Release presenter', exact: true }).click();
  await readerPage.getByText('No active presenter.', { exact: true }).waitFor();
  assert.equal(
    await readerPage
      .getByRole('button', { name: 'Previous presentation step', exact: true })
      .isDisabled(),
    false,
  );
  await ownerPage.getByRole('button', { name: 'Acquire presenter', exact: true }).click();
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).waitFor();
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  stage = 'offline reconnect requires fresh opt-in';
  await readerPage.evaluate(() => navigator.serviceWorker.ready);
  await readerPage.reload();
  await readerPage.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).waitFor();
  await ownerPage.getByRole('button', { name: 'Broadcast current step', exact: true }).click();
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).click();
  await reader.setOffline(true);
  await readerPage.reload();
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  await reader.setOffline(false);
  await readerPage.reload();
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).waitFor();
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  stage = 'account and board namespace isolation';
  await reader.clearCookies();
  await reader.addCookies(await owner.cookies());
  await readerPage.goto(`${web}/boards/${board}`);
  await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).waitFor();
  assert.equal(await readerPage.getByRole('button', { name: 'Unfollow', exact: true }).count(), 0);
  await readerPage.goto(`${web}/boards/${archive}`);
  await readerPage
    .getByText('Live presenting is unavailable. Local playback remains available.', { exact: true })
    .waitFor();
  assert.equal(
    await readerPage.getByRole('button', { name: 'Follow presenter', exact: true }).count(),
    0,
  );
  assert.equal(
    await readerPage.getByRole('button', { name: 'Acquire presenter', exact: true }).count(),
    0,
  );
  stage = 'transient durability boundary';
  assert.ok(readerWatch.presenterFrames > 0);
  assert.equal(
    watches.reduce((count, watch) => count + watch.sentUpdates + watch.durableFrames, 0),
    0,
  );
  const after = contracts.boardDetailResponseSchema.parse(
    await (await owner.request.get(`${api}/api/v1/boards/${board}`)).json(),
  ).data;
  assert.equal(after.contentUpdatedAt, before.contentUpdatedAt);
  console.log('P7-05 prepared independent-browser assertions passed.');
} catch {
  console.error(`P7-05 browser verification failed at ${stage}; protected details omitted.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
