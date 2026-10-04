import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

// Static proof only: never starts a server, browser, worker or database.
const assets = new URL('../apps/web/dist/assets/', import.meta.url);
const names = await readdir(assets);
const workers = names.filter((name) => /^ai-layout\.worker-[\w-]+\.js$/.test(name));
assert.equal(workers.length, 1, 'A single bundled layout worker must be emitted.');
const worker = workers[0];
const maximumPrecacheBytes = 2_097_152; // Existing Vite shell per-asset ceiling.
assert.ok((await stat(new URL(worker, assets))).size <= maximumPrecacheBytes);
const workerSource = await readFile(new URL(worker, assets), 'utf8');
assert.ok(workerSource.includes('elk.algorithm') && workerSource.includes('layered'));
const mainNames = names.filter((name) => /^index-[\w-]+\.js$/.test(name));
assert.equal(mainNames.length, 1);
const main = await readFile(new URL(mainNames[0], assets), 'utf8');
assert.ok(main.includes(worker), 'The application must reference its emitted worker asset.');
assert.ok(!main.includes('elk.algorithm'), 'The engine must remain outside the main bundle.');
const serviceWorker = await readFile(new URL('../apps/web/dist/sw.js', import.meta.url), 'utf8');
assert.ok(serviceWorker.includes(`assets/${worker}`), 'The shell must precache the worker.');
const html = await readFile(new URL('../apps/web/dist/index.html', import.meta.url), 'utf8');
assert.ok(html.includes("worker-src 'self' blob:"));
process.stdout.write(
  'PASS bundled AI layout worker is isolated, size-bounded, referenced, CSP-compatible and precached.\n',
);
