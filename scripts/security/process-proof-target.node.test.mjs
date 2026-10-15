import assert from 'node:assert/strict';
import test from 'node:test';
import { proofTarget } from './process-proof-target.mjs';

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
