import { describe, expect, it } from 'vitest';
import {
  GRAPH_SCHEMA_VERSION,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_NODES,
  MAX_LIVE_EDGES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_PRESENTATION_STEPS,
  type AiDiagramProposal,
  type GraphProjection,
} from '@archboard/contracts';
import {
  createGraphDocument,
  createGraphObjects,
  deleteGraphObjects,
  hydrateGraphDocument,
} from '@archboard/document-model';
import * as Y from 'yjs';
import {
  mapAiDiagram,
  preflightAiDiagram,
  prepareAiDiagramDraft,
} from '@/features/editor/ai/ai-diagram-draft';
import {
  aiLayoutInput,
  fallbackAiLayout,
  validateAiPositions,
} from '@/features/editor/ai/ai-diagram-geometry';

const FRESH_ID_START = 100;
const CAPACITY_ID_START = 1_000;
const ID_SUFFIX_DIGITS = 12;
const ENTITY_COUNT = 6;
const INVALID_SPAN = 40_000;
const INVALID_RECORD_ID = 900;
const uuid = (index: number) =>
  `00000000-0000-4000-8000-${index.toString().padStart(ID_SUFFIX_DIGITS, '0')}`;
const allocate = (start = 1) => {
  let index = start;
  return () => uuid(index++);
};
const proposal = (): AiDiagramProposal => ({
  kind: 'diagram',
  schemaVersion: 1,
  nodes: [
    {
      key: 'service',
      kind: 'component',
      title: 'Service',
      color: 'blue',
      content: {
        category: 'service',
        description: 'Reviewed description',
        technology: 'Node',
        externalUrl: null,
      },
    },
    {
      key: 'client',
      kind: 'component',
      title: 'Client',
      color: 'teal',
      content: { category: 'client', description: '', technology: 'React', externalUrl: null },
    },
    {
      key: 'note',
      kind: 'note',
      title: 'Private note',
      color: 'amber',
      content: { body: 'Reviewed assumptions' },
    },
  ],
  edges: [
    {
      key: 'request',
      source: 'client',
      target: 'service',
      label: 'Requests',
      protocol: 'HTTPS',
      direction: 'forward',
      style: 'solid',
    },
  ],
  boundaries: [{ key: 'group', title: 'System', nodeKeys: ['client', 'service'] }],
  steps: [
    {
      key: 'step',
      title: 'Request path',
      notes: 'Review',
      nodeKeys: ['client'],
      edgeKeys: ['request'],
    },
  ],
  explanation: 'Private explanation',
  claims: [],
  assumptions: ['Reviewed assumption'],
  questions: [],
});
const layout = (value = proposal()) => ({
  positions: fallbackAiLayout(aiLayoutInput(value)),
  status: 'fallback' as const,
  reason: 'unavailable' as const,
});
const emptyGraph = (): GraphProjection => ({
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes: [],
  edges: [],
  boundaries: [],
  steps: [],
});

describe('AI semantic diagram mapping and detached preflight', () => {
  it('maps fresh IDs consistently across nodes, edges, groups and ordered steps; preserves content', () => {
    const result = mapAiDiagram(proposal(), layout(), new Set(), allocate());
    expect(new Set(Object.values(result.ids)).size).toBe(ENTITY_COUNT);
    const edge = result.graph.edges[0]!;
    expect(edge.sourceId).toBe(result.ids.client);
    expect(edge.targetId).toBe(result.ids.service);
    expect(edge.sourceHandle).toBe('bottom');
    expect(edge.targetHandle).toBe('top');
    expect(result.graph.nodes.find((node) => node.id === result.ids.service)).toMatchObject({
      kind: 'component',
      color: 'blue',
      size: { width: 300, height: 160 },
      content: { category: 'service', technology: 'Node', description: 'Reviewed description' },
    });
    expect(result.graph.nodes.every((node) => !('parentId' in node))).toBe(true);
    expect(result.graph.boundaries[0]).toMatchObject({
      id: result.ids.group,
      color: 'gray',
      rect: { x: 0, y: 0 },
    });
    const step = result.graph.steps[0]!;
    expect(step.nodeIds).toEqual([result.ids.client]);
    expect(step.edgeIds).toEqual([result.ids.request]);
    const service = result.graph.nodes.find((node) => node.id === result.ids.service)!;
    expect(step.rect.y + step.rect.height).toBeGreaterThan(
      service.position.y + service.size.height,
    );
  });
  it('uses stable sorting independent of node/edge order and allocates a disjoint second intent', () => {
    const a = proposal();
    const b = { ...a, nodes: [...a.nodes].reverse(), edges: [...a.edges].reverse() };
    const first = mapAiDiagram(a, layout(a), new Set(), allocate());
    expect(mapAiDiagram(b, layout(b), new Set(), allocate())).toEqual(first);
    const second = mapAiDiagram(
      a,
      layout(a),
      new Set(Object.values(first.ids)),
      allocate(FRESH_ID_START),
    );
    expect(Object.values(second.ids).some((id) => Object.values(first.ids).includes(id))).toBe(
      false,
    );
  });
  it('maps all content kinds without interpreting bodies, URLs or model geometry', () => {
    const p = proposal();
    p.nodes.push(
      {
        key: 'code',
        kind: 'code',
        title: 'Code',
        color: 'gray',
        content: { language: 'typescript', body: '<script>private</script>' },
      },
      {
        key: 'schema',
        kind: 'schema',
        title: 'Schema',
        color: 'violet',
        content: { body: 'CREATE TABLE private;' },
      },
    );
    const result = mapAiDiagram(p, layout(p), new Set(), allocate());
    expect(result.graph.nodes.find((node) => node.kind === 'code')?.content).toEqual(
      p.nodes[3]!.content,
    );
    expect(() =>
      mapAiDiagram({ ...p, nodes: [{ ...p.nodes[0], position: { x: 1, y: 2 } }] }, layout(p)),
    ).toThrow();
  });
  it('rejects malformed references, self edges, duplicate keys and invalid/reused allocated IDs', () => {
    const p = proposal();
    expect(() =>
      mapAiDiagram({ ...p, edges: [{ ...p.edges[0], target: 'missing' }] }, layout()),
    ).toThrow();
    expect(() => aiLayoutInput({ ...p, edges: [{ ...p.edges[0]!, target: 'client' }] })).toThrow();
    expect(() =>
      mapAiDiagram({ ...p, boundaries: [{ ...p.boundaries[0], key: 'client' }] }, layout()),
    ).toThrow();
    expect(() => mapAiDiagram(p, layout(), new Set([uuid(1)]), allocate())).toThrow('already used');
    expect(() => mapAiDiagram(p, layout(), new Set(), () => uuid(1))).toThrow('already used');
    expect(() => mapAiDiagram(p, layout(), new Set(), () => 'provider-key')).toThrow();
  });
  it('rejects nonfinite, missing, duplicate, overlapping and excessive-span layout geometry', () => {
    const input = aiLayoutInput(proposal());
    const positions = fallbackAiLayout(input);
    for (const invalid of [
      [],
      positions.slice(1),
      [...positions, positions[0]],
      positions.map((entry) => ({ ...entry, position: { x: NaN, y: 0 } })),
      positions.map((entry) => ({ ...entry, position: { x: 0, y: 0 } })),
      positions.map((entry, index) => ({ ...entry, position: { x: index * INVALID_SPAN, y: 0 } })),
    ])
      expect(() => validateAiPositions(input, invalid)).toThrow();
    expect(() =>
      mapAiDiagram(proposal(), layout(), new Set(), allocate(), { x: 100_000, y: 0 }),
    ).toThrow();
  });
  it('preflights a complete additive candidate without touching source state or emitting updates', () => {
    const document = createGraphDocument();
    try {
      const existing = mapAiDiagram(
        proposal(),
        layout(),
        new Set(),
        allocate(FRESH_ID_START),
      ).graph;
      createGraphObjects(document, existing);
      const before = Y.encodeStateAsUpdate(document);
      let updates = 0;
      document.on('update', () => updates++);
      const graph = mapAiDiagram(proposal(), layout(), new Set(), allocate()).graph;
      const result = preflightAiDiagram(before, graph);
      expect(result.updateBytes).toBeGreaterThan(0);
      expect(result.stateBytes).toBeGreaterThan(before.byteLength);
      expect(Y.encodeStateAsUpdate(document)).toEqual(before);
      expect(updates).toBe(0);
    } finally {
      document.destroy();
    }
  });
  it('rejects candidate update/state limits and invalid existing physical state without mutation', () => {
    const document = createGraphDocument();
    try {
      const before = Y.encodeStateAsUpdate(document);
      const graph = mapAiDiagram(proposal(), layout(), new Set(), allocate()).graph;
      expect(() => preflightAiDiagram(before, graph, { updateBytes: 1 })).toThrow('byte budget');
      expect(() => preflightAiDiagram(before, graph, { stateBytes: before.byteLength })).toThrow(
        'byte budget',
      );
      expect(() =>
        preflightAiDiagram(new Uint8Array(MAX_ENCODED_YJS_STATE_BYTES + 1), graph),
      ).toThrow('byte budget');
      expect(Y.encodeStateAsUpdate(document)).toEqual(before);
      document.getMap('nodes').set(uuid(INVALID_RECORD_ID), 'invalid physical record');
      const invalid = Y.encodeStateAsUpdate(document);
      expect(() => preflightAiDiagram(invalid, graph)).toThrow();
      expect(Y.encodeStateAsUpdate(document)).toEqual(invalid);
    } finally {
      document.destroy();
    }
  });
  it('accounts for existing live node capacity', () => {
    const graph = emptyGraph();
    const template = mapAiDiagram(proposal(), layout(), new Set(), allocate()).graph.nodes[0]!;
    graph.nodes = Array.from({ length: MAX_LIVE_NODES }, (_, index) => ({
      ...template,
      id: uuid(index + FRESH_ID_START),
    }));
    const document = hydrateGraphDocument(graph);
    try {
      const before = Y.encodeStateAsUpdate(document);
      expect(() =>
        preflightAiDiagram(before, mapAiDiagram(proposal(), layout(), new Set(), allocate()).graph),
      ).toThrow();
      expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    } finally {
      document.destroy();
    }
  });
  it('includes existing edge, boundary and step capacity in complete preflight', () => {
    const template = mapAiDiagram(proposal(), layout(), new Set(), allocate(FRESH_ID_START)).graph;
    for (const [kind, count] of [
      ['edges', MAX_LIVE_EDGES],
      ['boundaries', MAX_LIVE_BOUNDARIES],
      ['steps', MAX_LIVE_PRESENTATION_STEPS],
    ] as const) {
      const graph: GraphProjection = { ...template, steps: [] };
      if (kind === 'edges')
        graph.edges = Array.from({ length: count }, (_, index) => ({
          ...template.edges[0]!,
          id: uuid(CAPACITY_ID_START + index),
        }));
      if (kind === 'boundaries')
        graph.boundaries = Array.from({ length: count }, (_, index) => ({
          ...template.boundaries[0]!,
          id: uuid(CAPACITY_ID_START + index),
        }));
      if (kind === 'steps')
        graph.steps = Array.from({ length: count }, (_, index) => ({
          ...template.steps[0]!,
          id: uuid(CAPACITY_ID_START + index),
          order: index,
        }));
      const document = hydrateGraphDocument(graph);
      try {
        expect(() =>
          preflightAiDiagram(
            Y.encodeStateAsUpdate(document),
            mapAiDiagram(proposal(), layout(), new Set(), allocate()).graph,
          ),
        ).toThrow();
      } finally {
        document.destroy();
      }
    }
  });
  it('preserves tombstones when preparing, rejects old IDs, and fences aborted asynchronous layout', async () => {
    const document = createGraphDocument();
    try {
      const graph = mapAiDiagram(proposal(), layout(), new Set(), allocate()).graph;
      createGraphObjects(document, graph);
      deleteGraphObjects(document, { nodeIds: graph.nodes.map((node) => node.id) });
      const source = Y.encodeStateAsUpdate(document);
      const runLayout = async () => layout();
      await expect(
        prepareAiDiagramDraft(proposal(), source, new AbortController().signal, {
          allocate: allocate(),
          layout: runLayout,
        }),
      ).rejects.toThrow('already used');
      const prepared = await prepareAiDiagramDraft(
        proposal(),
        source,
        new AbortController().signal,
        { allocate: allocate(FRESH_ID_START), layout: runLayout },
      );
      expect(prepared.layout.status).toBe('fallback');
      expect(prepared.commentary.explanation).toBe('Private explanation');
      const abort = new AbortController();
      await expect(
        prepareAiDiagramDraft(proposal(), source, abort.signal, {
          layout: async () => {
            abort.abort();
            return layout();
          },
        }),
      ).rejects.toThrow('cancelled');
      expect(Y.encodeStateAsUpdate(document)).toEqual(source);
    } finally {
      document.destroy();
    }
  });
});
