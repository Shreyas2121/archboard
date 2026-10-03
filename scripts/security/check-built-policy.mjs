import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contentSecurityPolicy } from '../../apps/web/security-policy.mjs';

try {
  const html = await readFile(new URL('../../apps/web/dist/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`content="${contentSecurityPolicy()}"`));
  assert.ok(!html.includes('%ARCHBOARD_CSP%'));
  process.stdout.write('PASS generated HTML uses scoped production CSP.\n');
} catch {
  process.stderr.write('FAIL generated HTML security policy; details withheld.\n');
  process.exitCode = 1;
}
