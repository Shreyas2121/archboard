import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('phase4:verify must be invoked through pnpm.');
const options = new Set(process.argv.slice(2).filter((argument) => argument !== '--'));
for (const option of options) {
  if (!['--quick', '--with-prior-phases', '--verbose'].includes(option)) {
    throw new Error(`Unknown Phase 4 verification option: ${option}`);
  }
}
const quick = options.has('--quick');
if (quick && options.has('--with-prior-phases')) {
  throw new Error('--quick and --with-prior-phases cannot be combined.');
}
const verbose = options.has('--verbose');
const logDirectory = mkdtempSync(join(tmpdir(), 'archboard-phase4-'));
process.stdout.write(`Phase 4 check logs: ${logDirectory}\n`);
const environmentPath = join(workspace, '.env');
const localEnvironmentPath = join(workspace, '.env.local');
if (!quick && !existsSync(environmentPath)) {
  throw new Error('An ignored root .env with paired pooled and direct database URLs is required.');
}
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
if (existsSync(localEnvironmentPath)) process.loadEnvFile(localEnvironmentPath);
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_DIRECT_URL = process.env.DATABASE_URL_UNPOOLED;
}
if (!quick && (!process.env.DATABASE_URL || !process.env.DATABASE_DIRECT_URL)) {
  throw new Error(
    'Paired pooled and direct database URLs are required for the real PostgreSQL gate.',
  );
}
if (!quick) {
  const pooled = new URL(process.env.DATABASE_URL);
  const direct = new URL(process.env.DATABASE_DIRECT_URL);
  if (
    !pooled.hostname.includes('-pooler.') ||
    direct.hostname.includes('-pooler.') ||
    pooled.pathname !== direct.pathname ||
    pooled.username !== direct.username
  ) {
    throw new Error(
      'The database URLs must pair pooled and direct endpoints for one database role.',
    );
  }
}

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  PUBLIC_API_ORIGIN: 'http://localhost:3000',
  ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
  PORT: '3000',
  BETTER_AUTH_SECRET: 'phase4-verification-secret-32chars',
  VITE_API_ORIGIN: 'https://api.archboard.local',
  VITE_WS_ORIGIN: 'wss://api.archboard.local',
};
const buildEnvironment = { ...testEnvironment, NODE_ENV: 'production' };
const failedChecks = [];

function run(label, executable, args, environment = testEnvironment, cwd = workspace) {
  process.stdout.write(`Phase 4 check: ${label} ...\n`);
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const logPath = join(logDirectory, `${label.replaceAll(/[^a-z0-9]+/gi, '-')}.log`);
  writeFileSync(logPath, output);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (verbose) process.stdout.write(output);
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status}`;
    failedChecks.push(`${label}: ${reason}`);
    process.stderr.write(`FAIL ${label} (${seconds}s; ${reason}; ${logPath})\n`);
    if (!verbose) process.stderr.write(`${output.trim().split(/\r?\n/).slice(-60).join('\n')}\n`);
  } else {
    process.stdout.write(`PASS ${label} (${seconds}s)\n`);
  }
  return { ...result, output };
}

const pnpm = (label, args, environment) =>
  run(label, process.execPath, [packageManagerScript, ...args], environment);

if (!quick) pnpm('frozen install', ['install', '--frozen-lockfile']);
pnpm('format', ['format:check']);
pnpm('lint', ['lint']);
pnpm('types', ['typecheck']);
pnpm('workspace units (includes native browser)', ['test']);
pnpm('workspace build', ['build'], buildEnvironment);

if (!quick) {
  pnpm('real PostgreSQL integration', ['test:integration']);
  pnpm('Better Auth schema', ['auth:schema:check']);
  const migrationResult = pnpm('migration state', ['db:migration:show']);
  if (migrationResult.status === 0 && /^\[ \] /m.test(migrationResult.output)) {
    failedChecks.push('migration state: unapplied migration');
    process.stderr.write('Phase 4 check failed: an unapplied migration is present.\n');
  }
  pnpm('dependency boundaries', ['boundary:check']);
  pnpm('API secret scan', ['--filter', '@archboard/api', 'security:scan']);
  run('production web bundle scan', process.execPath, [
    join(workspace, 'scripts/check-web-bundle.mjs'),
  ]);

  if (options.has('--with-prior-phases')) {
    for (const phase of ['phase1:verify', 'phase2:verify', 'phase3:verify']) {
      pnpm(`prior regression ${phase}`, [phase]);
    }
  }

  const browserEnvironment = {
    ...buildEnvironment,
    VITE_API_ORIGIN: 'http://127.0.0.1:4174',
    VITE_WS_ORIGIN: 'ws://127.0.0.1:4174',
  };
  pnpm(
    'served-browser asset build',
    ['--filter', '@archboard/web', 'build', '--mode', 'test'],
    browserEnvironment,
  );
  for (const [label, script] of [
    ['authenticated editor browser', 'p4-10-live-browser.mjs'],
    ['presence and drag browser', 'p4-11-presence-browser.mjs'],
    ['explicit recovery browser', 'p4-12-recovery-browser.mjs'],
  ]) {
    run(
      label,
      process.execPath,
      [
        '--env-file=../../.env',
        '--env-file=../../.env.local',
        join(workspace, 'apps/api/scripts', script),
      ],
      browserEnvironment,
      join(workspace, 'apps/api'),
    );
  }

  run('typical and limit worker measurement', process.execPath, [
    join(workspace, 'apps/api/scripts/measure-validation.mjs'),
  ]);
  run(
    'five-user collaboration measurement',
    process.execPath,
    [
      '--env-file=../../.env',
      '--env-file=../../.env.local',
      join(workspace, 'apps/api/scripts/p4-12-measure-browser.mjs'),
    ],
    browserEnvironment,
    join(workspace, 'apps/api'),
  );
}
if (failedChecks.length > 0) {
  throw new Error(`Phase 4 automated gate failed:\n- ${failedChecks.join('\n- ')}`);
}
process.stdout.write(
  quick
    ? '\nPhase 4 quick checks passed; database and live-browser gates were not run.\n'
    : '\nPhase 4 automated gate passed. Review the measured and human evidence separately.\n',
);
