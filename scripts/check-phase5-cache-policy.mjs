import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'apps/web/dist');
const worker = readFileSync(join(dist, 'sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
const match = worker.match(/\.precacheAndRoute\((\[.*?\]),\{\}\)/);
if (!match) throw new Error('Generated service-worker precache manifest was not found.');
const urls = [...match[1].matchAll(/\burl:"([^"]+)"/g)].map((entry) => entry[1]);
if (urls.length === 0) throw new Error('Generated precache manifest contains no URLs.');
const required = [
  ['HTML shell', (url) => url === 'index.html'],
  ['compatibility worker', (url) => url === 'worker-compatibility.js'],
  ['application JavaScript', (url) => /^assets\/index-.+\.js$/.test(url)],
  ['local font', (url) => url.endsWith('.woff2')],
  ['local icon', (url) => url === 'favicon.svg'],
];
for (const [name, predicate] of required) {
  if (!urls.some(predicate)) throw new Error(`Precache is missing ${name}.`);
}
for (const url of urls) {
  if (
    /^(?:https?:)?\/\//i.test(url) ||
    /(?:^|\/)(?:api|auth|ws|health|invites?)(?:\/|$)/i.test(url)
  ) {
    throw new Error('Protected or remote URL is precached; value withheld.');
  }
}
if (
  !worker.includes('NavigationRoute') ||
  !worker.includes('createHandlerBoundToURL("/index.html")')
) {
  throw new Error('Generated worker has no navigation fallback to the app shell.');
}
for (const route of ['demo', 'boards', 'api', 'ws', 'auth', 'health', 'assets', 'invite']) {
  if (!worker.includes(`\\/${route}`)) throw new Error(`Navigation policy omits ${route}.`);
}
if (worker.includes('clientsClaim()') || !worker.includes('"SKIP_WAITING"')) {
  throw new Error('Generated worker forces client takeover or unconditional activation.');
}
if (worker.includes('.registerRoute(') && worker.match(/\.registerRoute\(/g)?.length !== 1) {
  throw new Error('Generated worker has an unexpected runtime caching route.');
}
if (manifest.start_url !== '/' || manifest.scope !== '/') {
  throw new Error('Web manifest scope or start URL changed.');
}
const assets = readdirSync(join(dist, 'assets'));
if (!assets.some((name) => name.endsWith('.js')))
  throw new Error('Built JavaScript assets are missing.');
process.stdout.write(`PASS static generated cache policy: ${urls.length} precache entries.\n`);
