import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { privateArtifactFindings } from './artifact-policy.mjs';

const root = fileURLToPath(new URL('../../docs/evidence/phase8/', import.meta.url));
let scanned = 0;
let findings = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (['.md', '.json', '.txt', '.log'].includes(extname(path))) {
      scanned++;
      findings += privateArtifactFindings(await readFile(path, 'utf8'));
    }
  }
}
await scan(root);
process.stdout.write(
  `${findings ? 'FAIL' : 'PASS'} Phase 8 evidence privacy: ${scanned} artifacts, ${findings} findings; values withheld.\n`,
);
if (findings) process.exitCode = 1;
