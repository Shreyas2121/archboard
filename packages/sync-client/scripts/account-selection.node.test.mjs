import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearLocalSignOutPending,
  forgetSelectedLocalAccount,
  markLocalSignOutPending,
  readLocalSignOutPending,
  readSelectedAccountMarker,
  selectLocalAccount,
} from '../dist/index.js';

const origin = 'https://app.archboard.example';
const otherOrigin = 'https://preview.archboard.example';
const accountA = 'synthetic-account-a';
const accountB = 'synthetic-account-b';

test('pending sign-out blocks both cached and authenticated account selection', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    assert.equal(selectLocalAccount(origin, { kind: 'network-unavailable' }), null);
    assert.equal(
      selectLocalAccount(origin, { kind: 'authenticated', userId: accountA })?.userId,
      accountA,
    );
    assert.equal(readSelectedAccountMarker(origin), accountA);
    markLocalSignOutPending(origin, accountA);
    assert.equal(readLocalSignOutPending(origin), accountA);
    assert.equal(selectLocalAccount(origin, { kind: 'network-unavailable' }), null);
    assert.equal(selectLocalAccount(origin, { kind: 'authenticated', userId: accountA }), null);
    assert.equal(selectLocalAccount(origin, { kind: 'authenticated', userId: accountB }), null);
    assert.equal(selectLocalAccount(otherOrigin, { kind: 'network-unavailable' }), null);
    assert.equal(readSelectedAccountMarker(origin), accountA);
    clearLocalSignOutPending(origin, accountA);
    assert.equal(readLocalSignOutPending(origin), null);
    assert.equal(
      selectLocalAccount(origin, { kind: 'authenticated', userId: accountB })?.userId,
      accountB,
    );
    assert.equal(selectLocalAccount(origin, { kind: 'network-unavailable' })?.userId, accountB);
    forgetSelectedLocalAccount(origin);
    assert.equal(selectLocalAccount(origin, { kind: 'network-unavailable' }), null);
    assert.throws(() =>
      selectLocalAccount(origin, { kind: 'authenticated', userId: 'local-demo' }),
    );
  } finally {
    delete globalThis.localStorage;
  }
});
