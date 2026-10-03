import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy, shellSecurityHeaders } from '../../apps/web/security-policy.mjs';
import { privateArtifactFindings } from './artifact-policy.mjs';

test('production policy excludes external connections, JS eval and embedding', () => {
  const policy = shellSecurityHeaders()['Content-Security-Policy'];
  assert.match(policy, /connect-src 'self';/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /form-action 'self'/);
  assert.doesNotMatch(policy, /https:|wss:|localhost|script-src[^;]*'unsafe-eval'/);
  assert.match(contentSecurityPolicy(true), /ws:\/\/localhost:\*/);
});

test('synthetic sensitive artifacts are rejected with counts and no raw output', () => {
  const payloads = [
    'postgresql://synthetic:private@host.invalid/db',
    '-----BEGIN PRIVATE KEY-----',
    `ghp_${'a'.repeat(36)}`,
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl',
    `/invite/${'x'.repeat(43)}`,
    'Cookie: session=synthetic-private',
    'Authorization: Bearer synthetic-private',
  ];
  for (const payload of payloads) assert.ok(privateArtifactFindings(payload) > 0);
  for (const payload of [
    'synthetic-comment-canary',
    'synthetic-code-canary',
    'synthetic-email-canary',
  ])
    assert.equal(privateArtifactFindings(`output ${payload}`, [payload]), 1);
  assert.equal(privateArtifactFindings('PASS: 3 tests. /invite/:redacted'), 0);
});
