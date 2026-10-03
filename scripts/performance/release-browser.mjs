/* global document, requestAnimationFrame, indexedDB */
// Prepared only: requires explicit browser resumption and final DB verification
// eligibility. Operates on a disposable, already seeded same-origin staging board.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release, totalmem } from 'node:os';
import { RELEASE_METHOD, summarize, safeStageMetric } from './report.mjs';

if (!process.argv.includes('--run-authorized')) {
  throw new Error(
    'Prepared harness: browser checks remain deferred. After explicit resumption use --run-authorized with a reviewed staging config.',
  );
}
const mode = process.argv[2];
if (!['frames', 'five-user', 'admission'].includes(mode))
  throw new Error('Select frames, five-user or admission.');
const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
const output = process.argv[4];
if (!output || !/^[a-f0-9]{40}$/.test(config.buildHash))
  throw new Error('Report output and deployed build hash required.');
const origin = new URL(config.origin);
if (
  origin.protocol !== 'https:' ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error('Use the clean same-origin HTTPS staging origin.');
if (!/^[a-f0-9-]{36}$/.test(config.boardId) || config.disposable !== true)
  throw new Error('Disposable preseeded board required.');
if (
  config.applicationRegion !== config.databaseRegion ||
  !config.applicationRegion ||
  !config.postgresVersion ||
  !config.networkProfile
)
  throw new Error(
    'Document same-region application/DB, PostgreSQL version and bidirectional network shaping.',
  );
if (!Array.isArray(config.storageStates) || config.storageStates.length !== 5)
  throw new Error('Five independently authenticated editor storage-state files required.');
if (
  !Number.isSafeInteger(config.encodedSeedBytes) ||
  config.encodedSeedBytes <= 0 ||
  !/^[a-f0-9]{64}$/.test(config.encodedSeedSha256)
)
  throw new Error('Record actual preseeded Yjs byte size and hash.');
const { chromium } = await import('../../packages/sync-client/node_modules/playwright/index.mjs');
const { createTypicalGraphFixture, createLimitGraphFixture } =
  await import('../../packages/fixtures/dist/index.js');
const graph = mode === 'admission' ? createLimitGraphFixture() : createTypicalGraphFixture();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [];
const states = [];
const report = {
  schemaVersion: 1,
  kind: 'rendered staging measurement',
  acceptance: 'OPEN',
  mode,
  build: config.buildHash,
  environment: {
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
    browser: browser.version(),
    postgres: config.postgresVersion,
    applicationRegion: config.applicationRegion,
    databaseRegion: config.databaseRegion,
    origin: origin.origin,
    networkProfile: config.networkProfile,
    cache: 'warm',
    connectivity: mode === 'frames' ? 'cached offline' : 'online',
    viewport: { width: 1440, height: 900 },
  },
  fixture: {
    seed: 804,
    encodedBytes: config.encodedSeedBytes,
    encodedSha256: config.encodedSeedSha256,
    graphSha256: createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    boundaries: graph.boundaries.length,
    steps: graph.steps.length,
  },
  method: RELEASE_METHOD,
  qualification:
    'OPEN: reconcile deployed bytes, server stage metrics, network-shaper evidence, reference machine and manual rendering observations in A26 review. Observer timings include automation overhead; ACK alone is insufficient.',
};
const wait = async (condition) => {
  const deadline = performance.now() + 30_000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Measurement stage timed out.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const paint = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
async function open(index) {
  const context = await browser.newContext({
    storageState: config.storageStates[index % 5],
    viewport: { width: 1440, height: 900 },
  });
  contexts.push(context);
  const page = await context.newPage();
  const state = { ready: false, error: null, ack: null, delivery: null, sent: 0 };
  states.push(state);
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      let frame;
      try {
        frame = JSON.parse(payload.toString());
      } catch {
        state.error = 'PROTOCOL_INVALID';
        return;
      }
      if (frame.event === 'update') state.sent++;
    });
    socket.on('framereceived', ({ payload }) => {
      let frame;
      try {
        frame = JSON.parse(payload.toString());
      } catch {
        state.error = 'PROTOCOL_INVALID';
        return;
      }
      if (frame.event === 'ready') state.ready = true;
      if (frame.event === 'error') state.error = frame.data.code;
      if (frame.event === 'ack') state.ack = { seq: frame.data.seq, at: performance.now() };
      if (frame.event === 'update') state.delivery = { seq: frame.data.seq, at: performance.now() };
      // Payloads are inspected transiently, never logged or included in report.
    });
  });
  await page.goto(`${origin.origin}/boards/${config.boardId}`);
  return { page, context, state };
}
async function interactive(page) {
  await page.waitForFunction(
    ({ nodes, edges }) =>
      nodes.every((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)) &&
      edges.every((id) => document.querySelector(`.react-flow__edge[data-id="${id}"]`)),
    { nodes: graph.nodes.map(({ id }) => id), edges: graph.edges.map(({ id }) => id) },
    { polling: 'raf' },
  );
  await page.getByRole('button', { name: 'Zoom in', exact: true }).waitFor();
  if (!(await page.getByRole('button', { name: 'Zoom in', exact: true }).isEnabled()))
    throw new Error('Editor controls are unavailable.');
}
async function localUpdateCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('archboard-sync-client');
        request.onerror = () => reject(new Error('Local database unavailable.'));
        request.onsuccess = () => {
          const database = request.result;
          const count = database
            .transaction('localUpdates', 'readonly')
            .objectStore('localUpdates')
            .count();
          count.onsuccess = () => {
            database.close();
            resolve(count.result);
          };
          count.onerror = () => {
            database.close();
            reject(new Error('Local log unavailable.'));
          };
        };
      }),
  );
}
async function frames(page, gesture) {
  await page.evaluate(() => {
    globalThis.__releaseFrames = { running: true, values: [], previous: null };
    const sample = (at) => {
      const state = globalThis.__releaseFrames;
      if (!state.running) return;
      if (state.previous !== null) state.values.push(at - state.previous);
      state.previous = at;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await gesture();
  return page.evaluate(() => {
    globalThis.__releaseFrames.running = false;
    return globalThis.__releaseFrames.values;
  });
}
try {
  if (mode === 'admission') {
    for (let index = 0; index < 10; index++) {
      const opened = await open(index);
      await wait(() => opened.state.ready || opened.state.error);
      if (!opened.state.ready) throw new Error('Connection within ten-user capacity was denied.');
      await interactive(opened.page);
    }
    const eleventh = await open(10);
    await wait(() => eleventh.state.error !== null);
    if (eleventh.state.error !== 'ROOM_FULL' || eleventh.state.ready)
      throw new Error('Eleventh connection did not fail closed with ROOM_FULL.');
    report.admission = { admitted: 10, rejected: 1, code: eleventh.state.error, limitGraph: true };
  } else if (mode === 'frames') {
    const { page, context } = await open(0);
    await interactive(page);
    await page.getByText('Saved to server', { exact: true }).first().waitFor();
    await context.setOffline(true);
    const opening = [];
    for (let index = -RELEASE_METHOD.warmup; index < RELEASE_METHOD.openingSamples; index++) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await interactive(page);
      const before = await page.getByLabel('Current zoom', { exact: true }).innerText();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.waitForFunction(
        (previous) =>
          document.querySelector('[aria-label="Current zoom"]')?.textContent !== previous,
        before,
        { polling: 'raf' },
      );
      await paint(page);
      if (index >= 0) opening.push(await page.evaluate(() => performance.now()));
    }
    report.cachedOpening = summarize(opening);
    const pan = [];
    const drag = [];
    for (let index = -RELEASE_METHOD.warmup; index < RELEASE_METHOD.gestureSamples; index++) {
      await page.getByRole('button', { name: 'Fit content', exact: true }).click();
      const pane = await page.locator('.react-flow__pane').boundingBox();
      if (!pane) throw new Error('No canvas rectangle.');
      const before = await localUpdateCount(page);
      const intervals = await frames(page, async () => {
        await page.mouse.move(pane.x + pane.width * 0.8, pane.y + pane.height * 0.8);
        await page.mouse.down({ button: 'middle' });
        await page.mouse.move(pane.x + pane.width * 0.6, pane.y + pane.height * 0.6, {
          steps: 120,
        });
        await page.mouse.up({ button: 'middle' });
      });
      if ((await localUpdateCount(page)) !== before)
        throw new Error('Pan emitted durable updates.');
      await page.getByRole('button', { name: 'Fit content', exact: true }).click();
      const dragId = await page.evaluate(
        ({ ids, pane }) =>
          ids.find((id) => {
            const rect = document
              .querySelector(`.react-flow__node[data-id="${id}"]`)
              ?.getBoundingClientRect();
            return (
              rect &&
              rect.x > pane.x + 20 &&
              rect.y > pane.y + 20 &&
              rect.right < pane.x + pane.width - 20 &&
              rect.bottom < pane.y + pane.height - 20
            );
          }),
        { ids: graph.nodes.filter(({ kind }) => kind === 'component').map(({ id }) => id), pane },
      );
      if (!dragId) throw new Error('No fully visible component card for drag.');
      const node = page.locator(`.react-flow__node[data-id="${dragId}"]`);
      const box = await node.boundingBox();
      if (!box) throw new Error('No drag card rectangle.');
      const beforeDrag = await localUpdateCount(page);
      const dragIntervals = await frames(page, async () => {
        const x = box.x + box.width / 2;
        const y = box.y + Math.min(box.height / 2, 35);
        const direction = index % 2 === 0 ? 1 : -1;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + direction * 80, y + direction * 40, { steps: 120 });
        await page.mouse.up();
      });
      await page.locator('[data-phase="saved"]').first().waitFor();
      if ((await localUpdateCount(page)) - beforeDrag !== 1)
        throw new Error('Drag must persist exactly one final geometry update.');
      if (index >= 0) {
        pan.push(...intervals);
        drag.push(...dragIntervals);
      }
    }
    report.pan = summarize(pan);
    report.drag = summarize(drag);
    report.budgetMiss =
      report.cachedOpening.p95Ms > 2000 || report.pan.p95Ms > 32 || report.drag.p95Ms > 32;
  } else {
    const clients = [];
    for (let index = 0; index < 5; index++) {
      const client = await open(index);
      await interactive(client.page);
      await wait(() => client.state.ready);
      clients.push(client);
    }
    const identities = await Promise.all(
      clients.map(async ({ page }) => {
        await page.getByText('Saved to server', { exact: true }).first().waitFor();
        return page.evaluate(async () => {
          const response = await fetch('/api/v1/me', { cache: 'no-store' });
          if (!response.ok) throw new Error('Identity check failed.');
          return (await response.json()).data.id;
        });
      }),
    );
    if (identities.some((id) => typeof id !== 'string') || new Set(identities).size !== 5)
      throw new Error('Five independent authenticated users required.');
    const rtt = [];
    for (let index = 0; index < 20; index++) {
      rtt.push(
        await clients[index % 5].page.evaluate(async () => {
          const start = performance.now();
          const response = await fetch('/api/v1/me', { cache: 'no-store' });
          if (!response.ok) throw new Error('Calibration failed.');
          return performance.now() - start;
        }),
      );
    }
    report.calibration = summarize(rtt);
    if (report.calibration.p50Ms < 90 || report.calibration.p50Ms > 120)
      throw new Error(
        'Measured application round trip does not support nominal 100 ms RTT; review external shaper and WS routing.',
      );
    const target = graph.nodes[0];
    const visibility = [];
    const acknowledgement = [];
    const delivery = [];
    for (let sample = -RELEASE_METHOD.warmup; sample < RELEASE_METHOD.samples; sample++) {
      const writerIndex = (sample + RELEASE_METHOD.warmup) % 5;
      const writer = clients[writerIndex];
      await writer.page.locator(`.react-flow__node[data-id="${target.id}"]`).click();
      const title = `Synthetic P8-04 ${sample + RELEASE_METHOD.warmup}`;
      const previous = writer.state.ack?.seq;
      const sentBefore = writer.state.sent;
      const started = performance.now();
      await writer.page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
      await wait(() => writer.state.ack !== null && writer.state.ack.seq !== previous);
      const ack = writer.state.ack;
      if (writer.state.sent - sentBefore !== 1)
        throw new Error('Each measured title action must emit one content update.');
      const peers = clients.filter((_, index) => index !== writerIndex);
      await wait(() => peers.every(({ state }) => state.delivery?.seq === ack.seq));
      const deliveredAt = Math.max(...peers.map(({ state }) => state.delivery.at));
      await Promise.all(
        peers.map(async ({ page }) => {
          await page.waitForFunction(
            ({ id, title }) =>
              document
                .querySelector(`.react-flow__node[data-id="${id}"]`)
                ?.textContent.includes(title),
            { id: target.id, title },
            { polling: 'raf' },
          );
          await paint(page);
        }),
      );
      if (sample >= 0) {
        visibility.push(performance.now() - started);
        acknowledgement.push(ack.at - started);
        delivery.push(deliveredAt - started);
      }
    }
    report.visibility = summarize(visibility);
    report.acknowledgement = summarize(acknowledgement);
    report.delivery = summarize(delivery);
    report.budgetMiss = report.visibility.p95Ms > 500;
  }
} catch {
  report.failure =
    'Measurement failed; review setup or boundary without persisting payloads or exception dumps.';
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  if (config.serverMetricsFile) {
    try {
      const stages = new Map();
      for (const line of (await readFile(config.serverMetricsFile, 'utf8')).split('\n')) {
        let metric;
        try {
          metric = safeStageMetric(JSON.parse(line));
        } catch {
          continue;
        }
        if (metric) {
          const values = stages.get(metric.event) ?? [];
          values.push(metric.durationMs);
          stages.set(metric.event, values);
        }
      }
      report.serverStages = Object.fromEntries(
        [...stages].map(([event, values]) => [event, summarize(values)]),
      );
    } catch {
      report.failure = 'Server stage file unavailable; measurement incomplete.';
      process.exitCode = 1;
    }
  }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
if (report.budgetMiss) process.exitCode = 1;
