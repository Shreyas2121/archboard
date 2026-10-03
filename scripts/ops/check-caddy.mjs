// Adapter validation only: no server, application, DB service or readiness probe.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const path = (name) => fileURLToPath(new URL(`../../ops/${name}`, import.meta.url));
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    'none',
    '--env',
    'ARCHBOARD_HOST=archboard.example.com',
    '--mount',
    `type=bind,source=${path('Caddyfile')},target=/etc/caddy/Caddyfile,readonly`,
    '--mount',
    `type=bind,source=${path('security-headers.caddy')},target=/etc/caddy/security-headers.caddy,readonly`,
    'caddy:2.11.6-alpine',
    'caddy',
    'adapt',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
    '--validate',
  ],
  { encoding: 'utf8' },
);
process.stdout.write(
  `${result.status === 0 ? 'PASS' : 'FAIL'} native Caddy adapter; diagnostic output withheld.\n`,
);
if (result.status !== 0) process.exitCode = 1;
