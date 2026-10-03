import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKEND_SECRET_NAMES,
  privateArtifactFindings,
} from '../../../scripts/security/artifact-policy.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const inputs = [
  join(root, 'apps/web/src'),
  join(root, 'apps/web/index.html'),
  join(root, 'apps/web/dist'),
];
const extensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.html',
  '.css',
  '.json',
  '.svg',
  '.map',
]);
const secretNames = BACKEND_SECRET_NAMES;
const secretValues = secretNames
  .map((name) => process.env[name])
  .filter((value) => value?.length >= 8);
let scanned = 0;
let findings = 0;

async function scan(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOTDIR' && error?.code !== 'ENOENT') throw error;
    if (error?.code === 'ENOENT') return;
    entries = null;
  }
  if (entries) {
    for (const entry of entries) await scan(join(path, entry.name));
    return;
  }
  if (!extensions.has(extname(path))) return;
  scanned += 1;
  const contents = await readFile(path, 'utf8');
  if (
    secretNames.some((name) => contents.includes(name)) ||
    privateArtifactFindings(contents, secretValues) > 0
  ) {
    findings += 1;
  }
}

for (const input of inputs) await scan(input);
if (findings > 0) {
  process.stderr.write(`Public asset secret scan failed: ${findings} matching files.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public asset secret scan passed: ${scanned} files.\n`);
}
