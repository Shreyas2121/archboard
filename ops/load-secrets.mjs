import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_NAMES = [
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_SECRET',
];
export async function loadRuntimeSecrets(environment, reader = readFile) {
  const result = { ...environment };
  for (const name of SECRET_NAMES) {
    const path = result[`${name}_FILE`];
    if (!path) continue;
    if (result[name]) throw new Error('Conflicting runtime secret sources.');
    const value = (await reader(path, 'utf8')).trim();
    if (!value || value.length > 16_384 || /[\r\n\0]/.test(value))
      throw new Error('Invalid runtime secret file.');
    result[name] = value;
    delete result[`${name}_FILE`];
  }
  return result;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    Object.assign(process.env, await loadRuntimeSecrets(process.env));
    const mode = process.argv[2];
    if (mode === 'migrate') {
      // Explicit operator-only invocation, never the normal startup path.
      const { default: source } =
        await import('../apps/api/dist/platform/database/migration-data-source.js');
      try {
        await source.initialize();
        await source.runMigrations({ transaction: 'all' });
        process.stdout.write('PASS explicit migrations completed.\n');
      } finally {
        if (source.isInitialized) await source.destroy();
      }
    } else if (mode === undefined) await import('../apps/api/dist/main.js');
    else throw new Error('Unknown runtime command.');
  } catch {
    process.stderr.write('FAIL runtime configuration/startup; details withheld.\n');
    process.exit(1);
  }
}
