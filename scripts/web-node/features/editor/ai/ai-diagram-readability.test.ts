import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { AiDiagramProposal, Rect } from '@archboard/contracts';
import { connectionSegmentIntersectsRect, layoutConnections } from '@archboard/export';
import { mapAiDiagram } from '@/features/editor/ai/ai-diagram-draft';
import { aiLayoutInput } from '@/features/editor/ai/ai-diagram-geometry';
import { runAiLayeredLayout } from '@/platform/layout/ai-layout-worker';
import { CanvasProjectionAdapter } from '@/features/editor/canvas/projection-adapter';

const UUID_DIGITS = 12;
const MIN_CAPTION_SHARE = 0.75;
const MOVEMENT = 700;
const TOPOLOGY = [
  ['storage', 'source'],
  ['workspace', 'source'],
  ['workspace', 'conversation'],
  ['workspace', 'plan'],
  ['source', 'chunk'],
  ['collection', 'source'],
  ['conversation', 'message'],
  ['message', 'citation'],
  ['citation', 'source'],
  ['citation', 'chunk'],
  ['plan', 'lesson'],
  ['lesson', 'chunk'],
  ['lesson', 'source'],
] as const;
const DOMAINS = [
  'workspace',
  'source',
  'chunk',
  'collection',
  'conversation',
  'message',
  'citation',
  'plan',
  'lesson',
];
const GROUPS = [
  { key: 'stores', title: 'Database and storage', nodeKeys: ['database', 'storage'] },
  {
    key: 'sources',
    title: 'Workspace and sources',
    nodeKeys: ['workspace', 'source', 'chunk', 'collection'],
  },
  {
    key: 'chat',
    title: 'Conversations and citations',
    nodeKeys: ['conversation', 'message', 'citation'],
  },
  { key: 'learning', title: 'Learning plans', nodeKeys: ['plan', 'lesson'] },
];
const proposal = (): AiDiagramProposal => ({
  kind: 'diagram',
  schemaVersion: 1,
  nodes: ['database', 'storage', ...DOMAINS].map((key) => ({
    key,
    kind: 'component',
    title: `${key} entity`,
    color: 'gray',
    content: {
      category: key === 'database' || key === 'storage' ? 'database' : 'generic',
      technology: 'PostgreSQL',
      description: 'Verified domain responsibility',
      externalUrl: null,
    },
  })),
  edges: [...DOMAINS.map((key) => ['database', key] as const), ...TOPOLOGY].map(
    ([source, target], index) => ({
      key: `connection-${index}`,
      source,
      target,
      label: `Declared ${source} to ${target} relationship`,
      protocol: 'Foreign key',
      direction: 'forward',
      style: 'solid',
    }),
  ),
  boundaries: GROUPS,
  steps: [],
  explanation: '',
  claims: [],
  assumptions: [],
  questions: [],
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('dense grouped AI diagram readability', () => {
  it('routes all storage and relationship links outside cards and packs captions without overlaps', async () => {
    const value = proposal();
    const positions = await runAiLayeredLayout(aiLayoutInput(value), new ELK());
    let next = 1;
    const { graph } = mapAiDiagram(
      value,
      { status: 'layered', positions },
      new Set(),
      () => `00000000-0000-4000-8000-${(next++).toString().padStart(UUID_DIGITS, '0')}`,
    );
    const original = JSON.stringify(graph);
    const routes = layoutConnections(graph);
    expect(routes.size).toBe(graph.edges.length);
    for (const route of routes.values()) {
      expect(route.routed).toBe(true);
      for (const [index, end] of route.points.entries()) {
        if (!index) continue;
        for (const node of graph.nodes)
          expect(
            connectionSegmentIntersectsRect(route.points[index - 1]!, end, {
              ...node.position,
              ...node.size,
            }),
          ).toBe(false);
      }
    }
    const labels = [...routes.values()].flatMap((route) => (route.label ? [route.label.rect] : []));
    expect(labels.length / graph.edges.length).toBeGreaterThanOrEqual(MIN_CAPTION_SHARE);
    for (const [index, label] of labels.entries()) {
      for (const node of graph.nodes)
        expect(overlaps(label, { ...node.position, ...node.size })).toBe(false);
      for (const other of labels.slice(index + 1)) expect(overlaps(label, other)).toBe(false);
    }
    expect(JSON.stringify(graph)).toBe(original);
    const adapter = new CanvasProjectionAdapter();
    const canvas = adapter.adapt(graph);
    const bounds = canvas.bounds!;
    for (const edge of canvas.edges) {
      for (const point of edge.data!.layout!.points) {
        expect(point.x).toBeGreaterThanOrEqual(bounds.x);
        expect(point.y).toBeGreaterThanOrEqual(bounds.y);
        expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    }
    const moved = adapter.adapt({
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index === 0
          ? { ...node, position: { ...node.position, y: node.position.y + MOVEMENT } }
          : node,
      ),
    });
    const incident = canvas.edges.find(
      (edge) => edge.source === graph.nodes[0]!.id || edge.target === graph.nodes[0]!.id,
    )!;
    expect(moved.edges.find((edge) => edge.id === incident.id)!.data!.layout).not.toEqual(
      incident.data!.layout,
    );
  });
});
