import { spawnSync } from 'node:child_process';

const FILTER_OPTION = '--filter';
const argumentList = process.argv.slice(2);
const filterOptionIndex = argumentList.indexOf(FILTER_OPTION);
const filterPattern = filterOptionIndex === -1 ? undefined : argumentList[filterOptionIndex + 1];

if (filterOptionIndex !== -1 && !filterPattern) {
  throw new Error(`${FILTER_OPTION} requires a test-name pattern.`);
}

const unexpectedArguments =
  filterOptionIndex === -1
    ? argumentList
    : argumentList.filter(
        (_argument, index) => index !== filterOptionIndex && index !== filterOptionIndex + 1,
      );

if (unexpectedArguments.length > 0) {
  throw new Error(`Unsupported test arguments: ${unexpectedArguments.join(' ')}`);
}

const packageManagerScript = process.env.npm_execpath;
if (!packageManagerScript) {
  throw new Error('The workspace test runner must be invoked through pnpm.');
}

const packageManagerArguments = ['-r', '--if-present', 'run', 'test'];

if (filterPattern) {
  packageManagerArguments.push('--', filterPattern);
}

const result = spawnSync(process.execPath, [packageManagerScript, ...packageManagerArguments], {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
