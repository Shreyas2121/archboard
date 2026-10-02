import {
  CODE_LANGUAGES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  GRAPH_SCHEMA_VERSION,
  HANDLES,
  graphProjectionSchema,
  portableGraphProjectionSchema,
  type GraphProjection,
} from '@archboard/contracts';

import { FIXTURE_NAMESPACES, fixtureId } from '../ids.js';

export const WEB_APPLICATION_TEMPLATE_NAME = 'web-application';

const TEMPLATE_ORDINALS = {
  BROWSER: 101,
  API: 102,
  DATABASE: 103,
  CACHE: 104,
  PAYLOAD: 105,
} as const;

const SOURCE_IDS = {
  browser: fixtureId(FIXTURE_NAMESPACES.NODE, TEMPLATE_ORDINALS.BROWSER),
  api: fixtureId(FIXTURE_NAMESPACES.NODE, TEMPLATE_ORDINALS.API),
  database: fixtureId(FIXTURE_NAMESPACES.NODE, TEMPLATE_ORDINALS.DATABASE),
  cache: fixtureId(FIXTURE_NAMESPACES.NODE, TEMPLATE_ORDINALS.CACHE),
  payload: fixtureId(FIXTURE_NAMESPACES.NODE, TEMPLATE_ORDINALS.PAYLOAD),
  https: fixtureId(FIXTURE_NAMESPACES.EDGE, TEMPLATE_ORDINALS.BROWSER),
  sql: fixtureId(FIXTURE_NAMESPACES.EDGE, TEMPLATE_ORDINALS.API),
  cacheConnection: fixtureId(FIXTURE_NAMESPACES.EDGE, TEMPLATE_ORDINALS.DATABASE),
  boundary: fixtureId(FIXTURE_NAMESPACES.BOUNDARY, TEMPLATE_ORDINALS.BROWSER),
  browserStep: fixtureId(FIXTURE_NAMESPACES.STEP, TEMPLATE_ORDINALS.BROWSER),
  apiStep: fixtureId(FIXTURE_NAMESPACES.STEP, TEMPLATE_ORDINALS.API),
  cacheStep: fixtureId(FIXTURE_NAMESPACES.STEP, TEMPLATE_ORDINALS.DATABASE),
  databaseStep: fixtureId(FIXTURE_NAMESPACES.STEP, TEMPLATE_ORDINALS.CACHE),
} as const;

export const webApplicationTemplate: GraphProjection = portableGraphProjectionSchema.parse({
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes: [
    {
      id: SOURCE_IDS.browser,
      kind: 'component',
      position: { x: 0, y: 120 },
      size: { width: 240, height: 150 },
      title: 'Browser',
      color: COLOR_TOKENS.BLUE,
      content: {
        category: COMPONENT_CATEGORIES.CLIENT,
        description: 'Loads the web application and sends requests.',
        technology: 'React',
        externalUrl: null,
      },
    },
    {
      id: SOURCE_IDS.api,
      kind: 'component',
      position: { x: 400, y: 120 },
      size: { width: 240, height: 150 },
      title: 'API service',
      color: COLOR_TOKENS.TEAL,
      content: {
        category: COMPONENT_CATEGORIES.SERVICE,
        description: 'Validates requests and coordinates application data.',
        technology: 'Node.js',
        externalUrl: null,
      },
    },
    {
      id: SOURCE_IDS.database,
      kind: 'component',
      position: { x: 800, y: 0 },
      size: { width: 240, height: 150 },
      title: 'Database',
      color: COLOR_TOKENS.VIOLET,
      content: {
        category: COMPONENT_CATEGORIES.DATABASE,
        description: 'Stores durable application records.',
        technology: 'PostgreSQL',
        externalUrl: null,
      },
    },
    {
      id: SOURCE_IDS.cache,
      kind: 'component',
      position: { x: 800, y: 240 },
      size: { width: 240, height: 150 },
      title: 'Cache',
      color: COLOR_TOKENS.AMBER,
      content: {
        category: COMPONENT_CATEGORIES.CACHE,
        description: 'Serves frequently requested values.',
        technology: 'Redis',
        externalUrl: null,
      },
    },
    {
      id: SOURCE_IDS.payload,
      kind: 'code',
      position: { x: 0, y: 360 },
      size: { width: 320, height: 180 },
      title: 'Request payload',
      color: COLOR_TOKENS.GRAY,
      content: {
        language: CODE_LANGUAGES.JSON,
        body: '{\n  "path": "/api/boards",\n  "method": "GET"\n}',
      },
    },
  ],
  edges: [
    {
      id: SOURCE_IDS.https,
      sourceId: SOURCE_IDS.browser,
      targetId: SOURCE_IDS.api,
      sourceHandle: HANDLES.RIGHT,
      targetHandle: HANDLES.LEFT,
      label: 'Request',
      protocol: 'HTTPS',
      direction: EDGE_DIRECTIONS.FORWARD,
      style: EDGE_STYLES.SOLID,
    },
    {
      id: SOURCE_IDS.sql,
      sourceId: SOURCE_IDS.api,
      targetId: SOURCE_IDS.database,
      sourceHandle: HANDLES.RIGHT,
      targetHandle: HANDLES.LEFT,
      label: 'Query',
      protocol: 'SQL',
      direction: EDGE_DIRECTIONS.BIDIRECTIONAL,
      style: EDGE_STYLES.SOLID,
    },
    {
      id: SOURCE_IDS.cacheConnection,
      sourceId: SOURCE_IDS.api,
      targetId: SOURCE_IDS.cache,
      sourceHandle: HANDLES.BOTTOM,
      targetHandle: HANDLES.LEFT,
      label: 'Lookup',
      protocol: 'Cache',
      direction: EDGE_DIRECTIONS.BIDIRECTIONAL,
      style: EDGE_STYLES.DASHED,
    },
  ],
  boundaries: [
    {
      id: SOURCE_IDS.boundary,
      title: 'Backend',
      rect: { x: 340, y: -80, width: 760, height: 550 },
      color: COLOR_TOKENS.GRAY,
    },
  ],
  steps: [
    {
      id: SOURCE_IDS.browserStep,
      title: 'Send request',
      notes: 'The browser sends an HTTPS request to the API.',
      order: 0,
      rect: { x: -40, y: 70, width: 720, height: 240 },
      nodeIds: [SOURCE_IDS.browser, SOURCE_IDS.api],
      edgeIds: [SOURCE_IDS.https],
    },
    {
      id: SOURCE_IDS.apiStep,
      title: 'Handle request',
      notes: 'The API validates the request payload.',
      order: 1,
      rect: { x: -40, y: 70, width: 720, height: 510 },
      nodeIds: [SOURCE_IDS.api, SOURCE_IDS.payload],
      edgeIds: [],
    },
    {
      id: SOURCE_IDS.cacheStep,
      title: 'Check cache',
      notes: 'The API checks for a cached response.',
      order: 2,
      rect: { x: 340, y: 70, width: 740, height: 360 },
      nodeIds: [SOURCE_IDS.api, SOURCE_IDS.cache],
      edgeIds: [SOURCE_IDS.cacheConnection],
    },
    {
      id: SOURCE_IDS.databaseStep,
      title: 'Read database',
      notes: 'A cache miss continues to the database.',
      order: 3,
      rect: { x: 340, y: -40, width: 740, height: 350 },
      nodeIds: [SOURCE_IDS.api, SOURCE_IDS.database],
      edgeIds: [SOURCE_IDS.sql],
    },
  ],
});

export function instantiateWebApplicationTemplate(createId: () => string): GraphProjection {
  const source = graphProjectionSchema.parse(webApplicationTemplate);
  const entityIds = [...source.nodes, ...source.edges, ...source.boundaries, ...source.steps].map(
    ({ id }) => id,
  );
  const ids = new Map(entityIds.map((id) => [id, createId()]));
  const remap = (id: string): string => {
    const replacement = ids.get(id);
    if (replacement === undefined) throw new Error(`Template reference ${id} cannot be remapped.`);
    return replacement;
  };
  return graphProjectionSchema.parse({
    schemaVersion: source.schemaVersion,
    nodes: source.nodes.map((node) => ({ ...node, id: remap(node.id) })),
    edges: source.edges.map((edge) => ({
      ...edge,
      id: remap(edge.id),
      sourceId: remap(edge.sourceId),
      targetId: remap(edge.targetId),
    })),
    boundaries: source.boundaries.map((boundary) => ({ ...boundary, id: remap(boundary.id) })),
    steps: source.steps.map((step) => ({
      ...step,
      id: remap(step.id),
      nodeIds: step.nodeIds.map(remap),
      edgeIds: step.edgeIds.map(remap),
    })),
  });
}
