import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  GRAPH_SCHEMA_VERSION,
  HANDLES,
  NODE_KINDS,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';

import { FIXTURE_NAMESPACES, fixtureId } from '../ids.js';

const GRID_COLUMNS = 20;
const GRID_COLUMN_GAP = 240;
const GRID_ROW_GAP = 180;
const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 120;
const DEFAULT_RECT_WIDTH = 800;
const DEFAULT_RECT_HEIGHT = 600;
const SCHEMA_NODE_REMAINDER = 2;

export interface GraphFixtureCounts {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly boundaryCount: number;
  readonly stepCount: number;
}

function assertCount(name: string, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

export function buildNode(ordinal: number): GraphNode {
  const shared = {
    id: fixtureId(FIXTURE_NAMESPACES.NODE, ordinal),
    position: {
      x: (ordinal % GRID_COLUMNS) * GRID_COLUMN_GAP,
      y: Math.floor(ordinal / GRID_COLUMNS) * GRID_ROW_GAP,
    },
    size: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    title: `Node ${ordinal}`,
    color: COLOR_TOKENS.BLUE,
  };

  switch (ordinal % Object.keys(NODE_KINDS).length) {
    case 0:
      return {
        ...shared,
        kind: NODE_KINDS.COMPONENT,
        content: {
          category: COMPONENT_CATEGORIES.SERVICE,
          description: `Service ${ordinal}`,
          technology: 'TypeScript',
          externalUrl: null,
        },
      };
    case 1:
      return {
        ...shared,
        kind: NODE_KINDS.CODE,
        content: { language: 'typescript', body: `export const node${ordinal} = true;` },
      };
    case SCHEMA_NODE_REMAINDER:
      return { ...shared, kind: NODE_KINDS.SCHEMA, content: { body: `table_${ordinal}(id)` } };
    default:
      return { ...shared, kind: NODE_KINDS.NOTE, content: { body: `Note ${ordinal}` } };
  }
}

export function buildEdge(ordinal: number, nodeCount: number): GraphEdge {
  if (nodeCount < 1) {
    throw new Error('At least one node is required to build an edge fixture.');
  }

  const sourceOrdinal = ordinal % nodeCount;
  const targetOrdinal = (ordinal + 1) % nodeCount;

  return {
    id: fixtureId(FIXTURE_NAMESPACES.EDGE, ordinal),
    sourceId: fixtureId(FIXTURE_NAMESPACES.NODE, sourceOrdinal),
    targetId: fixtureId(FIXTURE_NAMESPACES.NODE, targetOrdinal),
    sourceHandle: HANDLES.RIGHT,
    targetHandle: HANDLES.LEFT,
    label: `Edge ${ordinal}`,
    protocol: 'HTTPS',
    direction: EDGE_DIRECTIONS.FORWARD,
    style: EDGE_STYLES.SOLID,
  };
}

export function buildBoundary(ordinal: number): Boundary {
  return {
    id: fixtureId(FIXTURE_NAMESPACES.BOUNDARY, ordinal),
    title: `Boundary ${ordinal}`,
    rect: { x: 0, y: 0, width: DEFAULT_RECT_WIDTH, height: DEFAULT_RECT_HEIGHT },
    color: COLOR_TOKENS.GRAY,
  };
}

export function buildStep(
  ordinal: number,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): PresentationStep {
  return {
    id: fixtureId(FIXTURE_NAMESPACES.STEP, ordinal),
    title: `Step ${ordinal}`,
    notes: `Presentation step ${ordinal}`,
    order: ordinal,
    rect: { x: 0, y: 0, width: DEFAULT_RECT_WIDTH, height: DEFAULT_RECT_HEIGHT },
    nodeIds: nodes.length > 0 ? [nodes[ordinal % nodes.length]!.id] : [],
    edgeIds: edges.length > 0 ? [edges[ordinal % edges.length]!.id] : [],
  };
}

export function buildGraphFixture(counts: GraphFixtureCounts): GraphProjection {
  assertCount('nodeCount', counts.nodeCount);
  assertCount('edgeCount', counts.edgeCount);
  assertCount('boundaryCount', counts.boundaryCount);
  assertCount('stepCount', counts.stepCount);

  if (counts.edgeCount > 0 && counts.nodeCount === 0) {
    throw new Error('A graph with edges must contain at least one node.');
  }

  const nodes = Array.from({ length: counts.nodeCount }, (_unused, ordinal) => buildNode(ordinal));
  const edges = Array.from({ length: counts.edgeCount }, (_unused, ordinal) =>
    buildEdge(ordinal, counts.nodeCount),
  );
  const boundaries = Array.from({ length: counts.boundaryCount }, (_unused, ordinal) =>
    buildBoundary(ordinal),
  );
  const steps = Array.from({ length: counts.stepCount }, (_unused, ordinal) =>
    buildStep(ordinal, nodes, edges),
  );

  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, boundaries, steps };
}
