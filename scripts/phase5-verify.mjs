import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpmScript = process.env.npm_execpath;
if (!pnpmScript) throw new Error('Run phase5:verify through pnpm.');
const args = new Set(process.argv.slice(2).filter((arg) => arg !== '--'));
for (const arg of args) {
  if (!['--non-browser', '--verbose'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
}
const nonBrowser = args.has('--non-browser');
const verbose = args.has('--verbose');
const logs = mkdtempSync(join(tmpdir(), 'archboard-phase5-'));
const failures = [];
process.stdout.write(`Phase 5 check logs: ${logs}\n`);
for (const name of ['.env', '.env.local']) {
  const path = join(root, name);
  if (existsSync(path)) process.loadEnvFile(path);
}
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_DIRECT_URL = process.env.DATABASE_URL_UNPOOLED;
}
const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PUBLIC_API_ORIGIN: 'http://localhost:3000',
  ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
  PORT: '3000',
  BETTER_AUTH_SECRET: 'phase5-verification-secret-32chars',
  VITE_API_ORIGIN: 'https://api.archboard.local',
  VITE_WS_ORIGIN: 'wss://api.archboard.local',
};
const buildEnv = { ...testEnv, NODE_ENV: 'production' };

function run(label, command, commandArgs, env = testEnv, cwd = root) {
  process.stdout.write(`Phase 5 check: ${label} ...\n`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const log = join(logs, `${label.replaceAll(/[^a-z0-9]+/gi, '-')}.log`);
  writeFileSync(log, output);
  if (verbose) process.stdout.write(output);
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status}`;
    failures.push(`${label}: ${reason}`);
    process.stderr.write(`FAIL ${label} (${reason}; ${log})\n`);
    if (!verbose) process.stderr.write(`${output.trim().split(/\r?\n/).slice(-25).join('\n')}\n`);
  } else {
    process.stdout.write(`PASS ${label}\n`);
  }
  return result;
}
const pnpm = (label, commandArgs, env) =>
  run(label, process.execPath, [pnpmScript, ...commandArgs], env);
const node = (label, commandArgs, env, cwd) => run(label, process.execPath, commandArgs, env, cwd);

pnpm('frozen install', ['install', '--frozen-lockfile']);
pnpm('format', ['format:check']);
pnpm('lint', ['lint']);
pnpm('types', ['typecheck']);
node('storage state', [
  '--experimental-strip-types',
  '--test',
  'scripts/p5-09-storage-state.node.test.mjs',
]);
pnpm('workspace build', ['build'], buildEnv);
node('update state', [
  '--experimental-strip-types',
  '--test',
  'scripts/p5-08-update-state.node.test.mjs',
]);
node(
  'account selection state',
  ['--test', 'scripts/account-selection.node.test.mjs'],
  testEnv,
  join(root, 'packages/sync-client'),
);
node('production bundle scan', ['scripts/check-web-bundle.mjs'], buildEnv);
node('generated cache policy', ['scripts/check-phase5-cache-policy.mjs'], buildEnv);
pnpm('API unit tests', ['--filter', '@archboard/api', 'test']);
pnpm('real PostgreSQL integration', ['test:integration']);
pnpm('Better Auth schema', ['auth:schema:check']);
const migration = pnpm('configured migration state', ['db:migration:show']);
if (
  migration.status === 0 &&
  /^\[ \] /m.test(`${migration.stdout ?? ''}${migration.stderr ?? ''}`)
) {
  failures.push('configured migration state: unapplied migration');
  process.stderr.write('FAIL configured migration state: unapplied migration\n');
}
pnpm('dependency boundaries', ['boundary:check']);
pnpm('API secret scan', ['--filter', '@archboard/api', 'security:scan']);

if (!nonBrowser) {
  const browserEnv = {
    ...buildEnv,
    VITE_API_ORIGIN: 'http://127.0.0.1:4174',
    VITE_WS_ORIGIN: 'ws://127.0.0.1:4174',
  };
  pnpm('browser package tests', ['test:browser'], browserEnv);
  pnpm(
    'served browser asset build',
    ['--filter', '@archboard/web', 'build', '--mode', 'test'],
    browserEnv,
  );
  for (const script of [
    'p5-01-shell-browser.mjs',
    'p5-03-dashboard-browser.mjs',
    'p5-04-offline-editor-browser.mjs',
  ]) {
    node(`served ${script}`, [join(root, 'apps/web/scripts', script)], browserEnv);
  }
  for (const script of [
    'p4-10-live-browser.mjs',
    'p4-11-presence-browser.mjs',
    'p4-12-recovery-browser.mjs',
  ]) {
    node(
      `served ${script}`,
      [
        '--env-file=../../.env',
        '--env-file=../../.env.local',
        join(root, 'apps/api/scripts', script),
      ],
      browserEnv,
      join(root, 'apps/api'),
    );
  }
  // The combined A07/A10/A22/A24 served proofs are a release gate, not inferred from
  // separate lower-layer tests. Fail closed until their browser harnesses are wired here.
  failures.push('combined served A07/A10/A22/A24 acceptance harnesses are not yet wired');
}
if (failures.length) throw new Error(`Phase 5 gate failed:\n- ${failures.join('\n- ')}`);
process.stdout.write(
  nonBrowser
    ? 'Phase 5 non-browser checks passed. Browser acceptance remains UNRUN (deferred by user).\n'
    : 'Phase 5 automated checks passed. Review human evidence separately.\n',
);
