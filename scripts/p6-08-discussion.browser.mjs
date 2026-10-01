// PREPARED ONLY. Requires both browser verification resumption and completion of
// Version 1 implementation before running these real-session/database-backed cases.
// Supply independent synthetic editor/viewer states and an active fixture board
// with committed node/edge targets. The optional deleted thread fixture must already
// reference an object removed from the committed graph. No traces or state exports.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import * as contracts from '../packages/contracts/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
const required = [
  'P6_WEB_ORIGIN',
  'P6_API_ORIGIN',
  'P6_BOARD_ID',
  'P6_OWNER_STATE',
  'P6_VIEWER_STATE',
  'P6_NODE_ID',
  'P6_EDGE_ID',
];
let browser;
let stage = 'configuration';
try {
  assert.ok(
    required.every((key) => process.env[key]),
    'Synthetic configuration is required.',
  );
  const web = new URL(process.env.P6_WEB_ORIGIN).origin;
  const api = new URL(process.env.P6_API_ORIGIN).origin;
  const board = contracts.applicationIdSchema.parse(process.env.P6_BOARD_ID);
  const nodeId = contracts.applicationIdSchema.parse(process.env.P6_NODE_ID);
  const edgeId = contracts.applicationIdSchema.parse(process.env.P6_EDGE_ID);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const owner = await browser.newContext({
    storageState: process.env.P6_OWNER_STATE,
    viewport: { width: 1440, height: 1000 },
  });
  const viewer = await browser.newContext({
    storageState: process.env.P6_VIEWER_STATE,
    viewport: { width: 1440, height: 1000 },
  });
  stage = 'independent authorized identities';
  const identities = await Promise.all(
    [owner, viewer].map(
      async (context) =>
        contracts.currentUserResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/me`)).json(),
        ).data.id,
    ),
  );
  assert.notEqual(identities[0], identities[1]);
  const readerBoard = contracts.boardDetailResponseSchema.parse(
    await (await viewer.request.get(`${api}/api/v1/boards/${board}`)).json(),
  ).data;
  assert.equal(readerBoard.effectiveRole, 'viewer');
  assert.equal(readerBoard.archivedAt, null);
  const page = await owner.newPage();
  const reader = await viewer.newPage();
  for (const instance of [page, reader]) {
    await instance.goto(`${web}/boards/${board}`);
    await instance.getByRole('tab', { name: 'Discussion', exact: true }).click();
  }
  const panel = page.getByRole('region', { name: 'Board discussion' });
  const readerPanel = reader.getByRole('region', { name: 'Board discussion' });
  stage = 'keyboard point creation and independent live reader';
  const first = `Synthetic P6-08 ${randomUUID()}`;
  await panel.getByLabel('World X', { exact: true }).fill('-160');
  await panel.getByLabel('World Y', { exact: true }).fill('240');
  await panel.getByRole('button', { name: 'Discuss this point', exact: true }).focus();
  await page.keyboard.press('Enter');
  await panel.getByLabel('First message', { exact: true }).fill(first);
  await panel.getByRole('button', { name: 'Send message', exact: true }).focus();
  await page.keyboard.press('Enter');
  await panel
    .getByRole('status')
    .filter({ hasText: /^Message sent\.$/ })
    .waitFor();
  await readerPanel.getByText(first, { exact: true }).waitFor();
  assert.equal(
    await readerPanel.getByRole('button', { name: 'Send message', exact: true }).count(),
    0,
  );
  assert.equal(await readerPanel.getByLabel('World X', { exact: true }).count(), 0);
  const threads = contracts.threadListResponseSchema.parse(
    await (await owner.request.get(`${api}/api/v1/boards/${board}/threads`)).json(),
  );
  const created = threads.data.find((thread) => thread.latestMessage.body === first);
  assert.ok(created?.anchor.type === 'point' && created.anchor.position.x === -160);
  stage = 'rendered reply';
  const reply = `Synthetic reply ${randomUUID()}`;
  await panel.getByLabel('Reply', { exact: true }).fill(reply);
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await readerPanel.getByText(reply, { exact: true }).waitFor();
  stage = 'committed node and edge context';
  for (const anchor of [
    { type: 'node', id: nodeId, label: 'Untrusted client label', position: { x: 1, y: 2 } },
    { type: 'edge', id: edgeId, label: 'Untrusted client label', position: { x: 1, y: 2 } },
  ]) {
    const body = `Synthetic ${anchor.type} ${randomUUID()}`;
    const response = await owner.request.post(`${api}/api/v1/boards/${board}/threads`, {
      headers: { origin: web, 'Idempotency-Key': randomUUID() },
      data: { anchor, body },
    });
    assert.equal(response.status(), 201);
    const result = contracts.threadCreateResponseSchema.parse(await response.json()).data;
    assert.equal(result.thread.anchor.type, anchor.type);
    await readerPanel.getByText(body, { exact: true }).waitFor();
    const summary = readerPanel
      .getByRole('article')
      .filter({ has: reader.getByText(body, { exact: true }) });
    await summary.getByRole('button', { name: 'Focus anchor', exact: true }).focus();
    await reader.keyboard.press('Enter');
  }
  stage = 'offline unsent draft and no automatic reconnect send';
  await panel.getByLabel('Reply', { exact: true }).fill('Synthetic offline draft');
  await owner.setOffline(true);
  await panel
    .getByText('Offline: cached discussion is stale. Reconnect to send.', { exact: true })
    .waitFor();
  assert.equal(
    await panel.getByLabel('Reply', { exact: true }).inputValue(),
    'Synthetic offline draft',
  );
  let automaticPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/threads')) automaticPosts += 1;
  });
  await owner.setOffline(false);
  await panel.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  assert.equal(automaticPosts, 0);
  stage = 'resolved filtering';
  const resolution = await owner.request.patch(
    `${api}/api/v1/boards/${board}/threads/${created.id}`,
    {
      headers: { origin: web },
      data: { resolved: true, expectedVersion: created.version },
    },
  );
  assert.equal(resolution.status(), 200);
  await readerPanel.getByRole('tab', { name: 'Resolved', exact: true }).focus();
  await reader.keyboard.press('Enter');
  await readerPanel.getByText(reply, { exact: true }).waitFor();
  assert.ok((await readerPanel.getByRole('button', { name: /Resolved$/ }).count()) > 0);
  if (process.env.P6_DELETED_THREAD_ID) {
    stage = 'deleted object fallback';
    await readerPanel.getByRole('tab', { name: 'Unresolved', exact: true }).click();
    const target = contracts.applicationIdSchema.parse(process.env.P6_DELETED_THREAD_ID);
    const response = contracts.threadListResponseSchema.parse(
      await (
        await owner.request.get(`${api}/api/v1/boards/${board}/threads?resolved=false&limit=100`)
      ).json(),
    );
    const deleted = response.data.find((thread) => thread.id === target);
    assert.ok(deleted && deleted.anchor.type !== 'point');
    const summary = readerPanel
      .getByRole('article')
      .filter({ has: reader.getByText(deleted.latestMessage.body, { exact: true }) });
    await summary.getByText(/Original object deleted/).waitFor();
    await summary.getByRole('button', { name: 'Go to saved position', exact: true }).click();
  }
  console.log('PASS: P6-08 prepared discussion browser cases. Synthetic fixture rows retained.');
} catch {
  console.error(
    `FAIL: P6-08 discussion browser stage: ${stage}. Raw errors and private content withheld.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
}
