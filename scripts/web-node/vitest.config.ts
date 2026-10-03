import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../apps/web/', import.meta.url)),
  // The verification owner is outside apps/web; reuse its pinned public dependencies.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
      ...Object.fromEntries(
        [
          '@archboard/contracts',
          '@archboard/document-model',
          '@archboard/fixtures',
          '@archboard/sync-client',
          'yjs',
          'zod',
        ].map((name) => [
          name,
          fileURLToPath(new URL('../../apps/web/node_modules/' + name, import.meta.url)),
        ]),
      ),
    },
  },
  test: { environment: 'node', include: ['../../scripts/web-node/**/*.test.ts'] },
});
