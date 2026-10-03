import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { contentSecurityPolicy, shellSecurityHeaders } from './security-policy.mjs';

const MAX_PRECACHE_BYTES = 2_097_152;

export default defineConfig(({ command, mode }) => {
  const envDir = fileURLToPath(new URL('../..', import.meta.url));
  const environment = loadEnv(mode, envDir, 'VITE_');
  const connectionOrigins = [environment.VITE_API_ORIGIN, environment.VITE_WS_ORIGIN].filter(
    (origin): origin is string => Boolean(origin),
  );
  const development = command === 'serve' && mode !== 'production';
  const headers = shellSecurityHeaders(development, connectionOrigins);
  return {
    server: { headers },
    preview: { headers },
    envDir,
    plugins: [
      {
        name: 'archboard-security-policy',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            html.replace('%ARCHBOARD_CSP%', contentSecurityPolicy(development, connectionOrigins)),
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'Archboard',
          short_name: 'Archboard',
          description: 'Collaborative architecture editor',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        },
        includeAssets: ['favicon.svg'],
        workbox: {
          globPatterns: ['**/*.{html,js,css,woff,woff2,svg,png,webp,ico,wasm}'],
          maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
          navigateFallback: '/index.html',
          navigateFallbackAllowlist: [
            /^\/$/,
            /^\/demo\/?$/,
            /^\/boards\/?$/,
            /^\/boards\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i,
          ],
          navigateFallbackDenylist: [
            /^\/api(?:\/|$)/,
            /^\/ws(?:\/|$)/,
            /^\/auth(?:\/|$)/,
            /^\/health(?:\/|$)/,
            /^\/assets(?:\/|$)/,
            /^\/invite(?:s)?(?:\/|$)/,
          ],
          runtimeCaching: [],
          importScripts: ['/worker-compatibility.js'],
          skipWaiting: false,
          clientsClaim: false,
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // The client receives an explicit API origin; server environment discovery is unused.
        '@better-auth/core/env': fileURLToPath(
          new URL('./src/platform/config/better-auth-browser-env.ts', import.meta.url),
        ),
      },
    },
  };
});
