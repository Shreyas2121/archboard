import {
  CODE_LANGUAGES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  GRAPH_SCHEMA_VERSION,
  HANDLES,
  MAX_BOUNDARY_TITLE_CHARACTERS,
  MAX_COMPONENT_DESCRIPTION_CHARACTERS,
  MAX_CONTENT_BODY_CHARACTERS,
  MAX_EDGE_LABEL_CHARACTERS,
  MAX_EDGE_PROTOCOL_CHARACTERS,
  MAX_EXTERNAL_URL_CHARACTERS,
  MAX_GRAPH_COORDINATE,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_NODE_HEIGHT,
  MAX_NODE_TITLE_CHARACTERS,
  MAX_NODE_WIDTH,
  MAX_RECT_DIMENSION,
  MAX_STEP_NOTES_CHARACTERS,
  MAX_STEP_ORDER,
  MAX_STEP_REFERENCES,
  MAX_STEP_TITLE_CHARACTERS,
  MAX_TECHNOLOGY_CHARACTERS,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_STEP_ORDER,
  NODE_KINDS,
  type GraphProjection,
} from '@archboard/contracts';

import { FIXED_IDS, FIXTURE_NAMESPACES, fixtureId } from '../ids.js';
import { buildGraphFixture } from './builders.js';

const MINIMAL_NODE_WIDTH = 240;
const MINIMAL_NODE_HEIGHT = 140;
const ALL_ENTITY_NODE_WIDTH = 260;
const ALL_ENTITY_NODE_HEIGHT = 160;
const EXTERNAL_URL_PREFIX = 'https://example.com/';

export const TYPICAL_GRAPH_COUNTS = {
  nodeCount: 200,
  edgeCount: 400,
  boundaryCount: 20,
  stepCount: 20,
} as const;

export const LIMIT_GRAPH_COUNTS = {
  nodeCount: MAX_LIVE_NODES,
  edgeCount: MAX_LIVE_EDGES,
  boundaryCount: MAX_LIVE_BOUNDARIES,
  stepCount: MAX_LIVE_PRESENTATION_STEPS,
} as const;

export const minimalGraphFixture: GraphProjection = {
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes: [
    {
      id: FIXED_IDS.NODE_A,
      kind: NODE_KINDS.COMPONENT,
      position: { x: 0, y: 0 },
      size: { width: MINIMAL_NODE_WIDTH, height: MINIMAL_NODE_HEIGHT },
      title: 'Web application',
      color: COLOR_TOKENS.BLUE,
      content: {
        category: COMPONENT_CATEGORIES.CLIENT,
        description: 'Browser client',
        technology: 'React',
        externalUrl: null,
      },
    },
    {
      id: FIXED_IDS.NODE_B,
      kind: NODE_KINDS.COMPONENT,
      position: { x: 400, y: 0 },
      size: { width: MINIMAL_NODE_WIDTH, height: MINIMAL_NODE_HEIGHT },
      title: 'API service',
      color: COLOR_TOKENS.TEAL,
      content: {
        category: COMPONENT_CATEGORIES.SERVICE,
        description: 'Application API',
        technology: 'NestJS',
        externalUrl: null,
      },
    },
  ],
  edges: [
    {
      id: FIXED_IDS.EDGE_A,
      sourceId: FIXED_IDS.NODE_A,
      targetId: FIXED_IDS.NODE_B,
      sourceHandle: HANDLES.RIGHT,
      targetHandle: HANDLES.LEFT,
      label: 'Requests',
      protocol: 'HTTPS',
      direction: EDGE_DIRECTIONS.FORWARD,
      style: EDGE_STYLES.SOLID,
    },
  ],
  boundaries: [],
  steps: [],
};

export const allEntityGraphFixture: GraphProjection = {
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes: [
    minimalGraphFixture.nodes[0]!,
    {
      id: FIXED_IDS.NODE_B,
      kind: NODE_KINDS.CODE,
      position: { x: 400, y: 0 },
      size: { width: ALL_ENTITY_NODE_WIDTH, height: ALL_ENTITY_NODE_HEIGHT },
      title: 'Handler',
      color: COLOR_TOKENS.GREEN,
      content: { language: CODE_LANGUAGES.TYPESCRIPT, body: 'export function handle() {}' },
    },
    {
      id: FIXED_IDS.NODE_C,
      kind: NODE_KINDS.SCHEMA,
      position: { x: 0, y: 300 },
      size: { width: ALL_ENTITY_NODE_WIDTH, height: ALL_ENTITY_NODE_HEIGHT },
      title: 'Board schema',
      color: COLOR_TOKENS.AMBER,
      content: { body: 'boards(id, owner_id)' },
    },
    {
      id: FIXED_IDS.NODE_D,
      kind: NODE_KINDS.NOTE,
      position: { x: 400, y: 300 },
      size: { width: ALL_ENTITY_NODE_WIDTH, height: ALL_ENTITY_NODE_HEIGHT },
      title: 'Constraint',
      color: COLOR_TOKENS.VIOLET,
      content: { body: 'Commit before ACK.' },
    },
  ],
  edges: [
    {
      id: FIXED_IDS.EDGE_A,
      sourceId: FIXED_IDS.NODE_A,
      targetId: FIXED_IDS.NODE_B,
      sourceHandle: HANDLES.TOP,
      targetHandle: HANDLES.RIGHT,
      label: 'Call',
      protocol: 'HTTPS',
      direction: EDGE_DIRECTIONS.FORWARD,
      style: EDGE_STYLES.SOLID,
    },
    {
      id: FIXED_IDS.EDGE_B,
      sourceId: FIXED_IDS.NODE_C,
      targetId: FIXED_IDS.NODE_D,
      sourceHandle: HANDLES.BOTTOM,
      targetHandle: HANDLES.LEFT,
      label: 'Observe',
      protocol: 'SQL',
      direction: EDGE_DIRECTIONS.BIDIRECTIONAL,
      style: EDGE_STYLES.DASHED,
    },
  ],
  boundaries: [
    {
      id: FIXED_IDS.BOUNDARY_A,
      title: 'Application boundary',
      rect: { x: -100, y: -100, width: 1_000, height: 800 },
      color: COLOR_TOKENS.GRAY,
    },
  ],
  steps: [
    {
      id: FIXED_IDS.STEP_A,
      title: 'Request',
      notes: 'Follow the request into the API.',
      order: 0,
      rect: { x: -50, y: -50, width: 800, height: 400 },
      nodeIds: [FIXED_IDS.NODE_A, FIXED_IDS.NODE_B],
      edgeIds: [FIXED_IDS.EDGE_A],
    },
    {
      id: FIXED_IDS.STEP_B,
      title: 'Persistence',
      notes: 'Inspect the schema and durability constraint.',
      order: 1,
      rect: { x: -50, y: 200, width: 800, height: 400 },
      nodeIds: [FIXED_IDS.NODE_C, FIXED_IDS.NODE_D],
      edgeIds: [FIXED_IDS.EDGE_B],
    },
  ],
};

export function createTypicalGraphFixture(): GraphProjection {
  return buildGraphFixture(TYPICAL_GRAPH_COUNTS);
}

function fixedLengthExternalUrl(length: number): string {
  return `${EXTERNAL_URL_PREFIX}${'x'.repeat(length - EXTERNAL_URL_PREFIX.length)}`;
}

export function createLimitGraphFixture(): GraphProjection {
  const graph = buildGraphFixture(LIMIT_GRAPH_COUNTS);
  const nodeIds = graph.nodes.slice(0, MAX_STEP_REFERENCES).map(({ id }) => id);

  graph.nodes[0] = {
    id: fixtureId(FIXTURE_NAMESPACES.NODE, 0),
    kind: NODE_KINDS.COMPONENT,
    position: { x: -MAX_GRAPH_COORDINATE, y: MAX_GRAPH_COORDINATE },
    size: { width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT },
    title: 'x'.repeat(MAX_NODE_TITLE_CHARACTERS),
    color: COLOR_TOKENS.RED,
    content: {
      category: COMPONENT_CATEGORIES.EXTERNAL,
      description: 'x'.repeat(MAX_COMPONENT_DESCRIPTION_CHARACTERS),
      technology: 'x'.repeat(MAX_TECHNOLOGY_CHARACTERS),
      externalUrl: fixedLengthExternalUrl(MAX_EXTERNAL_URL_CHARACTERS),
    },
  };
  graph.nodes[1] = {
    id: fixtureId(FIXTURE_NAMESPACES.NODE, 1),
    kind: NODE_KINDS.CODE,
    position: { x: MAX_GRAPH_COORDINATE, y: -MAX_GRAPH_COORDINATE },
    size: { width: MAX_NODE_WIDTH, height: MAX_NODE_HEIGHT },
    title: 'Code',
    color: COLOR_TOKENS.BLUE,
    content: { language: CODE_LANGUAGES.SHELL, body: 'x'.repeat(MAX_CONTENT_BODY_CHARACTERS) },
  };
  graph.edges[0] = {
    ...graph.edges[0]!,
    label: 'x'.repeat(MAX_EDGE_LABEL_CHARACTERS),
    protocol: 'x'.repeat(MAX_EDGE_PROTOCOL_CHARACTERS),
  };
  graph.boundaries[0] = {
    ...graph.boundaries[0]!,
    title: 'x'.repeat(MAX_BOUNDARY_TITLE_CHARACTERS),
    rect: {
      x: -MAX_GRAPH_COORDINATE,
      y: MAX_GRAPH_COORDINATE,
      width: MAX_RECT_DIMENSION,
      height: MAX_RECT_DIMENSION,
    },
  };
  graph.steps[0] = {
    ...graph.steps[0]!,
    title: 'x'.repeat(MAX_STEP_TITLE_CHARACTERS),
    notes: 'x'.repeat(MAX_STEP_NOTES_CHARACTERS),
    order: MIN_STEP_ORDER,
    rect: {
      x: MAX_GRAPH_COORDINATE,
      y: -MAX_GRAPH_COORDINATE,
      width: MAX_RECT_DIMENSION,
      height: MAX_RECT_DIMENSION,
    },
    nodeIds,
    edgeIds: [],
  };
  graph.steps[1] = { ...graph.steps[1]!, order: MAX_STEP_ORDER };

  return graph;
}
