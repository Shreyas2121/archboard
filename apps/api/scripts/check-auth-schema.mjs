import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const SCHEMA_PREFIX = 'archboard_auth_schema_check_';
const PROCESS_SUCCESS = 0;
const { Pool } = pg;
const directUrl = process.env.DATABASE_DIRECT_URL;
const authCliPath = fileURLToPath(new URL('../node_modules/auth/dist/index.mjs', import.meta.url));

if (directUrl === undefined || directUrl.length === 0) {
  throw new Error('DATABASE_DIRECT_URL is required for auth:schema:check.');
}

const schemaName = `${SCHEMA_PREFIX}${process.pid}`;
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'archboard-auth-schema-'));
const generatedPath = join(temporaryDirectory, 'auth-schema.sql');
const pool = new Pool({ connectionString: directUrl, max: 1 });

function schemaUrl(connectionString, schema) {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

function normalize(sql) {
  return sql.replaceAll('\r\n', '\n').trim();
}

async function runGenerator(connectionString) {
  const child = spawn(
    process.execPath,
    [
      authCliPath,
      'generate',
      '--config',
      'src/modules/auth/infrastructure/auth.cli.ts',
      '--output',
      generatedPath,
      '--yes',
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN ?? 'http://localhost:3000',
        ALLOWED_WEB_ORIGINS: process.env.ALLOWED_WEB_ORIGINS ?? 'http://localhost:5173',
        PORT: process.env.PORT ?? '3000',
        DATABASE_URL: connectionString,
        DATABASE_DIRECT_URL: connectionString,
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ?? 'schema-generation-only-secret-32-chars',
      },
      stdio: 'inherit',
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== PROCESS_SUCCESS) throw new Error(`Better Auth schema generation failed.`);
}

try {
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await runGenerator(schemaUrl(directUrl, schemaName));
  const [expected, generated] = await Promise.all([
    readFile(new URL('../src/platform/database/auth-schema.sql', import.meta.url), 'utf8'),
    readFile(generatedPath, 'utf8'),
  ]);
  if (normalize(expected) !== normalize(generated)) {
    throw new Error(
      'Better Auth schema drift detected. Regenerate and review auth-schema.sql and the migration chain.',
    );
  }
  process.stdout.write('Better Auth schema matches the committed SQL.\n');
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
  await pool.end();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
