import { describe, expect, it } from 'vitest';

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
import { GRAPH_SCHEMA_VERSION, graphProjectionSchema, type GraphProjection } from './schemas.js';

const UUID_SUFFIX_LENGTH = 12;
const HEXADECIMAL_RADIX = 16;
const COMPONENT_INDEX = 1;
const CODE_INDEX = 2;
const SCHEMA_INDEX = 3;
const NOTE_INDEX = 4;
const EDGE_INDEX = 5;
const BOUNDARY_INDEX = 6;
const STEP_INDEX = 7;

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(HEXADECIMAL_RADIX).padStart(UUID_SUFFIX_LENGTH, '0')}`;
}

const COMPONENT_ID = testUuid(COMPONENT_INDEX);
const CODE_ID = testUuid(CODE_INDEX);
const SCHEMA_ID = testUuid(SCHEMA_INDEX);
const NOTE_ID = testUuid(NOTE_INDEX);
const EDGE_ID = testUuid(EDGE_INDEX);
const BOUNDARY_ID = testUuid(BOUNDARY_INDEX);
const STEP_ID = testUuid(STEP_INDEX);

const componentNode = {
  id: COMPONENT_ID,
  kind: 'component' as const,
  position: { x: 10, y: 20 },
  size: { width: 320, height: 180 },
  title: 'Web client',
  color: 'blue' as const,
  content: {
    category: 'client' as const,
    description: 'Browser application',
    technology: 'React',
    externalUrl: 'https://react.dev',
  },
};

const validGraph: GraphProjection = {
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes: [
    componentNode,
    {
      ...componentNode,
      id: CODE_ID,
      kind: 'code',
      content: { language: 'typescript', body: 'export {};' },
    },
    {
      ...componentNode,
      id: SCHEMA_ID,
      kind: 'schema',
      content: { body: 'users(id)' },
    },
    {
      ...componentNode,
      id: NOTE_ID,
      kind: 'note',
      content: { body: 'A design note' },
    },
  ],
  edges: [
    {
      id: EDGE_ID,
      sourceId: COMPONENT_ID,
      targetId: CODE_ID,
      sourceHandle: 'right',
      targetHandle: 'left',
      label: 'Request',
      protocol: 'HTTPS',
      direction: 'forward',
      style: 'solid',
    },
  ],
  boundaries: [
    {
      id: BOUNDARY_ID,
      title: 'Browser',
      rect: { x: 0, y: 0, width: 800, height: 600 },
      color: 'gray',
    },
  ],
  steps: [
    {
      id: STEP_ID,
      title: 'Request flow',
      notes: '',
      order: 0,
      rect: { x: 0, y: 0, width: 800, height: 600 },
      nodeIds: [COMPONENT_ID, CODE_ID],
      edgeIds: [EDGE_ID],
    },
  ],
};

describe('logical graph projection contract', () => {
  it('parses every entity and discriminated node-content variant', () => {
    expect(graphProjectionSchema.parse(validGraph)).toEqual(validGraph);
  });

  it.each([
    ['top-level fields', { ...validGraph, metadata: {} }],
    ['node fields', { ...validGraph, nodes: [{ ...componentNode, metadata: {} }] }],
    [
      'node content fields',
      {
        ...validGraph,
        nodes: [{ ...componentNode, content: { ...componentNode.content, arbitrary: true } }],
      },
    ],
  ])('rejects unknown %s', (_caseName, candidate) => {
    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects content that does not match the node-kind discriminator', () => {
    const candidate = {
      ...validGraph,
      nodes: [{ ...componentNode, kind: 'note', content: componentNode.content }],
    };

    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ['invalid UUID', { ...componentNode, id: 'node-1' }],
    ['non-finite coordinate', { ...componentNode, position: { x: Number.NaN, y: 0 } }],
    [
      'coordinate beyond the graph bound',
      { ...componentNode, position: { x: MAX_GRAPH_COORDINATE + 1, y: 0 } },
    ],
    [
      'dimension beyond the node bound',
      { ...componentNode, size: { width: MAX_NODE_WIDTH + 1, height: 180 } },
    ],
    ['unknown enum', { ...componentNode, color: 'orange' }],
    [
      'unsupported URL protocol',
      { ...componentNode, content: { ...componentNode.content, externalUrl: 'ftp://example.com' } },
    ],
    ['oversized title', { ...componentNode, title: 'x'.repeat(MAX_NODE_TITLE_CHARACTERS + 1) }],
  ])('rejects a node with an %s', (_caseName, node) => {
    expect(graphProjectionSchema.safeParse({ ...validGraph, nodes: [node] }).success).toBe(false);
  });

  it('rejects an oversized kind-specific body', () => {
    const candidate = {
      ...validGraph,
      nodes: [
        {
          ...componentNode,
          kind: 'note',
          content: { body: 'x'.repeat(MAX_CONTENT_BODY_CHARACTERS + 1) },
        },
      ],
    };

    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    [
      'component description',
      {
        ...validGraph,
        nodes: [
          {
            ...componentNode,
            content: {
              ...componentNode.content,
              description: 'x'.repeat(MAX_COMPONENT_DESCRIPTION_CHARACTERS + 1),
            },
          },
        ],
      },
    ],
    [
      'technology',
      {
        ...validGraph,
        nodes: [
          {
            ...componentNode,
            content: {
              ...componentNode.content,
              technology: 'x'.repeat(MAX_TECHNOLOGY_CHARACTERS + 1),
            },
          },
        ],
      },
    ],
    [
      'external URL',
      {
        ...validGraph,
        nodes: [
          {
            ...componentNode,
            content: {
              ...componentNode.content,
              externalUrl: `https://example.com/${'x'.repeat(MAX_EXTERNAL_URL_CHARACTERS)}`,
            },
          },
        ],
      },
    ],
    [
      'edge label',
      {
        ...validGraph,
        edges: [{ ...validGraph.edges[0], label: 'x'.repeat(MAX_EDGE_LABEL_CHARACTERS + 1) }],
      },
    ],
    [
      'edge protocol',
      {
        ...validGraph,
        edges: [{ ...validGraph.edges[0], protocol: 'x'.repeat(MAX_EDGE_PROTOCOL_CHARACTERS + 1) }],
      },
    ],
    [
      'boundary title',
      {
        ...validGraph,
        boundaries: [
          {
            ...validGraph.boundaries[0],
            title: 'x'.repeat(MAX_BOUNDARY_TITLE_CHARACTERS + 1),
          },
        ],
      },
    ],
    [
      'step title',
      {
        ...validGraph,
        steps: [{ ...validGraph.steps[0], title: 'x'.repeat(MAX_STEP_TITLE_CHARACTERS + 1) }],
      },
    ],
    [
      'step notes',
      {
        ...validGraph,
        steps: [{ ...validGraph.steps[0], notes: 'x'.repeat(MAX_STEP_NOTES_CHARACTERS + 1) }],
      },
    ],
  ])('rejects an oversized %s', (_field, candidate) => {
    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    [
      'node width below minimum',
      { ...componentNode, size: { width: MIN_NODE_WIDTH - 1, height: 180 } },
    ],
    [
      'node height below minimum',
      { ...componentNode, size: { width: 320, height: MIN_NODE_HEIGHT - 1 } },
    ],
    [
      'node height above maximum',
      { ...componentNode, size: { width: 320, height: MAX_NODE_HEIGHT + 1 } },
    ],
  ])('rejects %s', (_caseName, node) => {
    expect(graphProjectionSchema.safeParse({ ...validGraph, nodes: [node] }).success).toBe(false);
  });

  it.each([
    ['non-positive rectangle', { width: 0, height: 600 }],
    ['oversized rectangle', { width: MAX_RECT_DIMENSION + 1, height: 600 }],
  ])('rejects a %s', (_caseName, dimensions) => {
    const candidate = {
      ...validGraph,
      boundaries: [
        {
          ...validGraph.boundaries[0],
          rect: { ...validGraph.boundaries[0]?.rect, ...dimensions },
        },
      ],
    };

    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([MIN_STEP_ORDER - 1, MAX_STEP_ORDER + 1])(
    'rejects out-of-range step order %s',
    (order) => {
      const candidate = { ...validGraph, steps: [{ ...validGraph.steps[0], order }] };

      expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it.each([
    [
      'component category',
      { ...componentNode, content: { ...componentNode.content, category: 'worker' } },
    ],
    [
      'code language',
      { ...componentNode, kind: 'code', content: { language: 'python', body: '' } },
    ],
  ])('rejects an unknown %s enum', (_caseName, node) => {
    expect(graphProjectionSchema.safeParse({ ...validGraph, nodes: [node] }).success).toBe(false);
  });

  it.each([
    ['handle', { ...validGraph.edges[0], sourceHandle: 'center' }],
    ['direction', { ...validGraph.edges[0], direction: 'backward' }],
    ['style', { ...validGraph.edges[0], style: 'dotted' }],
  ])('rejects an unknown edge %s enum', (_caseName, edge) => {
    expect(graphProjectionSchema.safeParse({ ...validGraph, edges: [edge] }).success).toBe(false);
  });

  it('rejects live entity counts beyond their centralized limit', () => {
    const nodes = Array.from({ length: MAX_LIVE_NODES + 1 }, (_unused, index) => ({
      ...componentNode,
      id: testUuid(index + 1),
    }));

    expect(graphProjectionSchema.safeParse({ ...validGraph, nodes }).success).toBe(false);
  });

  it('rejects more than the combined unique step-reference limit', () => {
    const nodeIds = Array.from({ length: MAX_STEP_REFERENCES }, (_unused, index) =>
      testUuid(index + 1),
    );
    const candidate = {
      ...validGraph,
      steps: [{ ...validGraph.steps[0], nodeIds, edgeIds: [testUuid(MAX_STEP_REFERENCES + 1)] }],
    };

    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects duplicate entity IDs', () => {
    const candidate = { ...validGraph, nodes: [componentNode, componentNode] };

    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ['edges', MAX_LIVE_EDGES, validGraph.edges[0]],
    ['boundaries', MAX_LIVE_BOUNDARIES, validGraph.boundaries[0]],
    ['steps', MAX_LIVE_PRESENTATION_STEPS, validGraph.steps[0]],
  ] as const)('rejects %s beyond its live-entity limit', (collection, maximum, entity) => {
    const candidate = {
      ...validGraph,
      [collection]: Array.from({ length: maximum + 1 }, () => entity),
    };

    expect(graphProjectionSchema.safeParse(candidate).success).toBe(false);
  });
});
