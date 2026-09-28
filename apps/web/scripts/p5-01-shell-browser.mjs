import { spawn } from 'node:child_process';
import { chromium } from '../../../packages/sync-client/node_modules/playwright/index.mjs';

const origin = 'http://127.0.0.1:4173';
const preview = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  },
);
let browser;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function unexpectedCspViolations(violations) {
  // Zod probes Function() once, catches the CSP denial, and continues without JIT.
  return violations.filter(
    (violation) => !/^script-src: eval at .+\/assets\/index-[^/]+\.js:\d+:\d+$/.test(violation),
  );
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Production preview did not start.');
}

async function cacheUrls(page) {
  return page.evaluate(async () => {
    const names = await globalThis.caches.keys();
    const urls = (
      await Promise.all(
        names.map(async (name) => {
          const cache = await globalThis.caches.open(name);
          return (await cache.keys()).map((request) => request.url);
        }),
      )
    ).flat();
    return { names, urls };
  });
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(() => {
    globalThis.__cspViolations = [];
    globalThis.document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__cspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
      );
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
  await page.goto(`${origin}/demo`);
  await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Service worker did not activate.')), 10000),
      ),
    ]),
  );
  await page.reload();
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    'A service worker must control the later navigation.',
  );
  const controllerUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  const demoViolations = await page.evaluate(() => globalThis.__cspViolations);
  expect(
    unexpectedCspViolations(demoViolations).length === 0,
    `CSP blocked the demo: ${demoViolations.join(', ')}`,
  );

  const online = await cacheUrls(page);
  expect(online.names.length > 0, 'Static precache must exist after install.');
  expect(
    online.urls.some((url) => new URL(url).pathname === '/index.html'),
    'The HTML shell must be precached.',
  );
  expect(
    online.urls.some((url) => new URL(url).pathname === '/favicon.svg'),
    'The local icon must be precached.',
  );
  expect(
    online.urls.some((url) => new URL(url).pathname.endsWith('.woff2')),
    'The local font must be precached.',
  );
  expect(
    online.urls.some((url) => new URL(url).pathname.endsWith('.js')),
    'The editor scripts must be precached.',
  );

  for (const path of ['/boards', '/boards/00000000-0000-4000-8000-000000000001']) {
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `Online direct navigation failed: ${path}`);
    expect(
      (await page.reload({ waitUntil: 'domcontentloaded' }))?.ok(),
      `Online direct refresh failed: ${path}`,
    );
    const violations = await page.evaluate(() => globalThis.__cspViolations);
    expect(
      unexpectedCspViolations(violations).length === 0,
      `CSP blocked the online shell: ${path}: ${violations.join(', ')}`,
    );
  }

  await page.evaluate(async () => {
    await Promise.all([
      fetch('/api/v1/me', { credentials: 'include' }),
      fetch('/api/auth/get-session', { credentials: 'include' }),
      fetch('/invites/private-token'),
      fetch('/ws/boards/test'),
    ]);
  });
  const afterSensitiveRequests = await cacheUrls(page);
  expect(
    afterSensitiveRequests.urls.every(
      (url) => !/\/(?:api|auth|invites|ws)(?:\/|$)/.test(new URL(url).pathname),
    ),
    'Protected paths must never enter Cache Storage.',
  );
  expect(
    afterSensitiveRequests.urls.length === online.urls.length,
    'Sensitive requests must not create cache entries.',
  );

  await context.setOffline(true);
  for (const path of ['/demo', '/boards', '/boards/00000000-0000-4000-8000-000000000001']) {
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `Offline direct navigation failed: ${path}`);
    expect((await page.title()) === 'Archboard', `Offline shell title missing: ${path}`);
    expect((await page.locator('#root').count()) === 1, `Offline React root missing: ${path}`);
  }
  for (const path of [
    '/api/v1/me',
    '/api/auth/callback/provider',
    '/auth/callback/provider',
    '/invites/private-token',
    '/boards/invite/private-token',
    '/ws/boards/test',
    '/missing-asset.js',
  ]) {
    let failed = false;
    try {
      const response = await page.goto(`${origin}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      });
      failed = !response?.ok();
    } catch {
      failed = true;
    }
    expect(failed, `Protected or missing path unexpectedly loaded offline: ${path}`);
  }

  const firstVisit = await browser.newContext({ serviceWorkers: 'allow', offline: true });
  const firstPage = await firstVisit.newPage();
  let firstVisitFailed = false;
  try {
    const response = await firstPage.goto(`${origin}/boards`, { timeout: 5000 });
    firstVisitFailed = !response?.ok();
  } catch {
    firstVisitFailed = true;
  }
  expect(firstVisitFailed, 'A never-installed browser must not load the offline shell.');
  await firstVisit.close();
  console.log(
    `PASS: Chrome ${browser.version()}, ${controllerUrl}, offline direct routes, first-visit failure, missing/protected paths, ${online.names.length} cache(s), ${online.urls.length} static entries`,
  );
  await context.close();
} finally {
  await browser?.close();
  preview.kill();
}
