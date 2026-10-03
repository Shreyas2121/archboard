import { writeFile } from 'node:fs/promises';
import { shellSecurityHeaders } from '../apps/web/security-policy.mjs';

export function caddySecurityHeaders() {
  return `# Generated from apps/web/security-policy.mjs; do not edit.\nheader {\n${Object.entries({
    ...shellSecurityHeaders(),
    'Strict-Transport-Security': 'max-age=31536000',
  })
    .map(([name, value]) => `    ${name} "${value}"`)
    .join('\n')}\n}\n`;
}
await writeFile(new URL('./security-headers.caddy', import.meta.url), caddySecurityHeaders());
