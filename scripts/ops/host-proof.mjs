// Real package HTTP/header proof, prepared only. No browser automation here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { shellSecurityHeaders } from '../../apps/web/security-policy.mjs';

try {
  const origin = new URL(process.env.P8_OPS_HOST_ORIGIN ?? '');
  assert.equal(process.env.P8_RUN_DATABASE_PROOF, 'implementation-complete');
  assert.equal(process.env.P8_OPS_CONFIRM_ORIGIN, origin.origin);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.href, `${origin.origin}/`);
  const check = async (path, html, cache, status) => {
    const response = await fetch(new URL(path, origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    });
    if (status) assert.equal(response.status, status);
    for (const [name, value] of Object.entries(shellSecurityHeaders()))
      assert.equal(response.headers.get(name), value);
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(response.headers.get('cache-control'), cache);
    assert.equal(response.headers.get('content-type')?.includes('text/html') ?? false, html);
    return response.text();
  };
  const board = randomUUID();
  const shell = await check(`/boards/${board}/checkpoints/${randomUUID()}`, true, 'no-cache', 200);
  await check('/demo', true, 'no-cache', 200);
  await check('/invite/synthetic-one-time-placeholder', true, 'no-store', 200);
  for (const path of [
    '/api/does-not-exist',
    '/api/auth/does-not-exist',
    '/ws/does-not-exist',
    '/health/does-not-exist',
  ])
    await check(path, false, 'no-store', 404);
  await check('/health/live', false, 'no-store', 200);
  await check('/health/ready', false, 'no-store', 200);
  await check('/assets/does-not-exist.js', false, 'no-store', 404);
  await check('/does-not-exist', false, 'no-store', 404);
  const asset = /(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/.exec(shell)?.[1];
  assert.ok(asset);
  await check(asset, false, 'public, max-age=31536000, immutable', 200);
  process.stdout.write(
    'PASS P8-07 host HTTP routes/security/cache/errors; browser/authenticated socket execution remains separate.\n',
  );
} catch {
  process.stderr.write('FAIL P8-07 host proof; response bodies and URLs withheld.\n');
  process.exitCode = 1;
}
