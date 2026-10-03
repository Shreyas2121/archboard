// PREPARED ONLY: served P8-07 HTTPS package, disposable host, both verification conditions.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shellSecurityHeaders } from '../../apps/web/security-policy.mjs';

const { chromium } = createRequire(
  new URL('../../packages/sync-client/package.json', import.meta.url),
)('playwright');
let browser;
let stage = 'isolated HTTPS origin configuration';
try {
  const url = new URL(process.env.P8_WEB_ORIGIN);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.href, `${url.origin}/`);
  const origin = url.origin;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const remoteRequests = [];
  context.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin)
      remoteRequests.push(true);
  });
  stage = 'served CSP/referrer/nosniff headers and rendered local demo';
  const response = await page.goto(`${origin}/demo`);
  for (const [name, value] of Object.entries(shellSecurityHeaders()))
    assert.equal(response.headers()[name.toLowerCase()], value);
  await page.getByRole('button', { name: 'Download local recovery', exact: true }).waitFor();
  stage = 'actual CSP blocks external connect before remote network traffic';
  const denied = await page.evaluate(async () => {
    try {
      await fetch('https://hostile.invalid/pixel');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(denied, true);
  assert.deepEqual(remoteRequests, []);
  stage = 'signed-out protected responses and errors cannot become cached HTML';
  for (const path of [
    '/api/v1/me',
    '/api/missing',
    '/api/auth/get-session',
    '/health/missing',
    '/ws',
  ]) {
    const result = await context.request.get(`${origin}${path}`);
    assert.equal(result.headers()['cache-control'], 'no-store');
    assert.equal(result.headers()['referrer-policy'], 'no-referrer');
    assert.doesNotMatch(result.headers()['content-type'] ?? '', /text\/html/);
    if (path.endsWith('/missing')) assert.equal(result.status(), 404);
  }
  stage = 'static misses and invitation responses at actual host boundary';
  const missing = await context.request.get(`${origin}/assets/missing-private-test.js`);
  assert.equal(missing.status(), 404);
  const invite = await context.request.get(`${origin}/invite/${'x'.repeat(43)}`);
  assert.equal(invite.headers()['referrer-policy'], 'no-referrer');
  assert.equal(invite.headers()['cache-control'], 'no-store');
  stage = 'untrusted origin denial at raw auth handler';
  const deniedAuth = await context.request.post(`${origin}/api/auth/sign-out`, {
    headers: { Origin: 'https://hostile.invalid', 'Content-Type': 'application/json' },
    data: {},
  });
  assert.equal(deniedAuth.status(), 403);
  assert.equal(deniedAuth.headers()['cache-control'], 'no-store');
  await context.close();
  process.stdout.write(
    'PASS served host policy subset; combined recovery, inert exports and real fanout remain separate rows.\n',
  );
} catch {
  process.stderr.write(`FAIL release host policy: ${stage}; details withheld.\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
