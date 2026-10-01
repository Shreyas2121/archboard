// PREPARED ONLY. Requires Version 1 implementation completion AND browser resumption.
// Use synthetic owner/viewer/editor sessions and an active board with at least one
// existing step. An archived board readable by the viewer must also contain a step.
// State files stay outside Git. No traces, cookies or board payloads are printed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import * as contracts from '../packages/contracts/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
const required = [
  'P7_WEB_ORIGIN',
  'P7_API_ORIGIN',
  'P7_BOARD_ID',
  'P7_ARCHIVED_BOARD_ID',
  'P7_OWNER_STATE',
  'P7_VIEWER_STATE',
  'P7_EDITOR_STATE',
];
assert.ok(
  required.every((key) => process.env[key]),
  'Synthetic fixture configuration is required.',
);
const web = new URL(process.env.P7_WEB_ORIGIN).origin;
const api = new URL(process.env.P7_API_ORIGIN).origin;
const board = contracts.applicationIdSchema.parse(process.env.P7_BOARD_ID);
const archivedBoard = contracts.applicationIdSchema.parse(process.env.P7_ARCHIVED_BOARD_ID);
const title = `Synthetic step ${randomUUID()}`;
let browser;
let stage = 'configuration';
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = await Promise.all(
    ['P7_OWNER_STATE', 'P7_VIEWER_STATE', 'P7_EDITOR_STATE'].map((key) =>
      browser.newContext({
        storageState: process.env[key],
        viewport: { width: 1440, height: 1000 },
      }),
    ),
  );
  const [owner, viewer] = contexts;
  const identities = await Promise.all(
    contexts.map(
      async (context) =>
        contracts.currentUserResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/me`)).json(),
        ).data.id,
    ),
  );
  assert.equal(new Set(identities).size, contexts.length);
  const views = await Promise.all(
    contexts.map(
      async (context) =>
        contracts.boardDetailResponseSchema.parse(
          await (await context.request.get(`${api}/api/v1/boards/${board}`)).json(),
        ).data,
    ),
  );
  assert.equal(views[0].effectiveRole, 'owner');
  assert.equal(views[1].effectiveRole, 'viewer');
  assert.equal(views[2].effectiveRole, 'editor');
  assert.equal(views[0].archivedAt, null);
  const archive = contracts.boardDetailResponseSchema.parse(
    await (await viewer.request.get(`${api}/api/v1/boards/${archivedBoard}`)).json(),
  ).data;
  assert.notEqual(archive.archivedAt, null);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [authorPage, readerPage, peerPage] = pages;
  await Promise.all(pages.map((page) => page.goto(`${web}/boards/${board}`)));
  stage = 'authoring and viewer denial';
  for (const page of pages) await page.getByRole('tab', { name: 'Steps', exact: true }).click();
  assert.ok(
    await readerPage.getByRole('button', { name: 'Capture new step', exact: true }).isDisabled(),
  );
  await authorPage.getByRole('button', { name: 'Capture new step', exact: true }).click();
  await authorPage.getByLabel('Step title', { exact: true }).fill(title);
  await authorPage.getByLabel('Step notes', { exact: true }).fill('Synthetic notes');
  await readerPage.getByRole('button', { name: `Present ${title}`, exact: true }).click();
  assert.ok(await readerPage.getByText('Synthetic notes', { exact: true }).isVisible());
  stage = 'remote active-step deletion';
  await peerPage.getByRole('button', { name: new RegExp(`\\. ${title}$`) }).click();
  await peerPage.getByRole('button', { name: 'Delete step', exact: true }).click();
  await readerPage
    .getByText('This step was deleted. Choose a remaining step or exit.', { exact: true })
    .waitFor();
  await readerPage.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  stage = 'archived reader playback';
  await readerPage.goto(`${web}/boards/${archivedBoard}`);
  await readerPage.getByRole('tab', { name: 'Steps', exact: true }).click();
  assert.ok(
    await readerPage.getByRole('button', { name: 'Capture new step', exact: true }).isDisabled(),
  );
  await readerPage.getByRole('button', { name: 'Present', exact: true }).click();
  await readerPage.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  stage = 'cached offline authoring and actual reload';
  await authorPage.evaluate(() => navigator.serviceWorker.ready);
  await authorPage.reload();
  await authorPage.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await owner.setOffline(true);
  await authorPage.reload();
  await authorPage.getByRole('tab', { name: 'Steps', exact: true }).click();
  await authorPage.getByRole('button', { name: 'Capture new step', exact: true }).click();
  await authorPage.getByLabel('Step title', { exact: true }).fill(title);
  await authorPage.getByRole('button', { name: `Present ${title}`, exact: true }).click();
  await authorPage.keyboard.press('Escape');
  await authorPage.reload();
  await authorPage.getByRole('tab', { name: 'Steps', exact: true }).click();
  await authorPage.getByRole('button', { name: `Present ${title}`, exact: true }).click();
  await authorPage.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  await owner.setOffline(false);
  await authorPage.getByRole('button', { name: new RegExp(`\\. ${title}$`) }).click();
  await authorPage.getByRole('button', { name: 'Delete step', exact: true }).click();
  for (const context of contexts) await context.close();
  process.stdout.write(
    'PASS: independent board author/viewer, remote deletion, archived playback and cached offline step reload. Highlight deletion/drag/storage-fault matrix remains separate.\n',
  );
} catch {
  process.stderr.write(`FAIL: P7-03 ${stage}; no private content recorded.\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
