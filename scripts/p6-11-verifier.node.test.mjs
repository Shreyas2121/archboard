import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePhase6Mode,
  phase6CheckPlan,
  executePhase6Plan,
  phase6ChildResult,
} from './phase6-check-plan.mjs';

test('mode parsing is explicit and rejects ambiguous or unknown switches', () => {
  assert.equal(parsePhase6Mode([]), 'full');
  assert.equal(parsePhase6Mode(['--', '--implementation']), 'implementation');
  assert.equal(parsePhase6Mode(['--non-browser']), 'non-browser');
  for (const args of [
    ['--quick'],
    ['--implementation', '--non-browser'],
    ['--implementation', '--implementation'],
  ])
    assert.throws(() => parsePhase6Mode(args));
});

test('implementation runs only database-free children and cannot claim the full gate', async () => {
  const children = [];
  const report = await executePhase6Plan('implementation', async (check) => {
    children.push(check);
    return { status: 'PASS', durationMs: 1 };
  });
  assert.ok(children.length > 0);
  assert.ok(children.every(({ boundary }) => boundary === 'implementation'));
  assert.ok(
    children.every(
      ({ args }) => !args.includes('jest.integration.config.cjs') && !args.includes('test:browser'),
    ),
  );
  assert.ok(
    children
      .filter(({ id }) => id.startsWith('syntax-'))
      .every(({ args }) => args[0] === '--check'),
  );
  assert.equal(report.exitCode, 0);
  assert.equal(report.fullGate, 'OPEN');
  assert.equal(
    report.results.find(({ id }) => id === 'real-DB-session-HTTP-socket').status,
    'UNRUN',
  );
  assert.match(report.results.find(({ id }) => id === 'auth-schema').reason, /Version 1/);
});

test('non-browser retains real DB children and never executes browser scripts', async () => {
  const children = [];
  const report = await executePhase6Plan('non-browser', async (check) => {
    children.push(check);
    return { status: 'PASS', durationMs: 1 };
  });
  assert.equal(children.filter(({ boundary }) => boundary === 'database').length, 3);
  assert.equal(children.filter(({ boundary }) => boundary === 'browser').length, 0);
  assert.equal(report.exitCode, 0);
  assert.equal(report.fullGate, 'OPEN');
});

test('full mode wires prepared browser proof and fails closed on missing human acceptance', async () => {
  const children = [];
  const report = await executePhase6Plan('full', async (check) => {
    children.push(check);
    return { status: 'PASS', durationMs: 1 };
  });
  assert.equal(children.filter(({ boundary }) => boundary === 'browser').length, 6);
  assert.equal(report.exitCode, 1);
  assert.equal(report.fullGate, 'OPEN');
  assert.equal(report.results.find(({ boundary }) => boundary === 'manual').status, 'UNRUN');
});

test('failed children propagate and independent later checks still run', async () => {
  const children = [];
  const report = await executePhase6Plan('implementation', async (check) => {
    children.push(check.id);
    return { status: check.id === 'lint' ? 'FAIL' : 'PASS', durationMs: 1 };
  });
  assert.equal(report.exitCode, 1);
  assert.ok(children.includes('dependency-boundaries'));
  assert.equal(report.results.find(({ id }) => id === 'lint').status, 'FAIL');
});

test('a failed build leaves dependent units/scans explicitly unrun rather than using stale artifacts', async () => {
  const report = await executePhase6Plan('implementation', async (check) => ({
    status: check.id === 'workspace-build' ? 'FAIL' : 'PASS',
    durationMs: 1,
  }));
  assert.equal(report.exitCode, 1);
  assert.equal(
    report.results.find(({ id }) => id === 'discussion-sharing-lifecycle').status,
    'UNRUN',
  );
  assert.match(report.results.find(({ id }) => id === 'production-bundle').reason, /prerequisite/);
  assert.equal(report.results.find(({ id }) => id === 'dependency-boundaries').status, 'PASS');
});

test('manifest has unique children and avoids duplicated build/test aggregates', () => {
  const plan = phase6CheckPlan();
  assert.equal(new Set(plan.map(({ id }) => id)).size, plan.length);
  assert.equal(plan.filter(({ id }) => id === 'workspace-build').length, 1);
  assert.equal(plan.filter(({ args }) => args?.[0] === 'test').length, 0);
  assert.ok(plan.some(({ args }) => args?.includes('jest.integration.config.cjs')));
});

test('required missing tests, process failures and unapplied migrations cannot pass', () => {
  assert.equal(phase6ChildResult({ id: 'API-units' }, 'Tests: 17 passed, 17 total', 0).tests, 17);
  assert.equal(
    phase6ChildResult({ id: 'web-Node-units' }, 'Tests 16 passed (16)', 0).status,
    'PASS',
  );
  assert.equal(
    phase6ChildResult({ id: 'discussion-sharing-lifecycle' }, '# tests 0', 0).status,
    'FAIL',
  );
  assert.equal(
    phase6ChildResult({ id: 'real-DB-session-HTTP-socket' }, 'No tests found', 0).status,
    'FAIL',
  );
  assert.equal(
    phase6ChildResult(
      { id: 'configured-migrations', rejectPendingMigration: true },
      ' [ ] pending',
      0,
    ).status,
    'FAIL',
  );
  assert.equal(phase6ChildResult({ id: 'format' }, '', 1).status, 'FAIL');
  assert.equal(phase6ChildResult({ id: 'format' }, '', 0, true).status, 'FAIL');
  assert.equal(
    phase6ChildResult({ id: 'syntax-p6-10-lifecycle.browser.mjs' }, '', 0).status,
    'PASS',
  );
  const privateOutput = 'cookie: synthetic-sensitive-fixture\n# tests 1';
  const result = phase6ChildResult({ id: 'API-units' }, privateOutput, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-sensitive-fixture'), false);
  const observation = phase6ChildResult(
    { id: 'real-DB-session-HTTP-socket' },
    '# tests 1\n{"phase":"P6-11","label":"message-first-page","threads":301,"messages":500,"rows":30,"executionMs":0.5,"private":"withheld"}',
    0,
  );
  assert.equal(observation.observations[0].rows, 30);
  assert.equal(JSON.stringify(observation).includes('withheld'), false);
});

test('actual report secret scan rejects sensitive URLs without printing matches', () => {
  const directory = mkdtempSync(join(tmpdir(), 'archboard-p611-scan-'));
  const path = join(directory, 'report.json');
  const synthetic = 'postgresql://synthetic-sensitive-fixture@example.test/test';
  try {
    writeFileSync(path, JSON.stringify({ accidental: synthetic }));
    const result = spawnSync(
      process.execPath,
      ['scripts/check-phase6-evidence.mjs', '--report', path],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /matching files/);
    assert.equal(`${result.stdout}${result.stderr}`.includes(synthetic), false);
    writeFileSync(path, JSON.stringify({ status: 'PASS', durationMs: 1 }));
    const safe = spawnSync(
      process.execPath,
      ['scripts/check-phase6-evidence.mjs', '--report', path],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
      },
    );
    assert.equal(safe.status, 0);
  } finally {
    unlinkSync(path);
    rmdirSync(directory);
  }
});
