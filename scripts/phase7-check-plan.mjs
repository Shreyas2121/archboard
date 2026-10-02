export function parsePhase7Mode(args) {
  const options = args.filter((arg) => arg !== '--');
  if (
    options.some((arg) => !['--implementation', '--non-browser'].includes(arg)) ||
    options.length > 1
  )
    throw new Error('Use --implementation, --non-browser, or no option for full mode.');
  return options[0]?.slice(2) ?? 'full';
}
export const phase7BrowserScripts = [
  'p7-03-local-presentation.browser.mjs',
  'p7-03-board-presentation.browser.mjs',
  'p7-05-presenter-follow.browser.mjs',
  'p7-08-portability.browser.mjs',
  'p7-09-image-export.browser.mjs',
  'p7-10-templates.browser.mjs',
  'p7-11-portability-lifecycle.browser.mjs',
];
export const phase7NodeScripts = [
  'p7-03-presentation.node.test.mjs',
  'p7-04-presenter.node.test.mjs',
  'p7-05-presenter-follow.node.test.mjs',
  'p7-08-portability.node.test.mjs',
  'p7-09-image-export.node.test.mjs',
  'p7-11-verifier.node.test.mjs',
  'p6-10-lifecycle.node.test.mjs',
  'p5-08-update-state.node.test.mjs',
  'p5-09-storage-state.node.test.mjs',
];
export function phase7CheckPlan() {
  const node = (id, args, extra = {}) => ({
    id,
    runner: 'node',
    args,
    boundary: 'implementation',
    ...extra,
  });
  const pnpm = (id, args, extra = {}) => ({
    id,
    runner: 'pnpm',
    args,
    boundary: 'implementation',
    ...extra,
  });
  return [
    pnpm('format', ['format:check']),
    pnpm('lint', ['lint']),
    pnpm('types', ['typecheck']),
    pnpm('workspace-build', ['build'], { production: true }),
    ...['contracts', 'fixtures', 'document-model', 'export'].map((name) =>
      node(name + '-units', ['../../node_modules/vitest/vitest.mjs', 'run'], {
        cwd: 'packages/' + name,
        requires: ['workspace-build'],
        requireTests: true,
      }),
    ),
    node(
      'API-units',
      [
        '--experimental-vm-modules',
        '../../node_modules/jest/bin/jest.js',
        '--config',
        'jest.config.cjs',
        '--runInBand',
      ],
      { cwd: 'apps/api', requires: ['workspace-build'], requireTests: true },
    ),
    node(
      'web-Node-units',
      ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/web-node/vitest.config.ts'],
      { requires: ['workspace-build'], requireTests: true },
    ),
    node(
      'presentation-portability-lifecycle',
      [
        '--experimental-vm-modules',
        '--test',
        ...phase7NodeScripts.map((file) => 'scripts/' + file),
      ],
      { requires: ['workspace-build'], requireTests: true },
    ),
    node('account-selection', ['--test', 'scripts/account-selection.node.test.mjs'], {
      cwd: 'packages/sync-client',
      requires: ['workspace-build'],
      requireTests: true,
    }),
    node('production-bundle', ['scripts/check-web-bundle.mjs'], { requires: ['workspace-build'] }),
    node('generated-cache-policy', ['scripts/check-phase5-cache-policy.mjs'], {
      requires: ['workspace-build'],
    }),
    node('public-secret-scan', ['apps/api/scripts/check-public-secrets.mjs'], {
      requires: ['workspace-build'],
    }),
    node('evidence-secret-scan', ['scripts/check-phase7-evidence.mjs']),
    pnpm('dependency-boundaries', ['boundary:check']),
    ...phase7BrowserScripts.map((file) => node('syntax-' + file, ['--check', 'scripts/' + file])),
    node(
      'real-DB-session-HTTP-socket',
      [
        '--experimental-vm-modules',
        '../../node_modules/jest/bin/jest.js',
        '--config',
        'jest.integration.config.cjs',
        '--runInBand',
      ],
      { cwd: 'apps/api', boundary: 'database', requires: ['workspace-build'], requireTests: true },
    ),
    node('auth-schema', ['scripts/check-auth-schema.mjs'], {
      cwd: 'apps/api',
      boundary: 'database',
      requires: ['workspace-build'],
    }),
    node(
      'configured-migrations',
      [
        '../../node_modules/typeorm/cli.js',
        'migration:show',
        '-d',
        'dist/platform/database/migration-data-source.js',
      ],
      {
        cwd: 'apps/api',
        boundary: 'database',
        requires: ['workspace-build'],
        rejectPendingMigration: true,
      },
    ),
    pnpm('native-browser-units', ['test:browser'], {
      boundary: 'browser',
      requires: ['workspace-build'],
      requireTests: true,
    }),
    ...phase7BrowserScripts.map((file) =>
      node('served-' + file, ['scripts/' + file], {
        boundary: 'browser',
        requires: [
          'workspace-build',
          ...(['p7-03-local-presentation.browser.mjs', 'p7-09-image-export.browser.mjs'].includes(
            file,
          )
            ? []
            : ['real-DB-session-HTTP-socket']),
        ],
      }),
    ),
    {
      id: 'combined-A10-A22-A24-recovery',
      boundary: 'manual',
      reason:
        'OPEN: real IndexedDB storage failure, above-cap full recovery, queued bytes and cross-tab sign-out/account late-result preservation require reviewed integrated evidence; see docs/phase7-verification.md.',
    },
    {
      id: 'A18-host-and-image-limits',
      boundary: 'manual',
      reason:
        'OPEN: production host CSP/rewrite headers and actual oversized/selected-edge image controls require reviewed served evidence; see docs/phase7-verification.md.',
    },
    {
      id: 'A28-and-template-legibility',
      boundary: 'manual',
      reason:
        'OPEN: spoken screen-reader, narrow-screen/light/dark template legibility and complete keyboard export/presentation observations require reviewed human evidence; see docs/phase7-verification.md.',
    },
  ];
}
export function deferredReason(check, mode) {
  if (check.boundary === 'manual') return check.reason;
  if (check.boundary === 'database' && mode === 'implementation')
    return 'deferred by user — until Version 1 implementation is complete';
  if (check.boundary === 'browser' && mode !== 'full') return 'deferred by user';
  return null;
}
export function phase7ChildResult(check, output, code, errored = false) {
  const summary = output.match(/^\s*Tests:?\s+([^\n]+)/m)?.[1] ?? '';
  const tap = (name) => Number(output.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? 0);
  const tests = Number(
    summary.match(/(\d+) total/)?.[1] ?? summary.match(/\((\d+)\)/)?.[1] ?? tap('tests'),
  );
  const failed = Number(summary.match(/(\d+) failed/)?.[1] ?? tap('fail'));
  const skipped = Number(summary.match(/(\d+) skipped/)?.[1] ?? tap('skipped'));
  const cancelled = tap('cancelled');
  const todo = Number(summary.match(/(\d+) todo/)?.[1] ?? tap('todo'));
  const pendingMigration = check.rejectPendingMigration && /^\s*\[ \] /m.test(output);
  const missingTests = check.requireTests && !(tests > 0);
  const incompleteTests =
    check.requireTests && (failed > 0 || skipped > 0 || cancelled > 0 || todo > 0);
  return {
    status:
      code === 0 && !errored && !pendingMigration && !missingTests && !incompleteTests
        ? 'PASS'
        : 'FAIL',
    exitCode: code,
    ...(check.requireTests ? { tests, failed, skipped, cancelled, todo } : {}),
    ...(pendingMigration ? { reason: 'configured database has unapplied migrations' } : {}),
    ...(missingTests ? { reason: 'required test count was missing or zero' } : {}),
    ...(incompleteTests ? { reason: 'required tests failed or were skipped' } : {}),
  };
}
/** Continue independent checks and mark blocked dependencies UNRUN; never reuse stale build artifacts. */
export async function executePhase7Plan(mode, run, plan = phase7CheckPlan()) {
  if (!['implementation', 'non-browser', 'full'].includes(mode)) throw new Error('Invalid mode.');
  const results = [];
  for (const check of plan) {
    const reason = deferredReason(check, mode);
    const dependency = check.requires?.find(
      (id) => results.find((row) => row.id === id)?.status !== 'PASS',
    );
    if (reason || dependency) {
      results.push({
        id: check.id,
        boundary: check.boundary,
        status: 'UNRUN',
        reason: reason ?? 'prerequisite ' + dependency + ' did not pass',
        durationMs: 0,
      });
      continue;
    }
    try {
      results.push({ id: check.id, boundary: check.boundary, ...(await run(check)) });
    } catch {
      results.push({
        id: check.id,
        boundary: check.boundary,
        status: 'FAIL',
        reason: 'child runner failed; private details withheld',
        durationMs: 0,
      });
    }
  }
  const failed = results.some((row) => row.status === 'FAIL');
  const incomplete = results.some(
    (row) =>
      row.status !== 'PASS' &&
      (row.boundary === 'implementation' ||
        (mode !== 'implementation' && row.boundary === 'database') ||
        mode === 'full'),
  );
  return {
    mode,
    results,
    fullGate: mode === 'full' && !failed && !incomplete ? 'PASS' : 'OPEN',
    exitCode: failed || incomplete ? 1 : 0,
  };
}
