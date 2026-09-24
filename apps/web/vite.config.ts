import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The client receives an explicit API origin; server environment discovery is unused.
      '@better-auth/core/env': fileURLToPath(
        new URL('./src/platform/config/better-auth-browser-env.ts', import.meta.url),
      ),
    },
  },
});
