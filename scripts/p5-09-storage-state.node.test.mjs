import assert from 'node:assert/strict';
import test from 'node:test';
import { storageFailureDiagnostic } from '../packages/sync-client/dist/index.js';

import {
  formatStorageBytes,
  localWriteDescription,
} from '../apps/web/src/app/editor/storage-health-state.ts';

const status = (phase, savedOnDevice, pendingWrites = 0) => ({
  phase,
  savedOnDevice,
  pendingWrites,
  editingPaused: false,
  errorCode: null,
  diagnostic: null,
});

test('uncommitted and failed writes never receive a saved label', () => {
  assert.match(localWriteDescription(status('saved', true)), /committed/);
  assert.match(localWriteDescription(status('saving', false, 1)), /not yet confirmed/);
  assert.match(localWriteDescription(status('storage-error', false)), /not confirmed/);
  assert.match(localWriteDescription(status('recovery-required', false)), /Do not assume/);
  assert.match(localWriteDescription(null), /unavailable/);
});

test('unknown browser usage and quota are reported as unavailable', () => {
  assert.equal(formatStorageBytes(undefined), 'Unavailable');
  assert.equal(formatStorageBytes(Number.NaN), 'Unavailable');
  assert.equal(formatStorageBytes(-1), 'Unavailable');
  assert.equal(formatStorageBytes(1_048_576), '1.0 MiB');
});

test('quota diagnostics identify the condition without exposing exception text', () => {
  const quota = storageFailureDiagnostic({ name: 'QuotaExceededError', message: 'private path' });
  assert.match(quota, /quota was exceeded/);
  assert.doesNotMatch(quota, /private path/);
  assert.match(storageFailureDiagnostic(new Error('private path')), /Local persistence failed/);
});
