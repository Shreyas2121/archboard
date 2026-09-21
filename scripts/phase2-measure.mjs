/* global document, indexedDB, requestAnimationFrame, window */

import { spawn, spawnSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from '../packages/sync-client/node_modules/playwright/index.mjs';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const webDirectory = fileURLToPath(new URL('../apps/web/', import.meta.url));
const viteCli = fileURLToPath(
  new URL('../apps/web/node_modules/vite/bin/vite.js', import.meta.url),
);
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('phase2:measure must be invoked through pnpm.');

const OPEN_SAMPLE_COUNT = 5;
const POINTER_MOVE_STEPS = 120;
const INTERACTIVE_BUDGET_MS = 2_000;
const FRAME_P95_BUDGET_MS = 32;
const EXPECTED_NODES = 200;
const EXPECTED_EDGES = 400;
const EXPECTED_BOUNDARIES = 20;
const EXPECTED_STEPS = 20;
const productionEnvironment = {
  ...process.env,
  VITE_API_ORIGIN: 'https://api.archboard.local',
  VITE_WS_ORIGIN: 'wss://api.archboard.local',
};

function runBuild() {
  process.stdout.write('Phase 2 measurement: building the production workspace\n');
  const result = spawnSync(packageManagerScript, ['build'], {
    cwd: workspace,
    env: productionEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Production build failed: ${result.status}.`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No preview port.');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForPreview(origin, processHandle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error('Production preview exited early.');
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The preview process has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Production preview did not become ready.');
}

function percentile(values, quantile) {
  if (values.length === 0) throw new Error('No performance samples were captured.');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}

async function seedCachedFixture(page, updateBytes) {
  await page.evaluate(
    async (bytes) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('archboard-sync-client');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const namespace = await new Promise((resolve, reject) => {
          const transaction = database.transaction('localSnapshots', 'readonly');
          const request = transaction.objectStore('localSnapshots').getAllKeys();
          request.onsuccess = () => resolve(request.result[0]);
          request.onerror = () => reject(request.error);
        });
        if (typeof namespace !== 'string')
          throw new Error('The demo namespace was not initialized.');
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(
            ['localSnapshots', 'localUpdates', 'outbox', 'boardCache'],
            'readwrite',
          );
          for (const name of ['localSnapshots', 'localUpdates', 'outbox', 'boardCache']) {
            transaction.objectStore(name).clear();
          }
          transaction.objectStore('localSnapshots').put({
            namespace,
            throughLocalSequence: 0,
            updateBytes: Uint8Array.from(bytes),
            updatedAt: new Date().toISOString(),
          });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    [...updateBytes],
  );
}

async function localUpdateCount(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('archboard-sync-client');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction('localUpdates', 'readonly')
          .objectStore('localUpdates')
          .count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function captureFrameIntervals(page, pointerGesture) {
  await page.evaluate(() => {
    window.__archboardFrameIntervals = [];
    window.__archboardFrameSampling = true;
    let previous = null;
    const sample = (timestamp) => {
      if (!window.__archboardFrameSampling) return;
      if (previous !== null) window.__archboardFrameIntervals.push(timestamp - previous);
      previous = timestamp;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await pointerGesture();
  return page.evaluate(() => {
    window.__archboardFrameSampling = false;
    return window.__archboardFrameIntervals;
  });
}

runBuild();
const [{ createTypicalGraphFixture }, { hydrateGraphDocument }, Y] = await Promise.all([
  import('../packages/fixtures/dist/index.js'),
  import('../packages/document-model/dist/schema/hydrate.js'),
  import('../packages/document-model/node_modules/yjs/dist/yjs.mjs'),
]);
const graph = createTypicalGraphFixture();
if (
  graph.nodes.length !== EXPECTED_NODES ||
  graph.edges.length !== EXPECTED_EDGES ||
  graph.boundaries.length !== EXPECTED_BOUNDARIES ||
  graph.steps.length !== EXPECTED_STEPS
) {
  throw new Error('The named typical fixture counts changed unexpectedly.');
}
const updateBytes = Y.encodeStateAsUpdate(hydrateGraphDocument(graph));
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const preview = spawn(
  process.execPath,
  [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    cwd: webDirectory,
    env: productionEnvironment,
    stdio: 'ignore',
    windowsHide: true,
  },
);
let browser;
try {
  await waitForPreview(origin, preview);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const bootstrap = await context.newPage();
  await bootstrap.goto(`${origin}/demo`);
  await bootstrap.locator('[data-phase="saved"]').waitFor();
  await bootstrap.close();
  const seedPage = await context.newPage();
  await seedPage.goto(origin);
  await seedCachedFixture(seedPage, updateBytes);
  await seedPage.close();

  const openSamples = [];
  let gesturePage;
  for (let sample = 0; sample < OPEN_SAMPLE_COUNT; sample += 1) {
    const page = await context.newPage();
    await page.addInitScript(
      (counts) => {
        const inspect = () => {
          if (window.__archboardInteractiveAt !== undefined) return;
          if (
            document.querySelector('[data-phase="saved"]') &&
            document.querySelectorAll('.react-flow__node').length >= counts.nodes &&
            document.querySelectorAll('.react-flow__edge').length >= counts.edges
          ) {
            requestAnimationFrame(() => {
              window.__archboardInteractiveAt = performance.now();
            });
          } else {
            requestAnimationFrame(inspect);
          }
        };
        requestAnimationFrame(inspect);
      },
      { nodes: EXPECTED_NODES, edges: EXPECTED_EDGES },
    );
    await page.goto(`${origin}/demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__archboardInteractiveAt !== undefined);
    openSamples.push(await page.evaluate(() => window.__archboardInteractiveAt));
    if (sample === OPEN_SAMPLE_COUNT - 1) gesturePage = page;
    else await page.close();
  }

  const pane = gesturePage.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('The rendered canvas pane has no bounding box.');
  const panX = paneBox.x + paneBox.width * 0.8;
  const panY = paneBox.y + paneBox.height * 0.8;
  const updatesBeforePan = await localUpdateCount(gesturePage);
  const panFrames = await captureFrameIntervals(gesturePage, async () => {
    await gesturePage.mouse.move(panX, panY);
    await gesturePage.mouse.down({ button: 'middle' });
    await gesturePage.mouse.move(panX - 240, panY - 120, { steps: POINTER_MOVE_STEPS });
    await gesturePage.mouse.up({ button: 'middle' });
  });
  const updatesAfterPan = await localUpdateCount(gesturePage);
  if (updatesAfterPan !== updatesBeforePan)
    throw new Error('Panning created durable graph updates.');

  await gesturePage.getByRole('button', { name: 'Fit content' }).click();
  await gesturePage.waitForTimeout(500);
  let firstNode;
  let nodeBox;
  for (const node of graph.nodes.filter(({ kind }) => kind === 'component')) {
    const candidate = gesturePage.locator(`.react-flow__node[data-id="${node.id}"]`);
    const box = await candidate.boundingBox();
    if (
      box &&
      box.x > paneBox.x + 20 &&
      box.y > paneBox.y + 20 &&
      box.x + box.width < paneBox.x + paneBox.width - 20 &&
      box.y + box.height < paneBox.y + paneBox.height - 20
    ) {
      firstNode = candidate;
      nodeBox = box;
      break;
    }
  }
  if (!firstNode || !nodeBox)
    throw new Error('No fully visible component card was found for drag.');
  const dragX = nodeBox.x + nodeBox.width / 2;
  const dragY = nodeBox.y + Math.min(nodeBox.height / 2, 35);
  const updatesBeforeDrag = await localUpdateCount(gesturePage);
  const dragFrames = await captureFrameIntervals(gesturePage, async () => {
    await gesturePage.mouse.move(dragX, dragY);
    await gesturePage.mouse.down();
    await gesturePage.mouse.move(dragX + 160, dragY + 80, { steps: POINTER_MOVE_STEPS });
    await gesturePage.mouse.up();
  });
  await gesturePage.locator('[data-phase="saved"]').waitFor();
  const updatesAfterDrag = await localUpdateCount(gesturePage);
  if (updatesAfterDrag - updatesBeforeDrag !== 1) {
    process.stderr.write(
      `${JSON.stringify({ nodeBox, dragX, dragY, panFrames: panFrames.length, dragFrames: dragFrames.length, nodeClass: await firstNode.getAttribute('class'), nodeStyle: await firstNode.getAttribute('style'), phase: await gesturePage.locator('[data-phase]').first().getAttribute('data-phase') })}\n`,
    );
    throw new Error(
      `Completed drag wrote ${updatesAfterDrag - updatesBeforeDrag} durable updates, expected one.`,
    );
  }

  const result = {
    environment: {
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? 'unavailable',
      logicalProcessors: cpus().length,
      memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
      browser: `Google Chrome ${browser.version()}`,
      mode: 'Vite production build, local preview, headless Chrome',
    },
    fixture: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      boundaries: graph.boundaries.length,
      steps: graph.steps.length,
      encodedBytes: updateBytes.byteLength,
    },
    opening: {
      samplesMs: openSamples.map((value) => Number(value.toFixed(2))),
      medianMs: Number(percentile(openSamples, 0.5).toFixed(2)),
      maxMs: Number(Math.max(...openSamples).toFixed(2)),
      targetMs: INTERACTIVE_BUDGET_MS,
    },
    pan: {
      frames: panFrames.length,
      p95Ms: Number(percentile(panFrames, 0.95).toFixed(2)),
      durableUpdates: updatesAfterPan - updatesBeforePan,
    },
    drag: {
      frames: dragFrames.length,
      p95Ms: Number(percentile(dragFrames, 0.95).toFixed(2)),
      durableUpdates: updatesAfterDrag - updatesBeforeDrag,
    },
    frameTargetMs: FRAME_P95_BUDGET_MS,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    result.opening.maxMs > INTERACTIVE_BUDGET_MS ||
    result.pan.p95Ms > FRAME_P95_BUDGET_MS ||
    result.drag.p95Ms > FRAME_P95_BUDGET_MS
  ) {
    process.exitCode = 1;
  }
  await context.close();
} finally {
  await browser?.close();
  preview.kill();
}
