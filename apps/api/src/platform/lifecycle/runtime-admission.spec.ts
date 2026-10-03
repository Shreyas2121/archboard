import { RuntimeAdmission } from './runtime-admission.js';

it('requires ownership and compatible schema; shutdown cannot reopen admission', () => {
  const admission = new RuntimeAdmission();
  expect(() => admission.beginTransaction()).toThrow();
  admission.setOwnership(true);
  expect(admission.accepting).toBe(false);
  admission.setSchemaCompatible(true);
  expect(admission.accepting).toBe(true);
  admission.stop();
  admission.setSchemaCompatible(true);
  expect(admission.accepting).toBe(false);
});

it('waits for admitted transactions while refusing new work and allowing graceful commit', async () => {
  const admission = new RuntimeAdmission();
  admission.setOwnership(true);
  admission.setSchemaCompatible(true);
  const done = admission.beginTransaction();
  admission.stop();
  let idle = false;
  const waiting = admission.whenIdle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  expect(idle).toBe(false);
  expect(() => admission.beginTransaction()).toThrow();
  expect(() => admission.assertCanCommit()).not.toThrow();
  done();
  done();
  await waiting;
  expect(admission.activeTransactions).toBe(0);
});

it('ownership loss permanently fences in-flight commits', () => {
  const admission = new RuntimeAdmission();
  admission.setOwnership(true);
  admission.setSchemaCompatible(true);
  const done = admission.beginTransaction();
  admission.setOwnership(false);
  expect(() => admission.assertCanCommit()).toThrow();
  admission.setOwnership(true);
  expect(admission.accepting).toBe(false);
  expect(() => admission.assertCanCommit()).toThrow();
  done();
});
