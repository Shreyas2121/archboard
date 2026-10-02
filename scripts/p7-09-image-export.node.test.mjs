// Database-free lifecycle tests of the actual adapter with synthetic browser ports.
// These do not prove PNG decoding, transparency, CSP, downloads or browser cleanup.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as exports from '../packages/export/dist/index.js';
import { allEntityGraphFixture } from '../packages/fixtures/dist/index.js';

const options = { scope: 'diagram', background: false, theme: 'light' };
const image = exports.renderControlledSvg(allEntityGraphFixture, options);
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
const source = ts.transpileModule(
  await readFile(
    new URL('../apps/web/src/platform/download/image-download.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function harness(mode = 'success') {
  const urls = new Map();
  const timers = new Map();
  const clicks = [];
  const images = [];
  const canvases = [];
  const draws = [];
  let next = 0;
  let encode;
  const context = vm.createContext({
    Blob,
    DOMException,
    setTimeout(callback) {
      const id = ++next;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    URL: {
      createObjectURL(blob) {
        const id = `blob:synthetic-${++next}`;
        urls.set(id, blob);
        return id;
      },
      revokeObjectURL(id) {
        assert.ok(urls.delete(id));
      },
    },
    Image: class {
      constructor() {
        images.push(this);
      }
      set src(value) {
        this.value = value;
        if (mode === 'decode-error') this.onerror();
        else if (mode !== 'decode-pending') this.onload();
      }
      removeAttribute(name) {
        assert.equal(name, 'src');
        this.value = null;
      }
    },
    document: {
      createElement(kind) {
        if (mode === 'element-error') throw new Error('Synthetic element failure');
        if (kind === 'a')
          return {
            click() {
              if (mode === 'click-error') throw new Error('Synthetic click failure');
              clicks.push({ name: this.download, blob: urls.get(this.href) });
            },
          };
        assert.equal(kind, 'canvas');
        const canvas = {
          width: 0,
          height: 0,
          getContext(kind) {
            assert.equal(kind, '2d');
            return mode === 'context-error'
              ? null
              : {
                  drawImage(...args) {
                    draws.push(args.slice(1));
                  },
                };
          },
          toBlob(callback, type) {
            assert.equal(type, 'image/png');
            encode = callback;
            if (mode === 'encode-error') callback(null);
            else if (mode === 'encode-throw') throw new Error('Synthetic encoding failure');
            else if (mode !== 'encode-pending') callback(new Blob(['synthetic PNG'], { type }));
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => {
    assert.equal(specifier, '@archboard/export');
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await module.evaluate();
  const controller = new AbortController();
  return {
    urls,
    timers,
    clicks,
    images,
    canvases,
    draws,
    controller,
    run(format = 'png', scale = 1, artifact = image, downloading = () => {}) {
      return module.namespace.downloadDiagramImage(
        artifact,
        '../Synthetic <title>',
        format,
        scale,
        controller.signal,
        downloading,
      );
    },
    lateEncode() {
      encode?.(new Blob(['late'], { type: 'image/png' }));
    },
    clean() {
      assert.equal(urls.size, 0);
      assert.equal(timers.size, 0);
      for (const decoded of images) {
        assert.equal(decoded.value, null);
        assert.equal(decoded.onload, null);
        assert.equal(decoded.onerror, null);
      }
      for (const canvas of canvases) {
        assert.equal(canvas.width, 0);
        assert.equal(canvas.height, 0);
      }
    },
  };
}

test('SVG download preserves controlled bytes, fixed filename and releases URL even when element/click fails', async () => {
  for (const mode of ['success', 'click-error', 'element-error']) {
    const h = await harness(mode);
    if (mode === 'success') {
      await h.run('svg');
      assert.equal(await h.clicks[0].blob.text(), image.svg);
      assert.equal(h.clicks[0].name, 'archboard-Synthetic-title.svg');
    } else await assert.rejects(h.run('svg'), /Synthetic/);
    assert.equal(h.images.length, 0);
    h.clean();
  }
});

test('PNG exact scale is applied before draw; synthetic success releases all ports and never changes source graph', async () => {
  const before = JSON.stringify(allEntityGraphFixture);
  for (const scale of [1, 2]) {
    const h = await harness();
    let downloads = 0;
    await h.run('png', scale, image, () => downloads++);
    assert.deepEqual(h.draws, [[0, 0, image.width * scale, image.height * scale]]);
    assert.equal(downloads, 1);
    assert.equal(h.clicks[0].blob.type, 'image/png');
    h.clean();
  }
  assert.equal(JSON.stringify(allEntityGraphFixture), before);
});

test('forged SVG, oversize 2× and pre-cancelled work reject before Image/canvas/URL allocation', async () => {
  const large = exports.renderControlledSvg(
    {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      steps: [],
      boundaries: [
        {
          id: crypto.randomUUID(),
          title: 'Synthetic large boundary',
          color: 'gray',
          rect: { x: 0, y: 0, width: 5000, height: 100 },
        },
      ],
    },
    options,
  );
  for (const action of ['forged', 'large', 'cancelled']) {
    const h = await harness();
    if (action === 'cancelled') h.controller.abort();
    await assert.rejects(
      h.run(
        'png',
        action === 'large' ? 2 : 1,
        action === 'forged' ? { ...image } : action === 'large' ? large : image,
      ),
    );
    assert.equal(h.images.length, 0);
    assert.equal(h.canvases.length, 0);
    h.clean();
  }
});

test('decode/context/encode/click failures clean every allocated resource and never retry silently', async () => {
  for (const mode of [
    'decode-error',
    'context-error',
    'encode-error',
    'encode-throw',
    'click-error',
  ]) {
    const h = await harness(mode);
    await assert.rejects(h.run());
    assert.equal(h.clicks.length, 0);
    h.clean();
  }
});

test('cancel and timeout terminate decode/encode; late encoding cannot download', async () => {
  for (const mode of ['decode-pending', 'encode-pending']) {
    for (const outcome of ['abort', 'timeout']) {
      const h = await harness(mode);
      const promise = h.run();
      await Promise.resolve();
      await Promise.resolve();
      if (outcome === 'abort') h.controller.abort();
      else {
        assert.equal(h.timers.size, 1);
        [...h.timers.values()][0]();
      }
      await assert.rejects(promise, outcome === 'abort' ? /cancelled/ : /timed out/);
      h.lateEncode();
      assert.equal(h.clicks.length, 0);
      h.clean();
    }
  }
});

test('account/unmount fence can abort immediately before the download and releases both encoded image and SVG resources', async () => {
  for (const format of ['svg', 'png']) {
    const h = await harness();
    await assert.rejects(h.run(format, 1, image, () => h.controller.abort()));
    assert.equal(h.clicks.length, 0);
    h.clean();
  }
});
