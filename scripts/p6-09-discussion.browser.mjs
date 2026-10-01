// PREPARED ONLY: browser execution is deferred; real sessions/mutations also require
// completion of all Version 1 implementation. Use independent synthetic owner,
// author editor, other editor and viewer states on one active fixture board.
// No traces, storage-state exports, screenshots or private error output.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as contracts from '../packages/contracts/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
const required = [
  'P6_WEB_ORIGIN',
  'P6_API_ORIGIN',
  'P6_BOARD_ID',
  'P6_OWNER_STATE',
  'P6_EDITOR_STATE',
  'P6_OTHER_EDITOR_STATE',
  'P6_VIEWER_STATE',
];
let browser;
let stage = 'configuration';
try {
  assert.ok(required.every((name) => process.env[name]));
  const web = new URL(process.env.P6_WEB_ORIGIN).origin;
  const api = new URL(process.env.P6_API_ORIGIN).origin;
  const boardId = contracts.applicationIdSchema.parse(process.env.P6_BOARD_ID);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = await Promise.all(
    ['P6_OWNER_STATE', 'P6_EDITOR_STATE', 'P6_OTHER_EDITOR_STATE', 'P6_VIEWER_STATE'].map((name) =>
      browser.newContext({
        storageState: process.env[name],
        viewport: { width: 1440, height: 1000 },
      }),
    ),
  );
  const [owner, editor, , viewer] = contexts;
  const identities = await Promise.all(
    contexts.map(
      async (context) =>
        contracts.currentUserResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/me`)).json(),
        ).data,
    ),
  );
  assert.equal(new Set(identities.map(({ id }) => id)).size, 4);
  for (const [index, role] of ['owner', 'editor', 'editor', 'viewer'].entries()) {
    const board = contracts.boardDetailResponseSchema.parse(
      await (await contexts[index].request.get(`${api}/api/v1/boards/${boardId}`)).json(),
    ).data;
    assert.equal(board.effectiveRole, role);
    assert.equal(board.archivedAt, null);
  }
  const seed = await editor.request.post(`${api}/api/v1/boards/${boardId}/threads`, {
    headers: { origin: web, 'Idempotency-Key': randomUUID() },
    data: {
      anchor: { type: 'point', position: { x: -250, y: 450 } },
      body: `Synthetic original ${randomUUID()}`,
    },
  });
  assert.equal(seed.status(), 201);
  const initial = contracts.threadCreateResponseSchema.parse(await seed.json()).data;
  const ownerReplyResponse = await owner.request.post(
    `${api}/api/v1/boards/${boardId}/threads/${initial.thread.id}/comments`,
    {
      headers: { origin: web, 'Idempotency-Key': randomUUID() },
      data: { body: `Synthetic owner message ${randomUUID()}` },
    },
  );
  assert.equal(ownerReplyResponse.status(), 201);
  const ownerReply = contracts.commentResponseSchema.parse(await ownerReplyResponse.json()).data;
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [ownerPage, editorPage, otherPage, viewerPage] = pages;
  const panel = (page) => page.getByRole('region', { name: 'Board discussion', exact: true });
  const summary = (page) => panel(page).locator(`[data-thread-id="${initial.thread.id}"]`);
  const message = (page, id = initial.comment.id) =>
    panel(page).locator(`[data-comment-id="${id}"]`);
  for (const page of pages) {
    await page.goto(`${web}/boards/${boardId}`);
    await page.getByRole('tab', { name: 'Discussion', exact: true }).click();
    await summary(page)
      .getByRole('button', { name: /Point .*Unresolved$/ })
      .click();
    await message(page).getByText(initial.comment.body, { exact: true }).waitFor();
  }
  stage = 'own/other/owner/viewer rendered action matrix';
  await message(editorPage).getByRole('button', { name: 'Edit message', exact: true }).waitFor();
  await message(ownerPage).getByRole('button', { name: 'Edit message', exact: true }).waitFor();
  await panel(otherPage)
    .getByRole('button', { name: 'Discuss viewport center', exact: true })
    .waitFor();
  assert.equal(
    await message(editorPage, ownerReply.id)
      .getByRole('button', { name: 'Edit message', exact: true })
      .count(),
    0,
  );
  for (const page of [otherPage, viewerPage]) {
    assert.equal(
      await message(page).getByRole('button', { name: 'Edit message', exact: true }).count(),
      0,
    );
    assert.equal(
      await message(page).getByRole('button', { name: 'Delete message', exact: true }).count(),
      0,
    );
  }
  assert.equal(
    await summary(viewerPage)
      .getByRole('button', { name: 'Resolve discussion', exact: true })
      .count(),
    0,
  );
  stage = 'A20 stale edit keeps newer content and unsent text';
  await message(editorPage).getByRole('button', { name: 'Edit message', exact: true }).click();
  const editDialog = editorPage.getByRole('dialog', { name: 'Edit message', exact: true });
  const unsent = `Synthetic retained edit ${randomUUID()}`;
  await editDialog.getByLabel('Unsent edit', { exact: true }).fill(unsent);
  await message(ownerPage).getByRole('button', { name: 'Edit message', exact: true }).click();
  const ownerDialog = ownerPage.getByRole('dialog', { name: 'Edit message', exact: true });
  const winner = `Synthetic winning edit ${randomUUID()}`;
  await ownerDialog.getByLabel('Unsent edit', { exact: true }).fill(winner);
  const winningResponse = ownerPage.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/comments/${initial.comment.id}`),
  );
  await ownerDialog.getByRole('button', { name: 'Save edit', exact: true }).click();
  assert.equal((await winningResponse).status(), 200);
  const staleResponse = editorPage.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/comments/${initial.comment.id}`),
  );
  await editDialog.getByRole('button', { name: 'Save edit', exact: true }).click();
  assert.equal((await staleResponse).status(), 409);
  await editDialog
    .getByRole('region', { name: 'Current server content', exact: true })
    .getByText(winner, { exact: true })
    .waitFor();
  assert.equal(await editDialog.getByLabel('Unsent edit', { exact: true }).inputValue(), unsent);
  await message(viewerPage).getByText(winner, { exact: true }).waitFor();
  const readMessages = async () =>
    contracts.commentListResponseSchema.parse(
      await (
        await viewer.request.get(
          `${api}/api/v1/boards/${boardId}/threads/${initial.thread.id}/comments`,
        )
      ).json(),
    ).data;
  let current = (await readMessages()).find(({ id }) => id === initial.comment.id);
  assert.equal(current.body, winner);
  assert.equal(current.version, 2);
  assert.equal(current.author.id, identities[1].id);
  assert.ok(current.editedAt);
  await editDialog.getByRole('button', { name: 'Cancel and retain draft', exact: true }).click();
  await message(editorPage).getByRole('button', { name: 'Edit message', exact: true }).click();
  assert.equal(await editDialog.getByLabel('Unsent edit', { exact: true }).inputValue(), unsent);
  const repeatedConflict = editorPage.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/comments/${initial.comment.id}`),
  );
  await editDialog.getByRole('button', { name: 'Save edit', exact: true }).click();
  assert.equal((await repeatedConflict).status(), 409);
  const reviewedResponse = editorPage.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/comments/${initial.comment.id}`),
  );
  await editDialog
    .getByRole('button', { name: 'Retry after review against version 2', exact: true })
    .click();
  assert.equal((await reviewedResponse).status(), 200);
  await message(viewerPage).getByText(unsent, { exact: true }).waitFor();
  current = (await readMessages()).find(({ id }) => id === initial.comment.id);
  assert.equal(current.version, 3);
  assert.equal(current.body, unsent);
  assert.equal(current.author.id, identities[1].id);
  stage = 'owner deletion keeps original author and marker with no resurrection controls';
  await message(ownerPage).getByText(unsent, { exact: true }).waitFor();
  await message(ownerPage).getByRole('button', { name: 'Delete message', exact: true }).click();
  const deleteDialog = ownerPage.getByRole('dialog', { name: 'Delete message', exact: true });
  await deleteDialog.getByText(/Deletion leaves a permanent message marker/).waitFor();
  await deleteDialog.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await message(viewerPage).getByText(contracts.COMMENT_DELETION_MARKER, { exact: true }).waitFor();
  await message(ownerPage).getByText(contracts.COMMENT_DELETION_MARKER, { exact: true }).waitFor();
  assert.equal(
    await message(ownerPage).getByRole('button', { name: 'Edit message', exact: true }).count(),
    0,
  );
  current = (await readMessages()).find(({ id }) => id === initial.comment.id);
  assert.equal(current.author.id, identities[1].id);
  assert.ok(current.deletedAt);
  assert.equal(current.version, 4);
  stage = 'resolve/reopen confirmation and refreshed reader filters';
  await summary(ownerPage).getByRole('button', { name: 'Resolve discussion', exact: true }).click();
  await ownerPage
    .getByRole('dialog', { name: 'Resolve discussion', exact: true })
    .getByRole('button', { name: 'Confirm state change', exact: true })
    .click();
  await panel(viewerPage).getByRole('tab', { name: 'Resolved', exact: true }).click();
  await summary(viewerPage)
    .getByText(/Resolved by/)
    .waitFor();
  await panel(ownerPage).getByRole('tab', { name: 'Resolved', exact: true }).click();
  await summary(ownerPage).getByRole('button', { name: 'Reopen discussion', exact: true }).click();
  await ownerPage
    .getByRole('dialog', { name: 'Reopen discussion', exact: true })
    .getByRole('button', { name: 'Confirm state change', exact: true })
    .click();
  await panel(viewerPage).getByRole('tab', { name: 'Unresolved', exact: true }).click();
  await summary(viewerPage)
    .getByRole('button', { name: /Point .*Unresolved$/ })
    .waitFor();
  stage = 'lost creation response, retained key, expiry inspection, deliberate new submission';
  const creationPage = await editor.newPage();
  await creationPage.clock.install();
  await creationPage.goto(`${web}/boards/${boardId}`);
  await creationPage.getByRole('tab', { name: 'Discussion', exact: true }).click();
  const creationPanel = panel(creationPage);
  const keys = [];
  const createUrl = `${api}/api/v1/boards/${boardId}/threads`;
  creationPage.on('request', (request) => {
    if (request.url() === createUrl && request.method() === 'POST')
      keys.push(request.headers()['idempotency-key']);
  });
  await creationPage.route(createUrl, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await route.abort();
  });
  await creationPanel.getByRole('button', { name: 'Discuss viewport center', exact: true }).click();
  const lostBody = `Synthetic lost response ${randomUUID()}`;
  await creationPanel.getByLabel('First message', { exact: true }).fill(lostBody);
  await creationPanel.getByRole('button', { name: 'Send message', exact: true }).click();
  await creationPanel
    .getByRole('button', { name: 'Retry identical unsent message', exact: true })
    .waitFor();
  assert.equal(
    await creationPanel.getByLabel('First message', { exact: true }).inputValue(),
    lostBody,
  );
  assert.ok(await creationPanel.getByLabel('First message', { exact: true }).isDisabled());
  const now = await creationPage.evaluate(() => Date.now());
  await creationPage.clock.setSystemTime(now + 82_920_000);
  await creationPanel
    .getByRole('button', { name: 'Review unconfirmed creation', exact: true })
    .click();
  const recovery = creationPage.getByRole('dialog', {
    name: 'Review unconfirmed creation',
    exact: true,
  });
  const restart = recovery.getByRole('button', {
    name: 'I reviewed results; allow a new submission',
    exact: true,
  });
  assert.ok(await restart.isDisabled());
  await recovery.getByRole('button', { name: 'Inspect visible results', exact: true }).click();
  await recovery
    .getByRole('region', { name: 'Matching visible messages', exact: true })
    .getByText(lostBody, { exact: true })
    .waitFor();
  await restart.click();
  assert.equal(keys.length, 1);
  await creationPage.unroute(createUrl);
  await creationPanel
    .getByLabel('First message', { exact: true })
    .fill(`Synthetic deliberate replacement ${randomUUID()}`);
  await creationPanel.getByRole('button', { name: 'Send message', exact: true }).click();
  await creationPanel
    .getByRole('status')
    .filter({ hasText: /^Message sent\.$/ })
    .waitFor();
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  console.log(
    'PASS: prepared P6-09 A20/moderation/creation-recovery browser cases. Synthetic fixture rows retained.',
  );
} catch {
  console.error(`FAIL: P6-09 browser stage: ${stage}. Private content and raw errors withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
