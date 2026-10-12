import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy, shellSecurityHeaders } from '../../apps/web/security-policy.mjs';
import {
  BACKEND_SECRET_NAMES,
  privateArtifactFindings,
  publicArtifactFindings,
} from './artifact-policy.mjs';

test('production policy excludes external connections, JS eval and embedding', () => {
  const policy = shellSecurityHeaders()['Content-Security-Policy'];
  assert.match(policy, /connect-src 'self';/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /form-action 'self'/);
  assert.doesNotMatch(policy, /https:|wss:|localhost|script-src[^;]*'unsafe-eval'/);
  assert.match(contentSecurityPolicy(true), /ws:\/\/localhost:\*/);
  assert.match(contentSecurityPolicy(true), /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/);
  assert.match(contentSecurityPolicy(false), /script-src 'self' 'wasm-unsafe-eval';/);
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

test('AI operator credentials are rejected by name and by configured value without disclosure', () => {
  const environment = {
    OPENAI_API_KEY: 'synthetic-operator-value-not-a-native-key',
    AI_CACHE_KEY_SECRET: 'c'.repeat(64),
    AI_CONTENT_ENCRYPTION_KEY: 'd'.repeat(64),
  };
  const values = BACKEND_SECRET_NAMES.map((name) => environment[name]).filter(Boolean);
  for (const [name, value] of Object.entries(environment)) {
    assert.ok(publicArtifactFindings(`const setting = "${name}";`) > 0);
    const findings = publicArtifactFindings(`const setting = "${value}";`, values);
    assert.equal(findings, 1);
    assert.equal(typeof findings, 'number');
  }
  assert.equal(publicArtifactFindings('AI_DISABLED; semantic proposal; schemaVersion: 1'), 0);
});

test('recognizable synthetic provider keys are rejected without an operator environment', () => {
  for (const prefix of ['sk-', 'sk-proj-', 'sk-svcacct-'])
    assert.ok(privateArtifactFindings(prefix + 'synthetic'.repeat(8)) > 0);
  assert.equal(privateArtifactFindings('API key withheld; sk-proj-<redacted>'), 0);
});
