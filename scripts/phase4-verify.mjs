import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('phase4:verify must be invoked through pnpm.');
const environmentPath = join(workspace, '.env');
const localEnvironmentPath = join(workspace, '.env.local');
if (!existsSync(environmentPath)) {
  throw new Error('An ignored root .env with paired pooled and direct database URLs is required.');
}
process.loadEnvFile(environmentPath);
if (existsSync(localEnvironmentPath)) process.loadEnvFile(localEnvironmentPath);
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_DIRECT_URL = process.env.DATABASE_URL_UNPOOLED;
}
if (!process.env.DATABASE_URL || !process.env.DATABASE_DIRECT_URL) {
  throw new Error(
    'Paired pooled and direct database URLs are required for the real PostgreSQL gate.',
  );
}
const pooled = new URL(process.env.DATABASE_URL);
const direct = new URL(process.env.DATABASE_DIRECT_URL);
if (
  !pooled.hostname.includes('-pooler.') ||
  direct.hostname.includes('-pooler.') ||
  pooled.pathname !== direct.pathname ||
  pooled.username !== direct.username
) {
  throw new Error('The database URLs must pair pooled and direct endpoints for one database role.');
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
  process.stdout.write(`\nPhase 4 check: ${label}\n`);
  const result = spawnSync(executable, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status}`;
    failedChecks.push(`${label}: ${reason}`);
    process.stderr.write(`Phase 4 check failed: ${label} (${reason}).\n`);
  }
}

const pnpm = (label, args, environment) =>
  run(label, process.execPath, [packageManagerScript, ...args], environment);

pnpm('frozen install', ['install', '--frozen-lockfile']);
pnpm('format', ['format:check']);
pnpm('lint', ['lint']);
pnpm('types', ['typecheck']);
pnpm('workspace units', ['test']);
pnpm('native browser package tests', ['test:browser']);
pnpm('real PostgreSQL integration', ['test:integration']);
pnpm('Better Auth schema', ['auth:schema:check']);
process.stdout.write('\nPhase 4 check: migration state\n');
const migrationResult = spawnSync(process.execPath, [packageManagerScript, 'db:migration:show'], {
  cwd: workspace,
  env: testEnvironment,
  encoding: 'utf8',
});
process.stdout.write(migrationResult.stdout ?? '');
process.stderr.write(migrationResult.stderr ?? '');
if (migrationResult.error || migrationResult.status !== 0) {
  failedChecks.push(`migration state: ${migrationResult.error?.message ?? migrationResult.status}`);
} else if (/^\[ \] /m.test(migrationResult.stdout ?? '')) {
  failedChecks.push('migration state: unapplied migration');
  process.stderr.write('Phase 4 check failed: an unapplied migration is present.\n');
}
pnpm('API build', ['--filter', '@archboard/api', 'build'], buildEnvironment);
pnpm('web build', ['--filter', '@archboard/web', 'build'], buildEnvironment);
pnpm('workspace build', ['build'], buildEnvironment);
pnpm('dependency boundaries', ['boundary:check']);
pnpm('API secret scan', ['--filter', '@archboard/api', 'security:scan']);
run('production web bundle scan', process.execPath, [
  join(workspace, 'scripts/check-web-bundle.mjs'),
]);

for (const phase of ['phase1:verify', 'phase2:verify', 'phase3:verify']) {
  pnpm(`prior regression ${phase}`, [phase]);
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
for (const task of [
  ['authenticated editor browser', 'p4-10-live-browser.mjs'],
  ['presence and drag browser', 'p4-11-presence-browser.mjs'],
  ['explicit recovery browser', 'p4-12-recovery-browser.mjs'],
]) {
  const [label, script] = task;
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
if (failedChecks.length > 0) {
  throw new Error(`Phase 4 automated gate failed:\n- ${failedChecks.join('\n- ')}`);
}
process.stdout.write(
  '\nPhase 4 automated gate passed. Review the measured and human evidence separately.\n',
);
