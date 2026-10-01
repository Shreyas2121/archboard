import { z } from 'zod';

import {
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
} from '../limits/index.js';

export const GRAPH_SCHEMA_VERSION = 1 as const;

export const HANDLES = {
  TOP: 'top',
  RIGHT: 'right',
  BOTTOM: 'bottom',
  LEFT: 'left',
} as const;

export const COLOR_TOKENS = {
  GRAY: 'gray',
  BLUE: 'blue',
  TEAL: 'teal',
  GREEN: 'green',
  AMBER: 'amber',
  RED: 'red',
  VIOLET: 'violet',
} as const;

export const NODE_KINDS = {
  COMPONENT: 'component',
  CODE: 'code',
  SCHEMA: 'schema',
  NOTE: 'note',
} as const;

export const COMPONENT_CATEGORIES = {
  CLIENT: 'client',
  SERVICE: 'service',
  DATABASE: 'database',
  QUEUE: 'queue',
  CACHE: 'cache',
  EXTERNAL: 'external',
  GENERIC: 'generic',
} as const;

export const CODE_LANGUAGES = {
  TEXT: 'text',
  TYPESCRIPT: 'typescript',
  JAVASCRIPT: 'javascript',
  JSON: 'json',
  SQL: 'sql',
  YAML: 'yaml',
  SHELL: 'shell',
} as const;

export const EDGE_DIRECTIONS = {
  FORWARD: 'forward',
  BIDIRECTIONAL: 'bidirectional',
} as const;

export const EDGE_STYLES = {
  SOLID: 'solid',
  DASHED: 'dashed',
} as const;

export const applicationIdSchema = z.uuid();

const boundedCoordinateSchema = z
  .number()
  .finite()
  .min(-MAX_GRAPH_COORDINATE)
  .max(MAX_GRAPH_COORDINATE);

export const pointSchema = z.strictObject({
  x: boundedCoordinateSchema,
  y: boundedCoordinateSchema,
});

export const nodeSizeSchema = z.strictObject({
  width: z.number().finite().min(MIN_NODE_WIDTH).max(MAX_NODE_WIDTH),
  height: z.number().finite().min(MIN_NODE_HEIGHT).max(MAX_NODE_HEIGHT),
});

export const rectSchema = z.strictObject({
  x: boundedCoordinateSchema,
  y: boundedCoordinateSchema,
  width: z.number().finite().positive().max(MAX_RECT_DIMENSION),
  height: z.number().finite().positive().max(MAX_RECT_DIMENSION),
});

export const handleSchema = z.enum(HANDLES);
export const colorTokenSchema = z.enum(COLOR_TOKENS);
export const nodeKindSchema = z.enum(NODE_KINDS);

const componentContentSchema = z.strictObject({
  category: z.enum(COMPONENT_CATEGORIES),
  description: z.string().max(MAX_COMPONENT_DESCRIPTION_CHARACTERS),
  technology: z.string().max(MAX_TECHNOLOGY_CHARACTERS),
  externalUrl: z
    .string()
    .max(MAX_EXTERNAL_URL_CHARACTERS)
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'External URLs must use HTTP or HTTPS.')
    .nullable(),
});

const codeContentSchema = z.strictObject({
  language: z.enum(CODE_LANGUAGES),
  body: z.string().max(MAX_CONTENT_BODY_CHARACTERS),
});

const schemaContentSchema = z.strictObject({
  body: z.string().max(MAX_CONTENT_BODY_CHARACTERS),
});

const noteContentSchema = z.strictObject({
  body: z.string().max(MAX_CONTENT_BODY_CHARACTERS),
});

const sharedNodeShape = {
  id: applicationIdSchema,
  position: pointSchema,
  size: nodeSizeSchema,
  title: z.string().max(MAX_NODE_TITLE_CHARACTERS),
  color: colorTokenSchema,
};

export const graphNodeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...sharedNodeShape,
    kind: z.literal(NODE_KINDS.COMPONENT),
    content: componentContentSchema,
  }),
  z.strictObject({
    ...sharedNodeShape,
    kind: z.literal(NODE_KINDS.CODE),
    content: codeContentSchema,
  }),
  z.strictObject({
    ...sharedNodeShape,
    kind: z.literal(NODE_KINDS.SCHEMA),
    content: schemaContentSchema,
  }),
  z.strictObject({
    ...sharedNodeShape,
    kind: z.literal(NODE_KINDS.NOTE),
    content: noteContentSchema,
  }),
]);

export const graphEdgeSchema = z.strictObject({
  id: applicationIdSchema,
  sourceId: applicationIdSchema,
  targetId: applicationIdSchema,
  sourceHandle: handleSchema,
  targetHandle: handleSchema,
  label: z.string().max(MAX_EDGE_LABEL_CHARACTERS),
  protocol: z.string().max(MAX_EDGE_PROTOCOL_CHARACTERS),
  direction: z.enum(EDGE_DIRECTIONS),
  style: z.enum(EDGE_STYLES),
});

export const boundarySchema = z.strictObject({
  id: applicationIdSchema,
  title: z.string().max(MAX_BOUNDARY_TITLE_CHARACTERS),
  rect: rectSchema,
  color: colorTokenSchema,
});

const referenceListSchema = z.array(applicationIdSchema).max(MAX_STEP_REFERENCES);

// Field-only shape for strict partial/reorder command inputs. Complete steps must
// use presentationStepSchema below to enforce the combined reference budget.
export const presentationStepFieldsSchema = z.strictObject({
  id: applicationIdSchema,
  title: z.string().max(MAX_STEP_TITLE_CHARACTERS),
  notes: z.string().max(MAX_STEP_NOTES_CHARACTERS),
  order: z.number().int().min(MIN_STEP_ORDER).max(MAX_STEP_ORDER),
  rect: rectSchema,
  nodeIds: referenceListSchema,
  edgeIds: referenceListSchema,
});

export const presentationStepSchema = presentationStepFieldsSchema.superRefine((step, context) => {
  const uniqueReferences = new Set([...step.nodeIds, ...step.edgeIds]);
  if (uniqueReferences.size > MAX_STEP_REFERENCES) {
    context.addIssue({
      code: 'custom',
      message: `A presentation step may reference at most ${MAX_STEP_REFERENCES} unique objects.`,
      path: ['nodeIds'],
    });
  }
});

function addDuplicateIdIssue(
  entities: readonly { readonly id: string }[],
  path: 'nodes' | 'edges' | 'boundaries' | 'steps',
  context: z.RefinementCtx,
): void {
  if (new Set(entities.map((entity) => entity.id)).size !== entities.length) {
    context.addIssue({
      code: 'custom',
      message: `${path} must not contain duplicate IDs.`,
      path: [path],
    });
  }
}

export const graphProjectionSchema = z
  .strictObject({
    schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
    nodes: z.array(graphNodeSchema).max(MAX_LIVE_NODES),
    edges: z.array(graphEdgeSchema).max(MAX_LIVE_EDGES),
    boundaries: z.array(boundarySchema).max(MAX_LIVE_BOUNDARIES),
    steps: z.array(presentationStepSchema).max(MAX_LIVE_PRESENTATION_STEPS),
  })
  .superRefine((graph, context) => {
    addDuplicateIdIssue(graph.nodes, 'nodes', context);
    addDuplicateIdIssue(graph.edges, 'edges', context);
    addDuplicateIdIssue(graph.boundaries, 'boundaries', context);
    addDuplicateIdIssue(graph.steps, 'steps', context);
  });

export type Point = z.infer<typeof pointSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type Handle = z.infer<typeof handleSchema>;
export type ColorToken = z.infer<typeof colorTokenSchema>;
export type NodeKind = z.infer<typeof nodeKindSchema>;
export type ComponentContent = z.infer<typeof componentContentSchema>;
export type CodeContent = z.infer<typeof codeContentSchema>;
export type SchemaContent = z.infer<typeof schemaContentSchema>;
export type NoteContent = z.infer<typeof noteContentSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type Boundary = z.infer<typeof boundarySchema>;
export type PresentationStep = z.infer<typeof presentationStepSchema>;
export type GraphProjection = z.infer<typeof graphProjectionSchema>;
