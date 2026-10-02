import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePhase7Plan, parsePhase7Mode, phase7ChildResult } from './phase7-check-plan.mjs';

const mode = parsePhase7Mode(process.argv.slice(2));
const root = fileURLToPath(new URL('..', import.meta.url));
const pnpmScript = process.env.npm_execpath;
if (!pnpmScript) throw new Error('Run phase7:verify through pnpm.');
// Implementation mode never loads database environment files or connects to a database.
if (mode !== 'implementation') {
  for (const name of ['.env', '.env.local']) {
    const path = join(root, name);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
const environment = { ...process.env, CI: 'true', NODE_ENV: 'test', NO_COLOR: '1' };
delete environment.FORCE_COLOR;
if (mode === 'implementation') {
  for (const name of Object.keys(environment))
    if (/^(?:DATABASE_|PG|NEON_|BETTER_AUTH_SECRET|GITHUB_CLIENT_SECRET)/.test(name))
      delete environment[name];
} else if (environment.DATABASE_URL_UNPOOLED) {
  environment.DATABASE_DIRECT_URL = environment.DATABASE_URL_UNPOOLED;
}
const buildEnvironment = {
  ...environment,
  NODE_ENV: 'production',
  VITE_API_ORIGIN: mode === 'full' ? environment.P7_API_ORIGIN : 'https://api.archboard.local',
  VITE_WS_ORIGIN:
    mode === 'full' && environment.P7_API_ORIGIN
      ? environment.P7_API_ORIGIN.replace(/^http/, 'ws')
      : 'wss://api.archboard.local',
};
const directory = mkdtempSync(join(tmpdir(), 'archboard-phase7-'));
process.stdout.write(`Phase 7 mode: ${mode}. Sanitized report directory: ${directory}\n`);

const run = async (check) => {
  const started = performance.now();
  const args = check.runner === 'pnpm' ? [pnpmScript, ...check.args] : check.args;
  process.stdout.write(`RUN ${check.id}\n`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: join(root, check.cwd ?? ''),
      env: check.production ? buildEnvironment : environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errored = false;
    // Raw test failures may contain cookies, bearer URLs or bodies. Keep them only in
    // process memory; persist numeric/fixed-label summaries, never raw child logs.
    const capture = (data) => {
      output = (output + data.toString()).slice(-8 * 1024 * 1024);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const heartbeat = setInterval(
      () => process.stdout.write(`RUN ${check.id} (still running)\n`),
      30_000,
    );
    child.on('error', () => {
      errored = true;
    });
    child.on('close', (code) => {
      clearInterval(heartbeat);
      const result = {
        ...phase7ChildResult(check, output, code, errored),
        durationMs: Math.round(performance.now() - started),
        command: ['node', ...(check.runner === 'pnpm' ? ['<pnpm>', ...check.args] : args)],
        cwd: check.cwd ?? '.',
      };
      process.stdout.write(
        `${result.status} ${check.id} (${result.durationMs} ms${result.tests ? `; ${result.tests} tests` : ''})\n`,
      );
      output = '';
      resolve(result);
    });
  });
};
const report = await executePhase7Plan(mode, run);
const reportPath = join(directory, 'report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const scan = await run({
  id: 'sanitized-report-secret-scan',
  runner: 'node',
  args: ['scripts/check-phase7-evidence.mjs', '--report', reportPath],
});
report.results.push({ id: 'sanitized-report-secret-scan', boundary: 'implementation', ...scan });
if (scan.status !== 'PASS') {
  report.exitCode = 1;
  report.fullGate = 'OPEN';
}
for (const row of report.results.filter(({ status }) => status === 'UNRUN'))
  process.stdout.write(`UNRUN ${row.id} (${row.reason})\n`);
const counts = Object.fromEntries(
  ['PASS', 'FAIL', 'UNRUN'].map((status) => [
    status,
    report.results.filter((row) => row.status === status).length,
  ]),
);
writeFileSync(
  join(directory, 'report.json'),
  `${JSON.stringify({ ...report, counts }, null, 2)}\n`,
);
process.stdout.write(
  `Phase 7 ${mode} checks: ${JSON.stringify(counts)}. Full gate: ${report.fullGate}.\n`,
);
process.exitCode = report.exitCode;
