// PREPARED ONLY: browser resumption and complete Version 1 implementation are required.
// Independent synthetic owner/editor/viewer on a disposable active board. No raw diagnostics.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import * as contracts from '../packages/contracts/dist/index.js';
const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
let browser;
let stage = 'configuration';
try {
  const required = [
    'P6_WEB_ORIGIN',
    'P6_API_ORIGIN',
    'P6_BOARD_ID',
    'P6_OWNER_STATE',
    'P6_EDITOR_STATE',
    'P6_VIEWER_STATE',
  ];
  assert.ok(required.every((key) => process.env[key]));
  const web = new URL(process.env.P6_WEB_ORIGIN).origin;
  const api = new URL(process.env.P6_API_ORIGIN).origin;
  const boardId = contracts.applicationIdSchema.parse(process.env.P6_BOARD_ID);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = await Promise.all(
    ['P6_OWNER_STATE', 'P6_EDITOR_STATE', 'P6_VIEWER_STATE'].map((key) =>
      browser.newContext({
        storageState: process.env[key],
        viewport: { width: 1440, height: 1000 },
      }),
    ),
  );
  const identities = await Promise.all(
    contexts.map(
      async (context) =>
        contracts.currentUserResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/me`)).json(),
        ).data,
    ),
  );
  assert.equal(new Set(identities.map(({ id }) => id)).size, 3);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const [index, page] of pages.entries()) {
    const board = contracts.boardDetailResponseSchema.parse(
      await (await contexts[index].request.get(`${api}/api/v1/boards/${boardId}`)).json(),
    ).data;
    assert.equal(board.effectiveRole, ['owner', 'editor', 'viewer'][index]);
    assert.equal(board.archivedAt, null);
    await page.goto(`${web}/boards/${boardId}`);
    const trigger = page.getByRole('button', { name: 'Share board', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Share board', exact: true });
    await dialog.getByRole('list', { name: 'Board members', exact: true }).waitFor();
    stage = 'keyboard share dialog and role negatives';
    if (index > 0) {
      assert.equal(await dialog.getByRole('combobox', { name: /^Role for / }).count(), 0);
      assert.equal(
        await dialog.getByRole('button', { name: 'Create invitation', exact: true }).count(),
        0,
      );
      assert.equal(
        await dialog.getByRole('button', { name: /^Remove .* from this board$/ }).count(),
        0,
      );
    } else {
      assert.equal(
        await dialog.getByRole('button', { name: 'Leave board', exact: true }).count(),
        0,
      );
      assert.equal(
        await dialog
          .getByRole('combobox', { name: `Role for ${identities[0].name}`, exact: true })
          .count(),
        0,
      );
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      await trigger.evaluate((element) => element === globalThis.document.activeElement),
      true,
    );
  }
  const [ownerPage] = pages;
  stage = 'one-time invitation result and revocation';
  await ownerPage.getByRole('button', { name: 'Share board', exact: true }).click();
  const sharing = ownerPage.getByRole('dialog', { name: 'Share board', exact: true });
  const response = ownerPage.waitForResponse(
    (entry) =>
      entry.request().method() === 'POST' && new URL(entry.url()).pathname.endsWith('/invites'),
  );
  await sharing.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const issued = contracts.boardInviteResponseSchema.parse(await (await response).json()).data;
  const token = new URL(issued.inviteUrl).pathname.split('/').at(-1);
  await sharing.locator('#fresh-invite-link').waitFor();
  assert.equal(await sharing.locator('#fresh-invite-link').inputValue(), issued.inviteUrl);
  await sharing
    .getByRole('button', { name: 'Done reviewing this result (discard link)', exact: true })
    .click();
  assert.equal(await sharing.locator('#fresh-invite-link').count(), 0);
  const metadata = sharing
    .getByRole('list', { name: 'Invitation metadata', exact: true })
    .locator('li')
    .filter({ hasText: identities[0].name })
    .filter({ hasText: 'Active (last fetched)' });
  // Fresh disposable fixtures may contain other invitations; identify the exact issued ID
  // through the DELETE request while checking the first row is the newest result.
  await metadata.first().getByRole('button', { name: 'Revoke invitation', exact: true }).click();
  const revoke = ownerPage.waitForResponse(
    (entry) =>
      entry.request().method() === 'DELETE' &&
      new URL(entry.url()).pathname.endsWith(`/invites/${issued.id}`),
  );
  await metadata.first().getByRole('button', { name: 'Confirm revoke', exact: true }).click();
  assert.equal((await revoke).status(), 204);
  const storage = await ownerPage.evaluate(() =>
    JSON.stringify([
      Object.entries(globalThis.localStorage),
      Object.entries(globalThis.sessionStorage),
    ]),
  );
  assert.equal(storage.includes(token), false);
  await ownerPage.keyboard.press('Escape');
  stage = 'plain-text discussion and no link/script execution';
  const inert = `<img src="https://example.invalid/p6" onerror="globalThis.p6Executed=true"> https://example.invalid/${randomUUID()}`;
  const seeded = await contexts[0].request.post(`${api}/api/v1/boards/${boardId}/threads`, {
    headers: { origin: web, 'Idempotency-Key': randomUUID() },
    data: { anchor: { type: 'point', position: { x: 77, y: 99 } }, body: inert },
  });
  assert.equal(seeded.status(), 201);
  const created = contracts.threadCreateResponseSchema.parse(await seeded.json()).data;
  const viewerPage = pages[2];
  let externalFetch = false;
  viewerPage.on('request', (request) => {
    if (new URL(request.url()).hostname === 'example.invalid') externalFetch = true;
  });
  await viewerPage.getByRole('tab', { name: 'Discussion', exact: true }).click();
  const panel = viewerPage.getByRole('region', { name: 'Board discussion', exact: true });
  await panel
    .locator(`[data-thread-id="${created.thread.id}"]`)
    .getByRole('button', { name: /Point .*Unresolved$/ })
    .click();
  await panel
    .locator(`[data-comment-id="${created.comment.id}"]`)
    .getByText(inert, { exact: true })
    .waitFor();
  assert.equal(await panel.locator('img[src*="example.invalid"]').count(), 0);
  assert.equal(await viewerPage.evaluate(() => globalThis.p6Executed === true), false);
  assert.equal(externalFetch, false);
  console.log(
    'PASS P6-11 prepared sharing keyboard/role/invite/plain-text security cases. Synthetic fixture rows retained.',
  );
} catch {
  console.error(`FAIL P6-11 browser stage: ${stage}. Private diagnostics withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
