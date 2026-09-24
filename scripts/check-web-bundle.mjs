import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildDirectory = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const textExtensions = new Set(['.js', '.css', '.html']);
const forbiddenPatterns = [
  ['backend database URL name', /\bDATABASE_(?:DIRECT_)?URL(?:_UNPOOLED)?\b/i],
  ['backend authentication secret name', /\bBETTER_AUTH_SECRET\b/i],
  ['backend GitHub OAuth setting name', /\bGITHUB_CLIENT_(?:ID|SECRET)\b/i],
  ['Postgres connection URL', /postgres(?:ql)?:\/\//i],
  ['shadcn runtime registry', /ui\.shadcn\.com/i],
  [
    'runtime CDN',
    /(?:cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|cdnjs\.cloudflare\.com)/i,
  ],
];

function filesWithin(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesWithin(path) : [path];
  });
}

let inspectedFiles = 0;
for (const path of filesWithin(buildDirectory)) {
  const extension = path.slice(path.lastIndexOf('.'));
  if (!textExtensions.has(extension)) continue;
  inspectedFiles += 1;
  const source = readFileSync(path, 'utf8');
  for (const [label, pattern] of forbiddenPatterns) {
    if (pattern.test(source)) throw new Error(`${label} found in ${path}.`);
  }
}
if (inspectedFiles === 0) throw new Error('No production web text assets were found to inspect.');
process.stdout.write(
  `Web bundle audit passed: ${inspectedFiles} JS/CSS/HTML assets, no backend secret names or runtime CDN references.\n`,
);
