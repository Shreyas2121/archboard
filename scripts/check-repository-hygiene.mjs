import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const generatedDirectory =
  /(?:^|\/)(?:node_modules|dist|coverage|\.tmp|\.turbo|\.vite|\.vitest|test-results|playwright-report)(?:\/|$)/;
const localScratch = /(?:^|\/)\.tmp-[^/]+/;
const projectDiagram = /^archboard(?:\.[^/]+-context\.json|-[^/]+\.(?:png|svg))$/;
const privateEnvironment = /(?:^|\/)\.env(?:\.[^/]+)?$/;
const forbiddenPaths = (paths) =>
  paths.filter(
    (path) =>
      generatedDirectory.test(path) ||
      localScratch.test(path) ||
      projectDiagram.test(path) ||
      (privateEnvironment.test(path) && !path.endsWith('.example')) ||
      path === 'prompt.txt' ||
      path === '.neon' ||
      path === 'archboard.env' ||
      path === 'ops/production.env' ||
      path.startsWith('ops/secrets/') ||
      /\.(?:log|tsbuildinfo)$/.test(path) ||
      /(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(path),
  );

const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== '--outgoing'))
  throw new Error('Usage: node scripts/check-repository-hygiene.mjs [--outgoing]');

const checks = [{ label: 'Git index', paths: tracked }];
if (arguments_.includes('--outgoing')) {
  const outgoing = execFileSync(
    'git',
    [
      'log',
      '-z',
      '--format=',
      '--name-only',
      '--diff-filter=AMT',
      '--no-renames',
      'origin/main..HEAD',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .split('\0')
    .map((path) => path.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean);
  checks.push({ label: 'Outgoing history since origin/main', paths: [...new Set(outgoing)] });
}

for (const check of checks) {
  const forbidden = forbiddenPaths(check.paths);
  if (!forbidden.length) continue;
  process.stderr.write(
    `Repository hygiene failed (${check.label}): ${forbidden.length} local/generated/private paths:\n${forbidden.join('\n')}\n`,
  );
  process.exitCode = 1;
}
if (!process.exitCode) {
  process.stdout.write(
    `Repository hygiene passed: ${tracked.length} indexed paths${checks.length > 1 ? ' and outgoing history' : ''}; no tracked scratch files, local project exports, private environment files or build output.\n`,
  );
}
