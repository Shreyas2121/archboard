export const GRAPH_ROOT_NAMES = {
  META: 'meta',
  NODES: 'nodes',
  EDGES: 'edges',
  BOUNDARIES: 'boundaries',
  STEPS: 'steps',
  DELETED_NODES: 'deletedNodes',
  DELETED_EDGES: 'deletedEdges',
  DELETED_BOUNDARIES: 'deletedBoundaries',
  DELETED_STEPS: 'deletedSteps',
} as const;

export const META_FIELDS = { SCHEMA_VERSION: 'schemaVersion' } as const;

export const NODE_FIELDS = {
  KIND: 'kind',
  POSITION: 'position',
  SIZE: 'size',
  TITLE: 'title',
  COLOR: 'color',
  CATEGORY: 'category',
  DESCRIPTION: 'description',
  TECHNOLOGY: 'technology',
  EXTERNAL_URL: 'externalUrl',
  LANGUAGE: 'language',
  BODY: 'body',
} as const;

export const EDGE_FIELDS = {
  SOURCE_ID: 'sourceId',
  TARGET_ID: 'targetId',
  SOURCE_HANDLE: 'sourceHandle',
  TARGET_HANDLE: 'targetHandle',
  LABEL: 'label',
  PROTOCOL: 'protocol',
  DIRECTION: 'direction',
  STYLE: 'style',
} as const;

export const BOUNDARY_FIELDS = {
  TITLE: 'title',
  RECT: 'rect',
  COLOR: 'color',
} as const;

export const STEP_FIELDS = {
  TITLE: 'title',
  NOTES: 'notes',
  ORDER: 'order',
  RECT: 'rect',
  NODE_IDS: 'nodeIds',
  EDGE_IDS: 'edgeIds',
} as const;
