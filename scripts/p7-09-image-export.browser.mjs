// PREPARED ONLY — UNRUN (deferred by user). Run after browser verification resumes.
// Serve the production web build at P7_WEB_ORIGIN; uses a disposable local demo only.
// No database, auth storage state or server mutation is required by this harness.
/* global window, document, Image, DOMParser, HTMLCanvasElement */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { renderControlledSvg } from '../packages/export/dist/index.js';
import { allEntityGraphFixture } from '../packages/fixtures/dist/index.js';

const { chromium } = createRequire(
  new URL('../packages/sync-client/package.json', import.meta.url),
)('playwright');
assert.ok(process.env.P7_WEB_ORIGIN, 'Set P7_WEB_ORIGIN to the served production build.');
const origin = new URL(process.env.P7_WEB_ORIGIN).origin;
const graph = structuredClone(allEntityGraphFixture);
const note = graph.nodes.find((node) => node.kind === 'note');
note.title = '</text><script>alert(1)</script>';
note.content.body =
  '</text><foreignObject onload="evil"><img src="https://hostile.invalid/pixel"> & \u0000\ud800';
const component = graph.nodes.find((node) => node.kind === 'component');
component.content.externalUrl = 'https://hostile.invalid/inert-url';
const hostile = renderControlledSvg(graph, { scope: 'diagram', background: false, theme: 'light' });
let browser;
let stage = 'configuration';
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    const state = (window.__imageEvidence = {
      recording: false,
      urls: new Set(),
      images: [],
      canvases: [],
      violations: [],
      failEncode: false,
      stallEncode: false,
    });
    document.addEventListener('securitypolicyviolation', (event) =>
      state.violations.push(event.violatedDirective),
    );
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (state.recording) state.urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      state.urls.delete(url);
      revoke(url);
    };
    const NativeImage = window.Image;
    window.Image = new Proxy(NativeImage, {
      construct(target, args) {
        const image = new target(...args);
        if (state.recording) state.images.push(image);
        return image;
      },
    });
    const createElement = document.createElement.bind(document);
    document.createElement = (name, ...args) => {
      const element = createElement(name, ...args);
      if (state.recording && name === 'canvas') state.canvases.push(element);
      return element;
    };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (state.stallEncode) return;
      if (state.failEncode) {
        callback(null);
        return;
      }
      return toBlob.call(this, callback, ...args);
    };
  });
  const page = await context.newPage();
  const external = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== origin) external.push(url);
  });
  await page.goto(`${origin}/demo`);
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export diagram image' });
  await dialog.getByLabel('Background', { exact: true }).click();
  await page.getByRole('option', { name: 'Transparent', exact: true }).click();
  await page.evaluate(() => {
    window.__imageEvidence.recording = true;
  });

  async function download(format) {
    const event = page.waitForEvent('download');
    await dialog.getByRole('button', { name: `Download ${format}`, exact: true }).click();
    const file = await event;
    assert.match(file.suggestedFilename(), /^archboard-[a-zA-Z0-9_-]+\.(svg|png)$/);
    return readFile(await file.path());
  }
  async function clean() {
    await page.waitForFunction(() => {
      const state = window.__imageEvidence;
      return (
        state.urls.size === 0 &&
        state.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0) &&
        state.images.every(
          (image) => !image.hasAttribute('src') && image.onload === null && image.onerror === null,
        )
      );
    });
  }
  // Decoding uses a fresh untracked image/canvas; it does not participate in adapter cleanup checks.
  async function inspectPng(bytes) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const result = await page.evaluate(async (base64) => {
      const state = window.__imageEvidence;
      state.recording = false;
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const image = new Image();
      const canvas = document.createElement('canvas');
      try {
        image.src = url;
        await image.decode();
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          alpha: ctx.getImageData(0, 0, 1, 1).data[3],
        };
      } finally {
        URL.revokeObjectURL(url);
        image.removeAttribute('src');
        canvas.width = canvas.height = 0;
        state.recording = true;
      }
    }, bytes.toString('base64'));
    assert.equal(bytes.readUInt32BE(16), result.width);
    assert.equal(bytes.readUInt32BE(20), result.height);
    return result;
  }

  stage = 'real SVG download, strict XML and controlled primitive/resource scan';
  const svg = (await download('SVG')).toString('utf8');
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image|a|style)\b|\b(?:on\w+|href|style)\s*=/i);
  const dimensions = await page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid SVG XML');
    return {
      width: Number(doc.documentElement.getAttribute('width')),
      height: Number(doc.documentElement.getAttribute('height')),
    };
  }, svg);
  await clean();
  stage = 'actual PNG decoding at exact 1×/2×, transparent and opaque corner';
  const one = await inspectPng(await download('PNG'));
  assert.deepEqual(one, { ...dimensions, alpha: 0 });
  await clean();
  await dialog.getByLabel('PNG scale', { exact: true }).click();
  await page.getByRole('option', { name: '2×', exact: true }).click();
  const two = await inspectPng(await download('PNG'));
  assert.deepEqual(two, { width: dimensions.width * 2, height: dimensions.height * 2, alpha: 0 });
  await clean();
  await dialog.getByLabel('Background', { exact: true }).click();
  await page.getByRole('option', { name: 'Current theme background', exact: true }).click();
  assert.equal((await inspectPng(await download('PNG'))).alpha, 255);
  await clean();

  stage = 'failure, explicit retry and cancellation resource cleanup';
  await page.evaluate(() => {
    window.__imageEvidence.failEncode = true;
  });
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'PNG encoding failed' }).waitFor();
  await clean();
  await page.evaluate(() => {
    window.__imageEvidence.failEncode = false;
    window.__imageEvidence.stallEncode = true;
  });
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click();
  await page.waitForFunction(() =>
    window.__imageEvidence.canvases.some((canvas) => canvas.width > 0),
  );
  await dialog.getByRole('button', { name: 'Cancel image export', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'cancelled' }).waitFor();
  await clean();
  await page.evaluate(() => {
    window.__imageEvidence.stallEncode = false;
  });
  await download('PNG');
  await clean();
  stage = 'empty current selection feedback';
  await dialog.getByLabel('Image scope', { exact: true }).click();
  await page.getByRole('option', { name: 'Current selection', exact: true }).click();
  await dialog.getByRole('button', { name: 'Download SVG', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'No live' }).waitFor();
  await clean();
  await dialog.getByLabel('Image scope', { exact: true }).click();
  await page.getByRole('option', { name: 'Entire diagram', exact: true }).click();

  stage = 'A18 hostile fixture real XML parse/decode under served CSP without remote fetch';
  await page.evaluate(async (svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror, script, foreignObject, image, a'))
      throw new Error('Unsafe/invalid output');
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    try {
      image.src = url;
      await image.decode();
    } finally {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    }
  }, hostile.svg);
  await clean();
  assert.deepEqual(external, []);
  assert.deepEqual(await page.evaluate(() => window.__imageEvidence.violations), []);

  stage =
    'installed production service worker, offline reload and repeat downloads without remote resources';
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  await page.evaluate(() => {
    window.__imageEvidence.recording = true;
  });
  await download('SVG');
  await clean();
  await download('PNG');
  await clean();
  assert.deepEqual(external, []);
  assert.deepEqual(await page.evaluate(() => window.__imageEvidence.violations), []);
  console.log(
    JSON.stringify({
      result: 'PASS',
      dimensions,
      stages: 'SVG/XML, PNG scale/alpha, failure/cancel/retry, A18/CSP/no-fetch, offline downloads',
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', stage }));
  throw error;
} finally {
  await browser?.close();
}
