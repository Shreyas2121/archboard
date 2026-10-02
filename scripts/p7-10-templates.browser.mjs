// PREPARED ONLY: browser verification is deferred by user. Connected cases also
// wait for all Version 1 implementation. Use an isolated synthetic owner account
// below the board cap and a served production build; never commit storage state.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { TEMPLATE_CHOICES, resolveTemplate } from '../packages/fixtures/dist/index.js';
import { parsePortableJson } from '../packages/export/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
assert.ok(process.env.P7_WEB_ORIGIN && process.env.P7_OWNER_STATE);
const origin = new URL(process.env.P7_WEB_ORIGIN).origin;
let browser;
let stage = 'configuration';
async function recovery(page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local recovery', exact: true }).click();
  const download = await event;
  return parsePortableJson(new Uint8Array(await readFile(await download.path())));
}
async function walkthrough(page, graph) {
  await page.getByRole('tab', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: `Present ${graph.steps[0].title}`, exact: true }).click();
  for (let index = 0; index < graph.steps.length; index++) {
    await page
      .locator('[aria-label="Presentation notes"]')
      .getByText(graph.steps[index].notes, { exact: true })
      .waitFor();
    assert.ok(
      (await page.locator('[aria-label="Presentation controls"]').textContent()).includes(
        `${index + 1}/${graph.steps.length}`,
      ),
    );
    if (index + 1 < graph.steps.length) await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (title) => globalThis.document.activeElement?.getAttribute('aria-label') === `Present ${title}`,
    graph.steps[0].title,
  );
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const local = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const demo = await local.newPage();
  const serverWrites = [];
  demo.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET')
      serverWrites.push(request.method());
  });
  stage = 'isolated demo walkthrough and full local export';
  await demo.goto(`${origin}/demo`);
  const file = await recovery(demo);
  assert.equal(file.syncStatusAtExport, 'local-only');
  assert.equal(file.graph.steps.length, 4);
  assert.deepEqual(
    file.graph.nodes.map((n) => n.title).sort(),
    resolveTemplate('web-application')
      .nodes.map((n) => n.title)
      .sort(),
  );
  await walkthrough(demo, resolveTemplate('web-application'));
  await demo.evaluate(() => navigator.serviceWorker.ready);
  await demo.reload();
  await demo.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await local.setOffline(true);
  await demo.reload();
  await walkthrough(demo, resolveTemplate('web-application'));
  assert.equal((await recovery(demo)).syncStatusAtExport, 'local-only');
  assert.deepEqual(serverWrites, []);
  await local.close();

  const connected = await browser.newContext({
    storageState: process.env.P7_OWNER_STATE,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await connected.newPage();
  for (const choice of [{ id: 'blank', title: 'Blank board' }, ...TEMPLATE_CHOICES]) {
    stage = `create and render ${choice.id}`;
    await page.goto(`${origin}/boards`);
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill(`P7-10 synthetic ${choice.id}`);
    await page.getByLabel('Starting content').click();
    await page.getByRole('option', { name: choice.title, exact: true }).click();
    await connected.setOffline(true);
    await page.waitForFunction(() =>
      [...globalThis.document.querySelectorAll('button')].some(
        (b) => b.textContent === 'Create board' && b.disabled,
      ),
    );
    await connected.setOffline(false);
    const submit = page.getByRole('button', { name: 'Create board', exact: true });
    const posted = [];
    if (choice.id === 'event-processing') {
      await page.route('**/api/v1/boards', async (route) => {
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
    }
    await submit.click();
    if (choice.id === 'event-processing') {
      await page.getByText('Creation is unconfirmed.', { exact: false }).waitFor();
      assert.ok(await page.getByLabel('Starting content').isDisabled());
      await submit.click();
      assert.deepEqual(posted[1], posted[0]);
      await page.unroute('**/api/v1/boards');
    }
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: `P7-10 synthetic ${choice.id}`, exact: true }).click();
    const actual = await recovery(page);
    if (choice.id === 'blank') {
      assert.deepEqual(actual.graph, {
        schemaVersion: 1,
        nodes: [],
        edges: [],
        boundaries: [],
        steps: [],
      });
    } else {
      const source = resolveTemplate(choice.id);
      assert.deepEqual(
        actual.graph.nodes.map((n) => n.title).sort(),
        source.nodes.map((n) => n.title).sort(),
      );
      await page.getByRole('button', { name: 'Fit content', exact: true }).click();
      await page.waitForFunction(() => {
        const canvas = globalThis.document.querySelector('.react-flow')?.getBoundingClientRect();
        const cards = [...globalThis.document.querySelectorAll('.react-flow__node')];
        return (
          canvas &&
          cards.length &&
          cards.every((card) => {
            const rect = card.getBoundingClientRect();
            return (
              rect.left >= canvas.left &&
              rect.top >= canvas.top &&
              rect.right <= canvas.right &&
              rect.bottom <= canvas.bottom
            );
          })
        );
      });
      await walkthrough(page, source);
    }
  }
  stage = 'explicit online import of local demo export';
  await page.goto(`${origin}/boards`);
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await page.getByLabel('JSON file', { exact: true }).setInputFiles({
    name: 'demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByLabel('New board title', { exact: true }).fill('P7-10 explicit demo import');
  await page
    .getByRole('button', { name: 'Create private board from this file', exact: true })
    .click();
  await page.waitForURL((url) => /^\/boards\/[a-f0-9-]{36}$/.test(url.pathname));
  const imported = await recovery(page);
  assert.equal(imported.graph.steps.length, 4);
  assert.ok(imported.graph.nodes.every((n) => !file.graph.nodes.some((old) => old.id === n.id)));
  await connected.close();
  process.stdout.write(
    'PASS: templates/blank, fit geometry, keyboard walkthrough, offline isolated demo and explicit import. Visual text/edge legibility still requires human review.\n',
  );
} catch {
  process.stderr.write(`FAIL: P7-10 ${stage}; no private content recorded.\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
