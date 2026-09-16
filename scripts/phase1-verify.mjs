import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const localEnvironmentPath = join(workspace, '.env');
const packageManagerScript = process.env.npm_execpath;
const verificationSecret = 'phase1-verification-secret-32chars';

if (!packageManagerScript) throw new Error('phase1:verify must be invoked through pnpm.');
if (!existsSync(localEnvironmentPath)) {
  throw new Error(
    'An ignored root .env with pooled and direct database URLs is required for the real Phase 1 gate.',
  );
}
process.loadEnvFile(localEnvironmentPath);

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DATABASE_DIRECT_URL;
if (!pooledUrl || !directUrl) {
  throw new Error(
    'Both DATABASE_URL and DATABASE_DIRECT_URL are required; no connection values are logged.',
  );
}

const pooled = new URL(pooledUrl);
const direct = new URL(directUrl);
if (
  !pooled.hostname.includes('-pooler.') ||
  direct.hostname.includes('-pooler.') ||
  pooled.pathname !== direct.pathname ||
  pooled.username !== direct.username
) {
  throw new Error(
    'The Phase 1 database URLs must pair one pooled and one direct endpoint for the same database and role.',
  );
}
process.stdout.write(
  'Phase 1 database endpoint shape: pooled runtime and direct migration/session endpoint verified; credentials withheld.\n',
);

const verificationEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  PUBLIC_API_ORIGIN: 'http://localhost:3000',
  ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
  PORT: '3000',
  BETTER_AUTH_SECRET: verificationSecret,
};
const productionWebOrigin = 'https://archboard.vercel.app';
const productionApiOrigin = 'https://archboard-api.onrender.com';
const productionEnvironment = {
  ...verificationEnvironment,
  NODE_ENV: 'production',
  PUBLIC_API_ORIGIN: productionApiOrigin,
  ALLOWED_WEB_ORIGINS: productionWebOrigin,
  VITE_API_ORIGIN: productionApiOrigin,
  VITE_WS_ORIGIN: 'wss://archboard-api.onrender.com',
};

const checks = [
  ['install --frozen-lockfile', ['install', '--frozen-lockfile']],
  ['format:check', ['format:check']],
  ['lint', ['lint']],
  ['typecheck', ['typecheck']],
  ['test', ['test']],
  ['test:integration', ['test:integration']],
  ['test:browser', ['test:browser']],
  ['API independent build', ['--filter', '@archboard/api', 'build']],
  ['web independent build', ['--filter', '@archboard/web', 'build']],
  ['build', ['build']],
  ['db:migration:show', ['db:migration:show']],
  ['auth:schema:check', ['auth:schema:check']],
  ['validation measurement', ['--filter', '@archboard/api', 'phase1:measure-validation']],
];

for (const [label, argumentsForPnpm] of checks) {
  process.stdout.write(`\nPhase 1 check: ${label}\n`);
  const result = spawnSync(packageManagerScript, argumentsForPnpm, {
    cwd: workspace,
    env: label.includes('build') ? productionEnvironment : verificationEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit status ${result.status ?? 'unknown'}.`);
  }
}

const { loadApiConfig } = await import('../apps/api/dist/platform/config/index.js');
const topologyConfig = loadApiConfig(productionEnvironment);
if (
  topologyConfig.publicApiOrigin !== productionApiOrigin ||
  !topologyConfig.allowedWebOrigins.includes(productionWebOrigin)
) {
  throw new Error('The Vercel-to-Render origin fixture failed API validation.');
}
process.stdout.write(
  'Secure Vercel-to-Render origin fixture passes API validation; deployment remains unverified.\n',
);

const boundaryCheck = spawnSync(
  process.execPath,
  [join(workspace, 'scripts/check-phase1-boundaries.mjs')],
  {
    cwd: workspace,
    env: verificationEnvironment,
    stdio: 'inherit',
  },
);
if (boundaryCheck.error) throw boundaryCheck.error;
if (boundaryCheck.status !== 0) throw new Error('Phase 1 dependency boundary audit failed.');

process.stdout.write(
  '\nPhase 1 verification commands passed. See docs/phase-1-compatibility.md for exit status and limitations.\n',
);
