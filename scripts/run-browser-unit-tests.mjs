import { spawnSync } from 'node:child_process';

const patterns = process.argv.slice(2).filter((argument) => argument !== '--');
const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) throw new Error('Browser unit tests must be invoked through pnpm.');

const command = ['--filter', '@archboard/sync-client', 'run', 'test'];
if (patterns.length > 0) command.push(...patterns);
const result = spawnSync(process.execPath, [packageManagerScript, ...command], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
