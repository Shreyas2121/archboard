import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePhase7Mode,
  phase7CheckPlan,
  executePhase7Plan,
  phase7ChildResult,
} from './phase7-check-plan.mjs';

test('mode parsing is explicit and rejects ambiguous or unknown switches', () => {
  assert.equal(parsePhase7Mode([]), 'full');
  assert.equal(parsePhase7Mode(['--', '--implementation']), 'implementation');
  assert.equal(parsePhase7Mode(['--non-browser']), 'non-browser');
  for (const args of [
    ['--quick'],
    ['--implementation', '--non-browser'],
    ['--implementation', '--implementation'],
  ])
    assert.throws(() => parsePhase7Mode(args));
});

test('implementation runs only database-free children and cannot claim the full gate', async () => {
  const children = [];
  const report = await executePhase7Plan('implementation', async (check) => {
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
  const report = await executePhase7Plan('non-browser', async (check) => {
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
  const report = await executePhase7Plan('full', async (check) => {
    children.push(check);
    return { status: 'PASS', durationMs: 1 };
  });
  assert.equal(children.filter(({ boundary }) => boundary === 'browser').length, 8);
  assert.equal(report.exitCode, 1);
  assert.equal(report.fullGate, 'OPEN');
  assert.equal(report.results.find(({ boundary }) => boundary === 'manual').status, 'UNRUN');
});

test('failed children propagate and independent later checks still run', async () => {
  const children = [];
  const report = await executePhase7Plan('implementation', async (check) => {
    children.push(check.id);
    return { status: check.id === 'lint' ? 'FAIL' : 'PASS', durationMs: 1 };
  });
  assert.equal(report.exitCode, 1);
  assert.ok(children.includes('dependency-boundaries'));
  assert.equal(report.results.find(({ id }) => id === 'lint').status, 'FAIL');
});

test('a failed build leaves dependent units/scans explicitly unrun rather than using stale artifacts', async () => {
  const report = await executePhase7Plan('implementation', async (check) => ({
    status: check.id === 'workspace-build' ? 'FAIL' : 'PASS',
    durationMs: 1,
  }));
  assert.equal(report.exitCode, 1);
  assert.equal(
    report.results.find(({ id }) => id === 'presentation-portability-lifecycle').status,
    'UNRUN',
  );
  assert.match(report.results.find(({ id }) => id === 'production-bundle').reason, /prerequisite/);
  assert.equal(report.results.find(({ id }) => id === 'dependency-boundaries').status, 'PASS');
});

test('manifest has unique children and avoids duplicated build/test aggregates', () => {
  const plan = phase7CheckPlan();
  assert.equal(new Set(plan.map(({ id }) => id)).size, plan.length);
  assert.equal(plan.filter(({ id }) => id === 'workspace-build').length, 1);
  assert.equal(plan.filter(({ args }) => args?.[0] === 'test').length, 0);
  assert.ok(plan.some(({ args }) => args?.includes('jest.integration.config.cjs')));
});

test('required missing tests, process failures and unapplied migrations cannot pass', () => {
  assert.equal(
    phase7ChildResult({ id: 'API-units', requireTests: true }, 'Tests: 17 passed, 17 total', 0)
      .tests,
    17,
  );
  assert.equal(
    phase7ChildResult({ id: 'web-Node-units', requireTests: true }, 'Tests 16 passed (16)', 0)
      .status,
    'PASS',
  );
  assert.equal(
    phase7ChildResult(
      { id: 'presentation-portability-lifecycle', requireTests: true },
      '# tests 0',
      0,
    ).status,
    'FAIL',
  );
  assert.equal(
    phase7ChildResult(
      { id: 'real-DB-session-HTTP-socket', requireTests: true },
      'No tests found',
      0,
    ).status,
    'FAIL',
  );
  assert.equal(
    phase7ChildResult(
      { id: 'configured-migrations', rejectPendingMigration: true },
      ' [ ] pending',
      0,
    ).status,
    'FAIL',
  );
  assert.equal(phase7ChildResult({ id: 'format' }, '', 1).status, 'FAIL');
  assert.equal(phase7ChildResult({ id: 'format' }, '', 0, true).status, 'FAIL');
  assert.equal(
    phase7ChildResult({ id: 'syntax-p7-11-portability-lifecycle.browser.mjs' }, '', 0).status,
    'PASS',
  );
  const privateOutput = 'cookie: synthetic-sensitive-fixture\n# tests 1';
  const result = phase7ChildResult({ id: 'API-units' }, privateOutput, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-sensitive-fixture'), false);
});

test('actual report secret scan rejects sensitive URLs without printing matches', () => {
  const directory = mkdtempSync(join(tmpdir(), 'archboard-p711-scan-'));
  const path = join(directory, 'report.json');
  const synthetic = 'postgresql://synthetic-sensitive-fixture@example.test/test';
  try {
    writeFileSync(path, JSON.stringify({ accidental: synthetic }));
    const result = spawnSync(
      process.execPath,
      ['scripts/check-phase7-evidence.mjs', '--report', path],
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
      ['scripts/check-phase7-evidence.mjs', '--report', path],
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

test('skip counts, null exits and runner exceptions propagate without private data', async () => {
  const check = { id: 'required', requireTests: true };
  for (const output of [
    'Tests: 1 skipped, 1 total',
    'Tests 1 passed | 1 skipped (2)',
    '# tests 2\n# skipped 1',
    '# tests 1\n# fail 1',
    '# tests 1\n# cancelled 1',
    '# tests 1\n# todo 1',
  ])
    assert.equal(phase7ChildResult(check, output, 0).status, 'FAIL');
  assert.equal(phase7ChildResult(check, '# tests 1', null).status, 'FAIL');
  const report = await executePhase7Plan(
    'implementation',
    async () => {
      throw new Error('private fixture body');
    },
    [{ id: 'synthetic', boundary: 'implementation' }],
  );
  assert.equal(report.exitCode, 1);
  assert.equal(JSON.stringify(report).includes('private fixture body'), false);
});

test('every required runtime/manual boundary is visible and modes retain OPEN acceptance', async () => {
  const plan = phase7CheckPlan();
  assert.equal(plan.filter((check) => check.boundary === 'manual').length, 3);
  assert.ok(plan.some((check) => check.id === 'served-p7-05-presenter-follow.browser.mjs'));
  assert.ok(plan.some((check) => check.id === 'served-p7-11-portability-lifecycle.browser.mjs'));
  assert.ok(plan.some((check) => check.id === 'export-units' && check.requireTests));
  for (const check of plan.filter((check) => check.id.startsWith('syntax-')))
    assert.ok(
      existsSync(new URL('../' + check.args[1], import.meta.url)),
      'Required served harness is missing.',
    );
  for (const mode of ['implementation', 'non-browser', 'full']) {
    const report = await executePhase7Plan(mode, async () => ({ status: 'PASS', durationMs: 1 }));
    assert.equal(report.fullGate, 'OPEN');
    assert.equal(report.results.length, plan.length);
    assert.ok(report.results.every((row) => ['PASS', 'FAIL', 'UNRUN'].includes(row.status)));
  }
});
