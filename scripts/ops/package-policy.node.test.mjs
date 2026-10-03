import assert from 'node:assert/strict';
import test from 'node:test';
import { packageSources, validatePackage } from './package-policy.mjs';
import { loadRuntimeSecrets } from '../../ops/load-secrets.mjs';
import { proofTarget } from './proof-target.mjs';

test('package source passes native Compose syntax and bounded source checks', async () => {
  validatePackage(await packageSources());
});
test('package policy rejects public database, replicas, plaintext secrets and weakened CSP', async () => {
  const original = await packageSources();
  for (const mutate of [
    (value) => {
      value.compose.services.postgres.ports = [{ published: '5432' }];
    },
    (value) => {
      value.compose.services.api.deploy.replicas = 2;
    },
    (value) => {
      value.compose.services.api.tmpfs = ['/tmp:rw', 'noexec'];
    },
    (value) => {
      value.compose.services.api.environment.BETTER_AUTH_SECRET = 'synthetic';
    },
    (value) => {
      value.headers = value.headers.replace("connect-src 'self'", 'connect-src *');
    },
  ]) {
    const modified = structuredClone(original);
    mutate(modified);
    assert.throws(() => validatePackage(modified));
  }
});
test('process proof refuses unconfirmed, remote, production and preconfigured-schema targets', () => {
  const environment = {
    P8_RUN_DATABASE_PROOF: 'implementation-complete',
    P8_OPS_DATABASE_URL: 'postgresql://localhost/archboard_test',
    P8_OPS_CONFIRM_DATABASE: 'archboard_test',
  };
  assert.equal(proofTarget(environment).pathname, '/archboard_test');
  for (const patch of [
    { P8_RUN_DATABASE_PROOF: undefined },
    { P8_OPS_CONFIRM_DATABASE: 'other_test' },
    { P8_OPS_DATABASE_URL: 'postgresql://remote.example/archboard_test' },
    { P8_OPS_DATABASE_URL: 'postgresql://localhost/archboard' },
    {
      P8_OPS_DATABASE_URL: 'postgresql://localhost/archboard_test?options=-c%20search_path=public',
    },
  ])
    assert.throws(() => proofTarget({ ...environment, ...patch }));
});
test('file secrets preserve environment input and never accept ambiguous or multiline sources', async () => {
  const environment = { PORT: '3000', BETTER_AUTH_SECRET_FILE: '/synthetic/file' };
  const loaded = await loadRuntimeSecrets(environment, async () => 'synthetic-value\n');
  assert.equal(loaded.BETTER_AUTH_SECRET, 'synthetic-value');
  assert.equal(loaded.BETTER_AUTH_SECRET_FILE, undefined);
  assert.equal(environment.BETTER_AUTH_SECRET_FILE, '/synthetic/file');
  await assert.rejects(
    loadRuntimeSecrets({ ...environment, BETTER_AUTH_SECRET: 'synthetic' }),
    /Conflicting/,
  );
  for (const invalid of ['', 'synthetic\ninjected', 'x'.repeat(16_385)])
    await assert.rejects(
      loadRuntimeSecrets(environment, async () => invalid),
      /Invalid/,
    );
});
