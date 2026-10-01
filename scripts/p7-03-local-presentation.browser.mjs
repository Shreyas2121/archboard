// PREPARED ONLY — browser execution is deferred by user. Run against a served production
// web build after browser verification resumes. This demo suite is database-free;
// board role/archive/cached-authority and remote deletion need the separate evidence matrix.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
assert.ok(process.env.P7_WEB_ORIGIN, 'Set P7_WEB_ORIGIN to the served production build.');
const origin = new URL(process.env.P7_WEB_ORIGIN).origin;
let browser;
let stage = 'configuration';
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  stage = 'local demo authoring';
  await page.goto(`${origin}/demo`);
  await page.getByRole('tab', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: 'Capture new step', exact: true }).click();
  await page.getByLabel('Step title', { exact: true }).fill('Synthetic walkthrough');
  await page.getByLabel('Step notes', { exact: true }).fill('Synthetic plain-text notes');
  await page.getByRole('button', { name: 'Recapture visible rectangle' }).click();
  await page.getByRole('button', { name: 'Replace highlights with selection' }).click();
  await page
    .getByRole('button', { name: 'Move Synthetic walkthrough earlier', exact: true })
    .click();
  await page.getByRole('button', { name: 'Present Synthetic walkthrough', exact: true }).click();
  stage = 'keyboard playback and focus';
  assert.ok(
    await page
      .getByRole('button', { name: 'Exit presentation', exact: true })
      .evaluate((element) => element === globalThis.document.activeElement),
  );
  assert.ok(await page.getByText('Synthetic plain-text notes', { exact: true }).isVisible());
  assert.equal(
    await page
      .getByRole('button', { name: 'Capture new step', exact: true, includeHidden: true })
      .isVisible(),
    false,
  );
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () =>
      globalThis.document.activeElement?.getAttribute('aria-label') ===
      'Present Synthetic walkthrough',
  );
  stage = 'actual offline reload';
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('tab', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: 'Present Synthetic walkthrough', exact: true }).click();
  assert.ok(await page.getByText('Synthetic plain-text notes', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  await context.close();
  process.stdout.write(
    'PASS: local demo authoring, keyboard playback/focus, and offline reload. Board authority/remote deletion remains separate.\n',
  );
} catch {
  process.stderr.write(`FAIL: P7-03 ${stage}; no private content recorded.\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
