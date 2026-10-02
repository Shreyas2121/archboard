import { describe, expect, it } from 'vitest';
import { allEntityGraphFixture } from '@archboard/fixtures';
import {
  MAX_CONTENT_BODY_CHARACTERS,
  MAX_EXPORT_IMAGE_PIXELS,
  MAX_EXPORT_IMAGE_SIDE_PIXELS,
  type GraphProjection,
} from '@archboard/contracts';
import {
  assertControlledSvg,
  escapeXml,
  imageDimensions,
  imageFileName,
  layoutImageText,
  renderControlledSvg,
  selectImageGraph,
  type ImageExportOptions,
} from './image-export.js';
import { capturePortableEnvelope, serializePortableJson } from './index.js';

const options: ImageExportOptions = { scope: 'diagram', background: true, theme: 'light' };
const HALF = 2;
const TEXT_TEST_WIDTH = 160;
const WRAP_TEST_WIDTH = 16;
const LONG_LABEL_LENGTH = 120;
const PADDED_CARD_WIDTH = 224;
const AREA_TEST_WIDTH = 8000;
const AREA_TEST_HEIGHT = 4000;
const OVER_AREA_HEIGHT = 4001;
const DOUBLE_TEST_WIDTH = 2000;
const DOUBLE_OVER_HEIGHT = 4000.01;
const INVALID_SCALE = 3;
const LONG_TITLE_LENGTH = 1000;
const FILENAME_BOUND = 100;
const allKinds = ['component', 'code', 'schema', 'note'];
const empty: GraphProjection = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  boundaries: [],
  steps: [],
};
const note = allEntityGraphFixture.nodes.find((node) => node.kind === 'note')!;
const source = allEntityGraphFixture.edges[0]!;

describe('controlled SVG', () => {
  it('renders every kind, boundaries, labels/protocols and safe marker/clip definitions deterministically without changing the graph', () => {
    const before = JSON.stringify(allEntityGraphFixture);
    const first = renderControlledSvg(allEntityGraphFixture, options);
    expect(renderControlledSvg(allEntityGraphFixture, options).svg).toBe(first.svg);
    expect(first.nodeCount).toBe(allEntityGraphFixture.nodes.length);
    expect(first.edgeCount).toBe(allEntityGraphFixture.edges.length);
    expect(first.boundaryCount).toBe(allEntityGraphFixture.boundaries.length);
    for (const kind of allKinds)
      expect(first.svg).toContain(
        kind === 'component'
          ? allEntityGraphFixture.nodes.find((node) => node.kind === 'component')!.content.category
          : kind,
      );
    expect(first.svg).toContain('marker-end="url(#arrow-end)"');
    expect(first.svg).toContain('clip-path="url(#card-clip-');
    expect(first.svg).toContain(escapeXml(source.protocol));
    expect(JSON.stringify(allEntityGraphFixture)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.bounds)).toBe(true);
    expect(() => assertControlledSvg(first)).not.toThrow();
    expect(() => assertControlledSvg({ ...first })).toThrow('renderer-generated');
  });
  it('uses boundary, edge, card, label layer order and both line styles/directions', () => {
    const graph = structuredClone(allEntityGraphFixture);
    graph.edges[0] = {
      ...source,
      direction: 'bidirectional',
      style: 'dashed',
      label: 'Synthetic edge label',
    };
    const svg = renderControlledSvg(graph, options).svg;
    expect(svg).toContain('marker-start="url(#arrow-start)"');
    expect(svg).toContain('stroke-dasharray="6 6"');
    const boundary = graph.boundaries[0]!;
    const boundaryStart = svg.indexOf(`<g><rect x="${boundary.rect.x}"`);
    const edgeStart = svg.indexOf('<path d="M ', svg.indexOf('</defs>') + 1);
    const cardStart = svg.indexOf('<defs><clipPath');
    const labelStart = svg.indexOf('Synthetic edge label');
    expect(boundaryStart).toBeLessThan(edgeStart);
    expect(edgeStart).toBeLessThan(cardStart);
    expect(cardStart).toBeLessThan(labelStart);
  });
  it('escapes malicious text as inert content; only generated allowed primitives/attributes are present', () => {
    const hostile = `</text><script>alert(1)</script><foreignObject onload="evil"><img src="https://hostile.invalid/pixel"> & ' "`;
    const graph = {
      ...empty,
      nodes: [{ ...note, title: '<script>"&', content: { body: hostile } }],
    };
    const svg = renderControlledSvg(graph, options).svg;
    expect(svg).toContain('&lt;script&gt;&quot;&amp;');
    const allowed = new Set([
      'svg',
      'title',
      'defs',
      'marker',
      'path',
      'g',
      'rect',
      'clipPath',
      'text',
      'tspan',
    ]);
    for (const tag of svg.matchAll(/<([a-zA-Z]+)\b([^>]*)>/g)) {
      expect(allowed.has(tag[1]!)).toBe(true);
      expect(tag[2]).not.toMatch(/\b(?:on[a-z]+|href|style)\s*=/i);
    }
    expect(svg).not.toMatch(/<(?:script|foreignObject|image|a|style)\b/i);
    expect(svg).not.toContain('https://hostile.invalid/pixel"');
  });
  it('displays external URL text without links/resources and rejects unsafe URL input', () => {
    const component = allEntityGraphFixture.nodes.find((node) => node.kind === 'component')!;
    const url = 'https://example.test/inert';
    const graph = {
      ...empty,
      nodes: [
        {
          ...component,
          size: { width: 800, height: 600 },
          content: { ...component.content, externalUrl: url },
        },
      ],
    };
    expect(renderControlledSvg(graph, options).svg).toContain(url);
    for (const unsafe of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>'])
      expect(() =>
        renderControlledSvg(
          {
            ...graph,
            nodes: [{ ...graph.nodes[0]!, content: { ...component.content, externalUrl: unsafe } }],
          },
          options,
        ),
      ).toThrow();
  });
  it('replaces XML-invalid display characters but preserves the complete original JSON body', () => {
    const body = 'before\u0000\u000b\ud800\ufffeafter';
    expect(escapeXml(body)).toBe('before\ufffd\ufffd\ufffd\ufffdafter');
    expect(escapeXml('\t\n\r😀')).toBe('\t\n\r😀');
    const graph = { ...empty, nodes: [{ ...note, content: { body } }] };
    expect(renderControlledSvg(graph, options).svg).not.toContain('\u0000');
    const file = capturePortableEnvelope(
      {
        exportedAt: '2026-10-02T00:00:00.000Z',
        board: { title: 'Synthetic', description: '' },
        graph,
      },
      {
        online: false,
        authoritative: false,
        acknowledged: false,
        persistencePending: true,
        outboxPending: true,
      },
    );
    expect(JSON.parse(serializePortableJson(file).json).graph.nodes[0].content.body).toBe(body);
  });
  it('bounds visible body work and indicates overflow instead of serializing hidden text into SVG', () => {
    const body = 'visible'
      .repeat(MAX_CONTENT_BODY_CHARACTERS)
      .slice(0, MAX_CONTENT_BODY_CHARACTERS);
    const graph = {
      ...empty,
      nodes: [{ ...note, size: { width: 160, height: 100 }, content: { body } }],
    };
    const svg = renderControlledSvg(graph, options).svg;
    expect(svg).toContain('…');
    expect(svg.length).toBeLessThan(body.length);
    expect(
      layoutImageText('\r'.repeat(MAX_CONTENT_BODY_CHARACTERS), TEXT_TEST_WIDTH, 1).overflow,
    ).toBe(true);
    expect(layoutImageText('ab\ncd', WRAP_TEST_WIDTH, HALF)).toEqual({
      lines: ['ab', 'cd'],
      overflow: false,
    });
    expect(layoutImageText('abcdef', WRAP_TEST_WIDTH, HALF)).toEqual({
      lines: ['ab', 'cd'],
      overflow: true,
    });
  });
  it('includes negative geometry, document padding, marker/stroke and label bounds without silent shrink', () => {
    const graph = {
      ...empty,
      nodes: [{ ...note, position: { x: -300, y: -200 }, size: { width: 160, height: 100 } }],
    };
    const rendered = renderControlledSvg(graph, options);
    expect(rendered.bounds).toEqual({ x: -332, y: -232, width: 224, height: 164 });
    expect(rendered.svg).toContain('viewBox="-332 -232 224 164"');
    const wideLabelGraph = {
      ...empty,
      nodes: [
        {
          ...note,
          id: source.sourceId,
          position: { x: 0, y: 0 },
          size: { width: 160, height: 100 },
        },
        {
          ...note,
          id: source.targetId,
          position: { x: 0, y: 200 },
          size: { width: 160, height: 100 },
        },
      ],
      edges: [
        {
          ...source,
          sourceHandle: 'bottom' as const,
          targetHandle: 'top' as const,
          label: 'L'.repeat(LONG_LABEL_LENGTH),
          protocol: 'HTTP',
        },
      ],
    };
    const labeled = renderControlledSvg(wideLabelGraph, options);
    expect(labeled.width).toBeGreaterThan(PADDED_CARD_WIDTH);
    expect(labeled.svg).toContain('…');
    expect(() =>
      renderControlledSvg(
        { ...graph, nodes: [{ ...graph.nodes[0]!, position: { x: Number.NaN, y: 0 } }] },
        options,
      ),
    ).toThrow();
    expect(() =>
      renderControlledSvg(
        {
          ...graph,
          boundaries: [
            {
              id: crypto.randomUUID(),
              title: 'Too large',
              color: 'gray',
              rect: { x: 0, y: 0, width: 20_000, height: 100 },
            },
          ],
        },
        options,
      ),
    ).toThrow('Reduce scope');
  });
  it('omits the page background only when transparent and supports a fixed dark palette', () => {
    const graph = { ...empty, nodes: [note] };
    expect(renderControlledSvg(graph, options).svg).toContain('fill="#eeefe9"');
    expect(renderControlledSvg(graph, { ...options, background: false }).svg).not.toContain(
      'fill="#eeefe9"',
    );
    expect(renderControlledSvg(graph, { ...options, theme: 'dark' }).svg).toContain(
      'fill="#10151b"',
    );
    expect(() =>
      Reflect.apply(renderControlledSvg, null, [
        graph,
        { ...options, theme: 'url(https://hostile.invalid)' },
      ]),
    ).toThrow();
  });
});

describe('coherent image scope', () => {
  it('selects internal edges and includes endpoints of an explicitly selected edge', () => {
    const scoped = selectImageGraph(allEntityGraphFixture, {
      ...options,
      scope: 'selection',
      selection: [{ kind: 'edge', id: source.id }],
    });
    expect(scoped.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([source.sourceId, source.targetId]),
    );
    expect(scoped.edges.some((edge) => edge.id === source.id)).toBe(true);
    expect(scoped.boundaries).toHaveLength(0);
    const endpoints = selectImageGraph(allEntityGraphFixture, {
      ...options,
      scope: 'selection',
      selection: [
        { kind: 'node', id: source.sourceId },
        { kind: 'node', id: source.targetId },
      ],
    });
    expect(endpoints.edges.some((edge) => edge.id === source.id)).toBe(true);
  });
  it('preserves selected boundaries without silently including their contained cards', () => {
    const boundary = allEntityGraphFixture.boundaries[0]!;
    const graph = selectImageGraph(allEntityGraphFixture, {
      ...options,
      scope: 'selection',
      selection: [{ kind: 'boundary', id: boundary.id }],
    });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.boundaries).toHaveLength(1);
  });
  it('reports missing endpoints; empty and deleted selections have actionable feedback', () => {
    const graph = {
      ...empty,
      nodes: [allEntityGraphFixture.nodes.find((node) => node.id === source.sourceId)!],
      edges: [source],
    };
    expect(renderControlledSvg(graph, options).omittedEdges).toBe(1);
    expect(() => renderControlledSvg(empty, options)).toThrow('No live');
    expect(() =>
      renderControlledSvg(allEntityGraphFixture, { ...options, scope: 'selection', selection: [] }),
    ).toThrow('No live');
    expect(() =>
      renderControlledSvg(allEntityGraphFixture, {
        ...options,
        scope: 'selection',
        selection: [{ kind: 'node', id: crypto.randomUUID() }],
      }),
    ).toThrow('No live');
  });
});

describe('allocation bounds and filenames', () => {
  it('checks side and area boundaries separately at exact 1× and 2× dimensions', () => {
    expect(imageDimensions(MAX_EXPORT_IMAGE_SIDE_PIXELS, 1)).toEqual({ width: 8192, height: 1 });
    expect(() => imageDimensions(MAX_EXPORT_IMAGE_SIDE_PIXELS + 1, 1)).toThrow('Reduce scope');
    expect(imageDimensions(AREA_TEST_WIDTH, MAX_EXPORT_IMAGE_PIXELS / AREA_TEST_WIDTH)).toEqual({
      width: 8000,
      height: 4000,
    });
    expect(() => imageDimensions(AREA_TEST_WIDTH, OVER_AREA_HEIGHT)).toThrow('Reduce scope');
    expect(imageDimensions(DOUBLE_TEST_WIDTH, AREA_TEST_HEIGHT, HALF)).toEqual({
      width: 4000,
      height: 8000,
    });
    expect(() => imageDimensions(DOUBLE_TEST_WIDTH, DOUBLE_OVER_HEIGHT, HALF)).toThrow(
      'Reduce scope',
    );
    expect(imageDimensions(MAX_EXPORT_IMAGE_SIDE_PIXELS / HALF, 1, HALF).width).toBe(
      MAX_EXPORT_IMAGE_SIDE_PIXELS,
    );
    expect(() => imageDimensions(MAX_EXPORT_IMAGE_SIDE_PIXELS / HALF + 1, 1, HALF)).toThrow(
      'Reduce scope',
    );
    for (const invalid of [0, -1, Number.NaN, Infinity])
      expect(() => imageDimensions(invalid, 1)).toThrow();
    expect(() => Reflect.apply(imageDimensions, null, [1, 1, INVALID_SCALE])).toThrow('1× or 2×');
  });
  it('sanitizes paths, XML, controls and empty titles into bounded fixed-extension names', () => {
    expect(imageFileName('../C:\\secret/<script>\u0000', 'svg')).toBe(
      'archboard-C-secret-script.svg',
    );
    expect(imageFileName('***', 'png')).toBe('archboard-diagram.png');
    expect(imageFileName('x'.repeat(LONG_TITLE_LENGTH), 'png').length).toBeLessThan(FILENAME_BOUND);
  });
});
