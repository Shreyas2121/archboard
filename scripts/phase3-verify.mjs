import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const localEnvironmentPath = join(workspace, '.env');
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('phase3:verify must be invoked through pnpm.');
if (!existsSync(localEnvironmentPath)) {
  throw new Error('An ignored root .env with paired pooled and direct database URLs is required.');
}
process.loadEnvFile(localEnvironmentPath);
if (!process.env.DATABASE_URL || !process.env.DATABASE_DIRECT_URL) {
  throw new Error(
    'DATABASE_URL and DATABASE_DIRECT_URL are required for the real PostgreSQL gate.',
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

const environment = {
  ...process.env,
  NODE_ENV: 'test',
  PUBLIC_API_ORIGIN: 'http://localhost:3000',
  ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
  PORT: '3000',
  BETTER_AUTH_SECRET: 'phase3-verification-secret-32chars',
  VITE_API_ORIGIN: 'https://api.archboard.local',
  VITE_WS_ORIGIN: 'wss://api.archboard.local',
};
const productionEnvironment = { ...environment, NODE_ENV: 'production' };

const checks = [
  ['frozen install', ['install', '--frozen-lockfile']],
  ['format', ['format:check']],
  ['lint', ['lint']],
  ['types', ['typecheck']],
  ['workspace units', ['test']],
  ['real-browser package tests', ['test:browser']],
  ['authenticated PostgreSQL integration', ['test:integration']],
  ['Better Auth schema', ['auth:schema:check']],
  ['migration state', ['db:migration:show']],
  ['API build', ['--filter', '@archboard/api', 'build']],
  ['web build', ['--filter', '@archboard/web', 'build']],
  ['workspace build', ['build']],
  ['dependency boundaries', ['boundary:check']],
  ['API secret scan', ['--filter', '@archboard/api', 'security:scan']],
];

for (const [label, args] of checks) {
  process.stdout.write(`\nPhase 3 check: ${label}\n`);
  const result = spawnSync(process.execPath, [packageManagerScript, ...args], {
    cwd: workspace,
    env: label.includes('build') ? productionEnvironment : environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit status ${result.status}.`);
}

process.stdout.write('\nPhase 3 check: production web bundle scan\n');
const scan = spawnSync(process.execPath, [join(workspace, 'scripts/check-web-bundle.mjs')], {
  cwd: workspace,
  env: environment,
  stdio: 'inherit',
});
if (scan.error) throw scan.error;
if (scan.status !== 0) throw new Error(`Web bundle scan failed with exit status ${scan.status}.`);
process.stdout.write(
  '\nPhase 3 automated checks passed. Real GitHub and dashboard browser evidence is recorded separately.\n',
);
