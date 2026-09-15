import { spawnSync } from 'node:child_process';

const patterns = process.argv.slice(2).filter((argument) => argument !== '--');
const targets = patterns.some((pattern) => pattern.includes('ytext'))
  ? ['@archboard/web']
  : patterns.some((pattern) => pattern.includes('indexeddb') || pattern.includes('outbox'))
    ? ['@archboard/sync-client']
    : ['@archboard/sync-client', '@archboard/web'];
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('Browser unit tests must be invoked through pnpm.');

for (const target of targets) {
  const command = [
    '--filter',
    target,
    'run',
    target === '@archboard/web' ? 'test:browser' : 'test',
  ];
  if (patterns.length > 0) command.push('--', ...patterns);
  const result = spawnSync(packageManagerScript, command, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
