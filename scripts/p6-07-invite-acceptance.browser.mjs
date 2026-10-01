// PREPARED ONLY: execution requires user resumption of browser verification and completion
// of all Version 1 implementation for the database-backed session/mutation boundaries.
// Supply synthetic owner/two-recipient storage states outside the repository and an active
// synthetic board owned by that owner. No traces, screenshots or storage-state exports.
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
  'P6_RECIPIENT_ONE_STATE',
  'P6_RECIPIENT_TWO_STATE',
];
let stage = 'configuration';
let browser;
try {
  assert.ok(
    required.every((key) => process.env[key]),
    'Required synthetic test configuration is missing.',
  );
  const web = new URL(process.env.P6_WEB_ORIGIN).origin;
  const api = new URL(process.env.P6_API_ORIGIN).origin;
  const boardId = contracts.applicationIdSchema.parse(process.env.P6_BOARD_ID);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = await Promise.all(
    [
      process.env.P6_OWNER_STATE,
      process.env.P6_RECIPIENT_ONE_STATE,
      process.env.P6_RECIPIENT_TWO_STATE,
    ].map((storageState) => browser.newContext({ storageState })),
  );
  const [owner, first, second] = contexts;
  const request = (context, path, body) =>
    context.request.post(`${api}/api/v1${path}`, { headers: { origin: web }, data: body });
  stage = 'independent synthetic identities';
  const ids = await Promise.all(
    contexts.map(async (context) => {
      const response = await context.request.get(`${api}/api/v1/me`);
      assert.ok(response.status() === 200, 'Synthetic session is unavailable.');
      return contracts.currentUserResponseSchema.parse(await response.json()).data.id;
    }),
  );
  assert.ok(new Set(ids).size === 3, 'Independent actors are required.');
  const board = contracts.boardDetailResponseSchema.parse(
    await (await owner.request.get(`${api}/api/v1/boards/${boardId}`)).json(),
  ).data;
  assert.ok(
    board.owner.id === ids[0] && !board.archivedAt,
    'An active synthetic owner board is required.',
  );
  const create = async () => {
    const response = await owner.request.post(`${api}/api/v1/boards/${boardId}/invites`, {
      headers: { origin: web, 'Idempotency-Key': randomUUID() },
      data: { role: 'viewer' },
    });
    assert.ok(response.status() === 201, 'Synthetic invite creation failed.');
    const result = contracts.boardInviteResponseSchema.parse(await response.json()).data;
    const url = new URL(result.inviteUrl);
    assert.ok(url.origin === web, 'Invite origin differs from the served build.');
    return { id: result.id, url: url.toString(), token: url.pathname.split('/').at(-1) };
  };
  const invite = await create();
  const messages = [];
  const requests = [];
  stage = 'signed-out privacy';
  const anonymous = await browser.newContext();
  const signedOut = await anonymous.newPage();
  let anonymousPreview = false;
  signedOut.on('request', (entry) => {
    if (entry.url().endsWith('/invites/preview')) anonymousPreview = true;
  });
  const documentResponse = await signedOut.goto(invite.url);
  assert.ok(
    documentResponse.headers()['referrer-policy'] === 'no-referrer',
    'Invite document referrer header is missing.',
  );
  assert.ok(
    documentResponse.headers()['cache-control']?.includes('no-store'),
    'Invite document must be served with no-store.',
  );
  await signedOut.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor();
  assert.ok(!anonymousPreview, 'Signed-out preview request was sent.');
  assert.ok(
    !(await signedOut.locator('body').innerText()).includes(board.title),
    'Signed-out document reveals the board title.',
  );
  stage = 'direct navigation, reload and explicit acceptance';
  const pages = await Promise.all([first.newPage(), second.newPage()]);
  for (const page of pages) {
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', (error) => messages.push(error.message));
    page.on('request', (entry) =>
      requests.push({ url: entry.url(), referrer: entry.headers().referer ?? '' }),
    );
    await page.goto(invite.url);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).waitFor();
  }
  stage = 'two-account acceptance race';
  await Promise.all(
    pages.map((page) =>
      page.getByRole('button', { name: 'Accept invitation', exact: true }).click(),
    ),
  );
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        () =>
          globalThis.window.location.pathname.startsWith('/boards/') ||
          globalThis.document.body.textContent.includes('Invitation already used'),
      ),
    ),
  );
  const winners = pages
    .map((page, index) => (page.url().includes(`/boards/${boardId}`) ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(winners.length === 1, 'Race must produce one accepting account.');
  const winner = winners[0];
  const retry = await request(contexts[winner + 1], '/invites/accept', { token: invite.token });
  assert.ok(retry.status() === 200, 'Recorded accepting account could not retry.');
  const loser = await request(contexts[1 - winner + 1], '/invites/accept', { token: invite.token });
  assert.ok(loser.status() === 409, 'Other account must see exhaustion.');
  stage = 'preview then revocation';
  const revoked = await create();
  const reader = pages[1 - winner];
  await reader.goto(revoked.url);
  await reader.getByRole('button', { name: 'Accept invitation', exact: true }).waitFor();
  const revocation = await owner.request.delete(
    `${api}/api/v1/boards/${boardId}/invites/${revoked.id}`,
    { headers: { origin: web } },
  );
  assert.ok(revocation.status() === 204, 'Revocation failed.');
  await reader.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await reader.getByRole('heading', { name: 'Invitation unavailable', exact: true }).waitFor();
  stage = 'actual service-worker caches and referrers';
  await reader.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await reader.reload();
  assert.ok(
    await reader.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    'Runtime cache inspection requires an active controlling worker.',
  );
  const surfaces = await reader.evaluate(async () => ({
    cacheUrls: (
      await Promise.all(
        (await globalThis.caches.keys()).map(async (name) =>
          (await (await globalThis.caches.open(name)).keys()).map((entry) => entry.url),
        ),
      )
    ).flat(),
    storage: [
      JSON.stringify(Object.entries(localStorage)),
      JSON.stringify(Object.entries(sessionStorage)),
    ],
  }));
  assert.ok(
    surfaces.cacheUrls.every((url) => !/\/invites?(?:\/|$)/.test(new URL(url).pathname)),
    'An invitation URL entered Cache Storage.',
  );
  assert.ok(
    surfaces.storage.every(
      (value) => !value.includes(invite.token) && !value.includes(revoked.token),
    ),
    'Bearer token entered browser storage.',
  );
  assert.ok(
    requests.every(
      ({ referrer }) => !referrer.includes(invite.token) && !referrer.includes(revoked.token),
    ),
    'Bearer token entered a referrer.',
  );
  assert.ok(
    requests.every(({ url }) => [web, api].includes(new URL(url).origin)),
    'Invite document loaded a third-party resource.',
  );
  assert.ok(
    messages.every((value) => !value.includes(invite.token) && !value.includes(revoked.token)),
    'Bearer token entered console diagnostics.',
  );
  console.info(
    'PASS P6-07 prepared browser cases: signed-out privacy, direct reload, two-account race/retry, preview/revoke, runtime cache/referrer checks.',
  );
} catch {
  // Playwright and assertions can include raw URLs, cookies or response bodies. Never serialize them.
  console.error(`FAIL P6-07 prepared browser harness at ${stage}. Private diagnostics omitted.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
