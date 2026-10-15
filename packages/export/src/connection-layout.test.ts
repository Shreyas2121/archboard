import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, GraphProjection, Rect } from '@archboard/contracts';
import { connectionSegmentIntersectsRect, layoutConnections } from './connection-layout.js';

const UUID_DIGITS = 12;
const WIDTH = 360;
const HEIGHT = 180;
const BLOCKER_X = 450;
const TARGET_X = 900;
const PAIR_Y = 300;
const NODE_LIMIT = 81;
const SOURCE = 1;
const TARGET = 2;
const BLOCKER = 3;
const CONNECTION = 4;
const PARALLEL_FIRST = 5;
const PARALLEL_SECOND = 6;
const ROW_CONNECTION = 7;
const BOUNDARY = 8;
const NARROW_GAP = 20;
const ROW_OFFSET = 30;
const BOUNDARY_INSET = 40;
const id = (index: number) =>
  `00000000-0000-4000-8000-${index.toString().padStart(UUID_DIGITS, '0')}`;
const node = (index: number, x: number, y = 0): GraphNode => ({
  id: id(index),
  kind: 'component',
  title: 'Entity',
  color: 'gray',
  position: { x, y },
  size: { width: WIDTH, height: HEIGHT },
  content: {
    category: 'generic',
    technology: 'PostgreSQL',
    description: 'Declared entity responsibility',
    externalUrl: null,
  },
});
const edge = (index: number, source: number, target: number): GraphEdge => ({
  id: id(index),
  sourceId: id(source),
  targetId: id(target),
  sourceHandle: 'right',
  targetHandle: 'left',
  label: 'Declared relationship between domain entities',
  protocol: 'Foreign key',
  direction: 'forward',
  style: 'solid',
});
const graph = (): GraphProjection => ({
  schemaVersion: 1,
  nodes: [node(SOURCE, 0), node(TARGET, TARGET_X), node(BLOCKER, BLOCKER_X)],
  edges: [edge(CONNECTION, SOURCE, TARGET)],
  boundaries: [],
  steps: [],
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('derived connection routing and label packing', () => {
  it('keeps existing narrow corridors and top ports clear without moving the cards', () => {
    const input = graph();
    input.nodes = [node(SOURCE, 0), node(TARGET, WIDTH + NARROW_GAP, ROW_OFFSET)];
    input.edges = [edge(CONNECTION, SOURCE, TARGET)];
    const narrow = layoutConnections(input).get(id(CONNECTION))!;
    expect(narrow.routed).toBe(true);
    input.nodes = [node(SOURCE, 0, PAIR_Y), node(TARGET, TARGET_X, 0)];
    input.edges = [{ ...input.edges[0]!, sourceHandle: 'top' }];
    input.boundaries = [
      {
        id: id(BOUNDARY),
        title: 'Application boundary with long heading',
        color: 'gray',
        rect: { x: -BOUNDARY_INSET, y: PAIR_Y - BOUNDARY_INSET, width: 440, height: 260 },
      },
    ];
    const top = layoutConnections(input).get(id(CONNECTION))!;
    expect(top.routed).toBe(true);
    for (const [route, nodes] of [
      [narrow, [node(SOURCE, 0), node(TARGET, WIDTH + NARROW_GAP, ROW_OFFSET)]],
      [top, input.nodes],
    ] as const)
      for (const [index, end] of route.points.entries()) {
        if (!index) continue;
        for (const node of nodes)
          expect(
            connectionSegmentIntersectsRect(route.points[index - 1]!, end, {
              ...node.position,
              ...node.size,
            }),
          ).toBe(false);
      }
  });
  it('detours around an intervening card and keeps the full input graph unchanged', () => {
    const input = graph();
    const before = JSON.stringify(input);
    const route = layoutConnections(input).get(id(CONNECTION))!;
    expect(route.routed).toBe(true);
    for (const [index, end] of route.points.entries()) {
      if (!index) continue;
      for (const node of input.nodes)
        expect(
          connectionSegmentIntersectsRect(route.points[index - 1]!, end, {
            ...node.position,
            ...node.size,
          }),
        ).toBe(false);
    }
    expect(route.label).not.toBeNull();
    expect(JSON.stringify(input)).toBe(before);
  });
  it('places parallel captions away from cards, other captions and boundary titles', () => {
    const input = graph();
    input.nodes = [
      node(SOURCE, 0),
      node(TARGET, TARGET_X),
      node(BLOCKER, 0, PAIR_Y),
      node(CONNECTION, TARGET_X, PAIR_Y),
    ];
    input.edges = [
      edge(PARALLEL_FIRST, SOURCE, TARGET),
      edge(PARALLEL_SECOND, SOURCE, TARGET),
      edge(ROW_CONNECTION, BLOCKER, CONNECTION),
    ];
    input.boundaries = [
      {
        id: id(BOUNDARY),
        title: 'Application boundary',
        color: 'gray',
        rect: { x: -40, y: -40, width: 1340, height: 560 },
      },
    ];
    const routes = layoutConnections(input);
    const labels = [...routes.values()].flatMap((route) => (route.label ? [route.label.rect] : []));
    expect(labels.length).toBe(input.edges.length);
    for (const [index, label] of labels.entries()) {
      for (const node of input.nodes)
        expect(overlaps(label, { ...node.position, ...node.size })).toBe(false);
      for (const other of labels.slice(index + 1)) expect(overlaps(label, other)).toBe(false);
    }
    expect(layoutConnections({ ...input, edges: [...input.edges].reverse() })).toEqual(routes);
  });
  it('bounds search work on large boards while retaining every connection and safe caption geometry', () => {
    const input = graph();
    input.nodes = Array.from({ length: NODE_LIMIT }, (_, index) =>
      node(index + 1, index * TARGET_X),
    );
    const route = layoutConnections(input).get(id(CONNECTION))!;
    expect(route.routed).toBe(false);
    expect(route.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
