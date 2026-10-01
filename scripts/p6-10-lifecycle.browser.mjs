// PREPARED ONLY. Requires browser resumption AND completion of Version 1 implementation.
// Use a disposable active board and independent synthetic owner/editor storage states.
// Fixture discussions remain; role/archive changes are restored in finally.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as contracts from '../packages/contracts/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
let browser;
let owner;
let web;
let boardId;
let actorId;
let stage = 'configuration';
let downgraded = false;
let archived = false;
const boardPath = () => `/api/v1/boards/${boardId}`;
let api;
async function readBoard() {
  const response = await owner.request.get(`${api}${boardPath()}`);
  assert.equal(response.status(), 200);
  return contracts.boardDetailResponseSchema.parse(await response.json()).data;
}
async function setArchive(action) {
  const board = await readBoard();
  const response = await owner.request.post(`${api}${boardPath()}/${action}`, {
    headers: { origin: web },
    data: { expectedVersion: board.metadataVersion },
  });
  assert.equal(response.status(), 200);
}
async function setRole(role) {
  const response = await owner.request.patch(
    `${api}${boardPath()}/members/${encodeURIComponent(actorId)}`,
    {
      headers: { origin: web },
      data: { role },
    },
  );
  assert.equal(response.status(), 200);
}
try {
  const required = [
    'P6_WEB_ORIGIN',
    'P6_API_ORIGIN',
    'P6_BOARD_ID',
    'P6_OWNER_STATE',
    'P6_EDITOR_STATE',
  ];
  assert.ok(required.every((name) => process.env[name]));
  web = new URL(process.env.P6_WEB_ORIGIN).origin;
  api = new URL(process.env.P6_API_ORIGIN).origin;
  boardId = contracts.applicationIdSchema.parse(process.env.P6_BOARD_ID);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  owner = await browser.newContext({ storageState: process.env.P6_OWNER_STATE });
  const editor = await browser.newContext({
    storageState: process.env.P6_EDITOR_STATE,
    viewport: { width: 1440, height: 1000 },
  });
  const me = contracts.currentUserResponseSchema.parse(
    await (await editor.request.get(`${api}/api/v1/me`)).json(),
  ).data;
  actorId = me.id;
  const board = await readBoard();
  assert.equal(board.effectiveRole, 'owner');
  assert.equal(board.archivedAt, null);
  assert.notEqual(board.owner.id, actorId);
  const editorBoard = contracts.boardDetailResponseSchema.parse(
    await (await editor.request.get(`${api}${boardPath()}`)).json(),
  ).data;
  assert.equal(editorBoard.effectiveRole, 'editor');
  const seed = await owner.request.post(`${api}${boardPath()}/threads`, {
    headers: { origin: web, 'Idempotency-Key': randomUUID() },
    data: {
      anchor: { type: 'point', position: { x: 130, y: 170 } },
      body: `Synthetic lifecycle seed ${randomUUID()}`,
    },
  });
  assert.equal(seed.status(), 201);
  const initial = contracts.threadCreateResponseSchema.parse(await seed.json()).data;
  const page = await editor.newPage();
  await page.goto(`${web}/boards/${boardId}`);
  await page.getByRole('tab', { name: 'Discussion', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Board discussion', exact: true });
  await panel
    .locator(`[data-thread-id="${initial.thread.id}"]`)
    .getByRole('button', { name: /Point .*Unresolved$/ })
    .click();
  const draft = `Synthetic retained draft ${randomUUID()}`;
  await panel.getByLabel('Reply', { exact: true }).fill(draft);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/comments'))
      writes += 1;
  });
  stage = 'true offline cached read and unsent draft';
  await editor.setOffline(true);
  await panel.getByText('Stale discussion. Last fetched', { exact: false }).waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Send message', exact: true }).isEnabled(),
    false,
  );
  assert.equal(await panel.getByLabel('Reply', { exact: true }).inputValue(), draft);
  stage = 'missed event repaired by reconnect/focus without draft submission';
  const replyBody = `Synthetic missed reply ${randomUUID()}`;
  const reply = await owner.request.post(
    `${api}${boardPath()}/threads/${initial.thread.id}/comments`,
    {
      headers: { origin: web, 'Idempotency-Key': randomUUID() },
      data: { body: replyBody },
    },
  );
  assert.equal(reply.status(), 201);
  await editor.setOffline(false);
  await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
  await panel.getByText(replyBody, { exact: true }).waitFor();
  assert.equal(await panel.getByLabel('Reply', { exact: true }).inputValue(), draft);
  assert.equal(writes, 0);
  stage = 'downgrade retains draft and removes write authority';
  await setRole('viewer');
  downgraded = true;
  await panel
    .getByText('Discussion is read-only until current editing access is verified.', { exact: true })
    .waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Send message', exact: true }).isEnabled(),
    false,
  );
  assert.equal(await panel.getByLabel('Reply', { exact: true }).inputValue(), draft);
  await setRole('editor');
  downgraded = false;
  stage = 'archive preserves authorized discussion reads and unsent draft';
  await setArchive('archive');
  archived = true;
  await panel.getByText('Archived board: discussion is read-only.', { exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Send message', exact: true }).isEnabled(),
    false,
  );
  await panel.getByText(replyBody, { exact: true }).waitFor();
  assert.equal(writes, 0);
  await setArchive('restore');
  archived = false;
  console.log(
    'PASS: P6-10 offline/reconnect/downgrade/archive lifecycle. Synthetic discussions retained.',
  );
} catch {
  console.error(`FAIL: P6-10 browser stage: ${stage}. Private content and raw errors withheld.`);
  process.exitCode = 1;
} finally {
  try {
    if (archived) await setArchive('restore');
    if (downgraded) await setRole('editor');
  } catch {
    console.error('FAIL: synthetic fixture restoration requires manual owner review.');
    process.exitCode = 1;
  }
  await browser?.close();
}
