import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Read local credential values only for comparisons; never output them or use them for requests.
const values = [];
for (const name of ['.env', '.env.local']) {
  const path = join(root, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(
      /^(?:export\s+)?(?:DATABASE_[A-Z_]+|BETTER_AUTH_SECRET|GITHUB_CLIENT_SECRET)\s*=\s*(.*)$/,
    );
    if (match) {
      const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value.length >= 8) values.push(value);
    }
  }
}
const patterns = [
  /postgres(?:ql)?:\/\/[^\s`]+/i,
  /(?:https?:\/\/[^\s`]+)?\/invite\/[A-Za-z0-9_-]{43}(?:\b|[/?#])/,
  /(?:^|\n)\s*(?:cookie|set-cookie|authorization)\s*:/i,
  /(?:access_token|refresh_token|client_secret|tokenHash)\s*[=:]\s*["']?[A-Za-z0-9_-]{24,}/i,
];
function paths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? paths(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}
const inputs = paths(join(root, 'docs/evidence/phase6')).filter(
  (path) => path.endsWith('.md') || path.endsWith('.json') || path.endsWith('.log'),
);
const args = process.argv.slice(2);
if (args.length) {
  if (args.length !== 2 || args[0] !== '--report')
    throw new Error('Expected --report <sanitized report path>.');
  inputs.push(args[1]);
}
let findings = 0;
for (const path of inputs) {
  const source = readFileSync(path, 'utf8');
  if (
    values.some((value) => source.includes(value)) ||
    patterns.some((pattern) => pattern.test(source))
  )
    findings += 1;
}
if (findings) {
  process.stderr.write(
    `FAIL Phase 6 evidence secret scan: ${findings} matching files. Private matches withheld.\n`,
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    `PASS Phase 6 evidence secret scan: ${inputs.length} files. Static evidence scan only.\n`,
  );
