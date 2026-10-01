export function parsePhase6Mode(args) {
  const options = args.filter((arg) => arg !== '--');
  if (options.some((arg) => !['--implementation', '--non-browser'].includes(arg)))
    throw new Error('Use --implementation, --non-browser, or no option for full mode.');
  if (new Set(options).size !== options.length || options.length > 1)
    throw new Error('Select exactly one verification mode.');
  return options[0]?.slice(2) ?? 'full';
}

export const phase6BrowserScripts = [
  'p6-07-invite-acceptance.browser.mjs',
  'p6-08-discussion.browser.mjs',
  'p6-09-discussion.browser.mjs',
  'p6-10-lifecycle.browser.mjs',
  'p6-11-sharing-security.browser.mjs',
];
export const phase6NodeScripts = [
  'p6-04-resources.node.test.mjs',
  'p6-05-sharing.node.test.mjs',
  'p6-06-invites.node.test.mjs',
  'p6-07-invite-acceptance.node.test.mjs',
  'p6-08-discussion.node.test.mjs',
  'p6-09-discussion.node.test.mjs',
  'p6-10-lifecycle.node.test.mjs',
  'p6-11-verifier.node.test.mjs',
  'p5-08-update-state.node.test.mjs',
  'p5-09-storage-state.node.test.mjs',
];

export function phase6CheckPlan() {
  const pnpm = (id, args, extra = {}) => ({
    id,
    runner: 'pnpm',
    args,
    boundary: 'implementation',
    ...extra,
  });
  const node = (id, args, extra = {}) => ({
    id,
    runner: 'node',
    args,
    boundary: 'implementation',
    ...extra,
  });
  return [
    pnpm('frozen-install', ['install', '--frozen-lockfile']),
    pnpm('format', ['format:check']),
    pnpm('lint', ['lint']),
    pnpm('types', ['typecheck']),
    pnpm('workspace-build', ['build'], { production: true }),
    ...['contracts', 'fixtures', 'document-model'].map((name) =>
      node(`${name}-units`, ['../../node_modules/vitest/vitest.mjs', 'run'], {
        cwd: `packages/${name}`,
        requires: ['workspace-build'],
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
      { cwd: 'apps/api', requires: ['workspace-build'] },
    ),
    node(
      'web-Node-units',
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'apps/web/vitest.node.config.ts',
        'auth-transition-coordinator',
        'editor-session',
        'board-editor-loader',
        'editor-status-policy',
      ],
      { requires: ['workspace-build'] },
    ),
    node(
      'discussion-sharing-lifecycle',
      [
        '--experimental-vm-modules',
        '--test',
        ...phase6NodeScripts.map((file) => `scripts/${file}`),
      ],
      { requires: ['workspace-build'] },
    ),
    node('account-selection', ['--test', 'scripts/account-selection.node.test.mjs'], {
      cwd: 'packages/sync-client',
      requires: ['workspace-build'],
    }),
    node('production-bundle', ['scripts/check-web-bundle.mjs'], { requires: ['workspace-build'] }),
    node('generated-cache-policy', ['scripts/check-phase5-cache-policy.mjs'], {
      requires: ['workspace-build'],
    }),
    pnpm('public-secret-scan', ['--filter', '@archboard/api', 'security:scan'], {
      requires: ['workspace-build'],
    }),
    node('evidence-secret-scan', ['scripts/check-phase6-evidence.mjs']),
    pnpm('dependency-boundaries', ['boundary:check']),
    ...phase6BrowserScripts.map((file) => node(`syntax-${file}`, ['--check', `scripts/${file}`])),
    node(
      'real-DB-session-HTTP-socket',
      [
        '--experimental-vm-modules',
        '../../node_modules/jest/bin/jest.js',
        '--config',
        'jest.integration.config.cjs',
        '--runInBand',
      ],
      { boundary: 'database', cwd: 'apps/api', requires: ['workspace-build'] },
    ),
    node('auth-schema', ['scripts/check-auth-schema.mjs'], {
      boundary: 'database',
      cwd: 'apps/api',
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
        boundary: 'database',
        cwd: 'apps/api',
        requires: ['workspace-build'],
        rejectPendingMigration: true,
      },
    ),
    pnpm('native-browser-units', ['test:browser'], {
      boundary: 'browser',
      requires: ['workspace-build'],
    }),
    ...phase6BrowserScripts.map((file) =>
      node(`served-${file}`, [`scripts/${file}`], {
        boundary: 'browser',
        requires: ['workspace-build'],
      }),
    ),
    {
      id: 'combined-A10-A24-and-spoken-accessibility',
      boundary: 'manual',
      reason:
        'Independent cross-tab pending graph export/account-switch and spoken screen-reader observations require reviewed human evidence; see docs/phase6-verification.md.',
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

export function phase6ChildResult(check, output, code, errored = false) {
  const pendingMigration = check.rejectPendingMigration && /^\s*\[ \] /m.test(output);
  const testCount =
    output.match(/# tests (\d+)/)?.[1] ??
    output.match(/Tests:\s+.*?(\d+) total/)?.[1] ??
    output.match(/Tests\s+(\d+) passed/)?.[1];
  const needsTests =
    check.id.endsWith('-units') ||
    ['discussion-sharing-lifecycle', 'account-selection', 'real-DB-session-HTTP-socket'].includes(
      check.id,
    );
  const missingTests = needsTests && !(Number(testCount) > 0);
  const observations = [];
  const labels = [
    'unresolved-first-page',
    'unresolved-cursor-page',
    'resolved-first-page',
    'message-first-page',
    'message-cursor-page',
  ];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith('{"phase":"P6-11"')) continue;
    try {
      const value = JSON.parse(line.trim());
      if (
        labels.includes(value.label) &&
        ['threads', 'messages', 'rows', 'executionMs'].every(
          (key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0,
        )
      )
        observations.push({
          label: value.label,
          threads: value.threads,
          messages: value.messages,
          rows: value.rows,
          executionMs: value.executionMs,
          operators: Array.isArray(value.operators)
            ? value.operators
                .filter(
                  (operator) =>
                    typeof operator?.type === 'string' && /^[A-Za-z ]{1,40}$/.test(operator.type),
                )
                .map((operator) => ({
                  type: operator.type,
                  discussionIndex: [
                    'IDX_comment_threads_board_created_id',
                    'IDX_comments_thread_created_id',
                  ].includes(operator.discussionIndex)
                    ? operator.discussionIndex
                    : null,
                }))
            : [],
        });
    } catch {
      /* Raw errors/content are never included in the report. */
    }
  }
  return {
    status: code === 0 && !errored && !pendingMigration && !missingTests ? 'PASS' : 'FAIL',
    exitCode: code,
    ...(testCount ? { tests: Number(testCount) } : {}),
    ...(pendingMigration ? { reason: 'configured database has unapplied migrations' } : {}),
    ...(missingTests ? { reason: 'required test count was missing or zero' } : {}),
    ...(observations.length ? { observations } : {}),
  };
}

/** Continue independent checks after failure; never turn failed prerequisites into skipped PASS. */
export async function executePhase6Plan(mode, run) {
  const results = [];
  for (const check of phase6CheckPlan()) {
    const reason = deferredReason(check, mode);
    const failedDependency = check.requires?.find(
      (id) => results.find((row) => row.id === id)?.status !== 'PASS',
    );
    if (reason || failedDependency) {
      results.push({
        id: check.id,
        boundary: check.boundary,
        status: 'UNRUN',
        reason: reason ?? `prerequisite ${failedDependency} did not pass`,
        durationMs: 0,
      });
      continue;
    }
    const result = await run(check);
    results.push({ id: check.id, boundary: check.boundary, ...result });
  }
  const failed = results.some(({ status }) => status === 'FAIL');
  const incomplete = results.some(
    ({ status, boundary }) =>
      status === 'UNRUN' &&
      (boundary === 'implementation' ||
        (mode !== 'implementation' && boundary === 'database') ||
        (mode === 'full' && ['browser', 'manual'].includes(boundary))),
  );
  return { mode, results, fullGate: 'OPEN', exitCode: failed || incomplete ? 1 : 0 };
}
