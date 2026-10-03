import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shellSecurityHeaders } from '../../apps/web/security-policy.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function packageSources() {
  // Read only the committed nonsecret example; never load a configured production env.
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      'ops/production.env.example',
      '-f',
      'ops/compose.yaml',
      'config',
      '--format',
      'json',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error('Compose parser unavailable or invalid package; output withheld.');
  const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
  return {
    compose: JSON.parse(result.stdout),
    dockerfile: await read('ops/Dockerfile'),
    caddy: await read('ops/Caddyfile'),
    headers: await read('ops/security-headers.caddy'),
    ignore: await read('.dockerignore'),
  };
}
export function validatePackage({ compose, dockerfile, caddy, headers, ignore }) {
  const { postgres, api, caddy: proxy } = compose.services;
  assert.deepEqual(Object.keys(compose.services).sort(), ['api', 'caddy', 'postgres']);
  assert.equal(api.deploy.replicas, 1);
  assert.equal(api.container_name, 'archboard-api');
  assert.equal(api.init, true);
  assert.equal(api.read_only, true);
  assert.equal(api.stop_grace_period, '30s');
  assert.deepEqual(api.tmpfs, ['/tmp:rw,noexec,nosuid,size=32m']);
  assert.equal(postgres.ports, undefined);
  assert.equal(api.ports, undefined);
  assert.equal(compose.networks.database.internal, true);
  assert.equal(postgres.logging.driver, 'none');
  assert.ok(/^postgres:\d+\.\d+-bookworm$/.test(postgres.image));
  assert.ok(api.secrets.length >= 4 && proxy.secrets === undefined);
  assert.ok(postgres.volumes.some((volume) => volume.target === '/var/lib/postgresql/data'));
  assert.equal(api.environment.PUBLIC_API_ORIGIN, api.environment.ALLOWED_WEB_ORIGINS);
  assert.ok(!('DATABASE_URL' in api.environment) && !('BETTER_AUTH_SECRET' in api.environment));
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /pnpm install --prod --frozen-lockfile --ignore-scripts/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /COPY --from=build[^\n]*\/apps\/api\/dist/);
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/web\/dist \/srv/);
  assert.doesNotMatch(dockerfile, /CMD[^\n]*migrat|pm2|cluster|@latest/);
  assert.match(caddy, /level FATAL/);
  assert.match(
    caddy,
    /@protected path \/api \/api\/\* \/auth \/auth\/\* \/ws \/ws\/\* \/health \/health\/\*/,
  );
  assert.ok(caddy.indexOf('handle @protected') < caddy.indexOf('rewrite * /index.html'));
  assert.match(caddy, /handle \/assets\/\*\s*\{[^}]*file_server/s);
  assert.doesNotMatch(caddy, /try_files|log\s*\{|tls_insecure_skip_verify|lb_try_duration/);
  for (const [name, value] of Object.entries(shellSecurityHeaders()))
    assert.ok(headers.includes(`${name} "${value}"`));
  for (const excluded of [
    '.git',
    '.env',
    '.env.*',
    '**/node_modules',
    'ops/secrets',
    'ops/production.env',
  ])
    assert.ok(ignore.split(/\r?\n/).includes(excluded));
  // Source-level brace check only; native Caddy adapter remains a separate required check.
  const blocks = caddy.replace(/#[^\n]*|"[^"]*"|\{[^{}\s]+\}/g, '');
  let depth = 0;
  for (const token of blocks.match(/[{}]/g) ?? []) {
    depth += token === '{' ? 1 : -1;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
}
