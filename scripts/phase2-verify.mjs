import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('phase2:verify must be invoked through pnpm.');

const productionEnvironment = {
  ...process.env,
  VITE_API_ORIGIN: 'https://api.archboard.local',
  VITE_WS_ORIGIN: 'wss://api.archboard.local',
};
const checks = [
  ['format:check', ['format:check']],
  ['lint', ['lint']],
  ['typecheck', ['typecheck']],
  ['workspace unit tests', ['test']],
  ['sync-client real-browser tests', ['test:browser']],
  ['independent web build', ['--filter', '@archboard/web', 'build']],
  ['workspace build', ['build']],
  ['dependency boundaries', ['boundary:check']],
];

for (const [label, argumentsForPnpm] of checks) {
  process.stdout.write(`\nPhase 2 check: ${label}\n`);
  const result = spawnSync(process.execPath, [packageManagerScript, ...argumentsForPnpm], {
    cwd: workspace,
    env: productionEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit status ${result.status ?? 'unknown'}.`);
  }
}

process.stdout.write('\nPhase 2 check: production bundle secrets and CDN references\n');
const bundleAudit = spawnSync(process.execPath, [join(workspace, 'scripts/check-web-bundle.mjs')], {
  cwd: workspace,
  stdio: 'inherit',
});
if (bundleAudit.error) throw bundleAudit.error;
if (bundleAudit.status !== 0) {
  throw new Error(
    `Production bundle audit failed with exit status ${bundleAudit.status ?? 'unknown'}.`,
  );
}
process.stdout.write('\nPhase 2 static, package, browser, boundary, and build checks passed.\n');
