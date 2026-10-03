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

test('split-host policy permits only the configured exact API and WebSocket origins', () => {
  const origins = ['https://app.example.com', 'wss://api.example.com'];
  const policy = shellSecurityHeaders(false, origins)['Content-Security-Policy'];
  assert.match(policy, /connect-src 'self' https:\/\/app\.example\.com wss:\/\/api\.example\.com;/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.equal(
    contentSecurityPolicy(false, [...origins, ...origins]),
    contentSecurityPolicy(false, origins),
  );
});

test('connection-origin validation rejects insecure production values and CSP injection', () => {
  for (const origin of [
    'http://localhost:3000',
    'ws://api.example.com',
    'https://*.example.com',
    'https://api.example.com/path',
    'https://api.example.com/',
    'https://private:secret@api.example.com',
    'https://api.example.com?private=secret',
    'https://api.example.com; script-src *',
    "https://api.example.com 'unsafe-eval'",
  ]) {
    assert.throws(() => contentSecurityPolicy(false, [origin]), {
      message:
        'CSP connection origins must be exact HTTPS/WSS origins (local development excepted).',
    });
  }
  assert.doesNotThrow(() =>
    contentSecurityPolicy(true, ['http://localhost:3000', 'ws://127.0.0.1:3000']),
  );
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
