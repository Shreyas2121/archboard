import { cp, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/platform/database/', import.meta.url), { recursive: true });
await cp(
  new URL('../src/platform/database/auth-schema.sql', import.meta.url),
  new URL('../dist/platform/database/auth-schema.sql', import.meta.url),
);
