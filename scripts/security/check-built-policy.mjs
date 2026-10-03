import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentSecurityPolicy } from '../../apps/web/security-policy.mjs';

try {
  const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  const { loadEnv } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
  const environment = loadEnv(
    'production',
    fileURLToPath(new URL('../..', import.meta.url)),
    'VITE_',
  );
  const connectionOrigins = [environment.VITE_API_ORIGIN, environment.VITE_WS_ORIGIN].filter(
    Boolean,
  );
  const html = await readFile(new URL('../../apps/web/dist/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`content="${contentSecurityPolicy(false, connectionOrigins)}"`));
  assert.ok(!html.includes('%ARCHBOARD_CSP%'));
  process.stdout.write('PASS generated HTML uses scoped production CSP.\n');
} catch {
  process.stderr.write('FAIL generated HTML security policy; details withheld.\n');
  process.exitCode = 1;
}
