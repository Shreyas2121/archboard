import { describe, expect, it } from 'vitest';

import {
  createCheckpointSchema,
  checkpointDetailSchema,
  checkpointListQuerySchema,
  checkpointPathSchema,
  checkpointSummarySchema,
  restoreCheckpointSchema,
} from '../checkpoints/index.js';
import { graphProjectionSchema, type GraphProjection } from '../graph/index.js';
import { encodePageCursor } from '../pagination/index.js';
import {
  createTemplateBoardSchema,
  exportEnvelopeSchema,
  importBoardSchema,
  type ExportEnvelope,
} from './index.js';

const UUID_SUFFIX_LENGTH = 12;
const CODE_ID_INDEX = 2;
const EDGE_ID_INDEX = 5;
const BOUNDARY_ID_INDEX = 6;
const STEP_ID_INDEX = 7;
const MISSING_ID_INDEX = 8;
const BOARD_ID_INDEX = 9;
const UNSUPPORTED_VERSION = 2;
const OVERSIZED_NOTES = 4_001;
const GENERATED_ID_START = 100;
const OVERSIZED_NAME = 121;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(UUID_SUFFIX_LENGTH, '0')}`;
const timestamp = '2026-10-01T00:00:00.000Z';
function fixture(): ExportEnvelope {
  const graph: GraphProjection = {
    schemaVersion: 1,
    nodes: ['component', 'code', 'schema', 'note'].map((kind, index) => ({
      id: id(index + 1),
      kind,
      title: '<script>inert</script>',
      color: 'blue',
      position: { x: 0, y: 0 },
      size: { width: 320, height: 180 },
      content:
        kind === 'component'
          ? {
              category: 'service',
              technology: '',
              description: '',
              externalUrl: 'https://example.test',
            }
          : kind === 'code'
            ? { language: 'json', body: '{}' }
            : { body: 'text' },
    })) as GraphProjection['nodes'],
    edges: [
      {
        id: id(EDGE_ID_INDEX),
        sourceId: id(1),
        targetId: id(CODE_ID_INDEX),
        sourceHandle: 'right',
        targetHandle: 'left',
        label: '',
        protocol: '',
        direction: 'forward',
        style: 'solid',
      },
    ],
    boundaries: [
      {
        id: id(BOUNDARY_ID_INDEX),
        title: '',
        color: 'gray',
        rect: { x: 0, y: 0, width: 500, height: 500 },
      },
    ],
    steps: [
      {
        id: id(STEP_ID_INDEX),
        title: 'Walkthrough',
        notes: '',
        order: 0,
        rect: { x: 0, y: 0, width: 500, height: 500 },
        nodeIds: [id(1)],
        edgeIds: [id(EDGE_ID_INDEX)],
      },
    ],
  };
  return {
    format: 'archboard',
    formatVersion: 1,
    exportedAt: timestamp,
    syncStatusAtExport: 'local-only',
    board: { title: 'Synthetic', description: '' },
    graph,
  };
}

describe('strict portability contracts', () => {
  it('accepts all card kinds and inert text without changing content', () => {
    const file = fixture();
    expect(exportEnvelopeSchema.parse(file)).toEqual(file);
    expect(importBoardSchema.parse({ title: ' New board ', file }).title).toBe('New board');
    file.graph.steps[0]!.nodeIds = [];
    file.graph.steps[0]!.edgeIds = [];
    expect(exportEnvelopeSchema.safeParse(file).success).toBe(true);
  });
  it.each([
    ['format', 'other'],
    ['formatVersion', UNSUPPORTED_VERSION],
    ['exportedAt', 'yesterday'],
    ['syncStatusAtExport', 'saved'],
    ['owner', id(MISSING_ID_INDEX)],
    ['throughSeq', '1'],
    ['updateBytes', 'bytes'],
    ['comments', []],
    ['credentials', {}],
  ])('rejects invalid/forged envelope %s', (field, value) => {
    expect(exportEnvelopeSchema.safeParse({ ...fixture(), [field]: value }).success).toBe(false);
  });
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects prototype key %s at every object layer',
    (key) => {
      for (const path of [
        'envelope',
        'board',
        'graph',
        'node',
        'content',
        'position',
        'size',
        'edge',
        'boundary',
        'rect',
        'step',
      ] as const) {
        const file = fixture();
        const target = {
          envelope: file,
          board: file.board,
          graph: file.graph,
          node: file.graph.nodes[0]!,
          content: file.graph.nodes[0]!.content,
          position: file.graph.nodes[0]!.position,
          size: file.graph.nodes[0]!.size,
          edge: file.graph.edges[0]!,
          boundary: file.graph.boundaries[0]!,
          rect: file.graph.steps[0]!.rect,
          step: file.graph.steps[0]!,
        }[path];
        Object.defineProperty(target, key, { value: {}, enumerable: true });
        expect(exportEnvelopeSchema.safeParse(JSON.parse(JSON.stringify(file))).success, path).toBe(
          false,
        );
      }
    },
  );
  const mutations: Record<string, (graph: GraphProjection) => void> = {
    'schema version': (g) => {
      Object.assign(g, { schemaVersion: 2 });
    },
    'invalid ID': (g) => {
      g.nodes[0]!.id = 'bad';
    },
    'duplicate ID': (g) => {
      g.nodes.push(g.nodes[0]!);
    },
    'cross-kind ID collision': (g) => {
      g.boundaries[0]!.id = g.nodes[0]!.id;
    },
    'missing endpoint': (g) => {
      g.edges[0]!.sourceId = id(MISSING_ID_INDEX);
    },
    'self-loop': (g) => {
      g.edges[0]!.targetId = g.edges[0]!.sourceId;
    },
    'dangling node highlight': (g) => {
      g.steps[0]!.nodeIds = [id(MISSING_ID_INDEX)];
    },
    'wrong-kind highlight': (g) => {
      g.steps[0]!.edgeIds = [id(BOUNDARY_ID_INDEX)];
    },
    'repeated highlight': (g) => {
      g.steps[0]!.nodeIds.push(id(1));
    },
    'repeated edge highlight': (g) => {
      g.steps[0]!.edgeIds.push(id(EDGE_ID_INDEX));
    },
    'infinite coordinate': (g) => {
      g.nodes[0]!.position.x = Infinity;
    },
    'coordinate bound': (g) => {
      g.steps[0]!.rect.x = 100_001;
    },
    'zero dimension': (g) => {
      g.steps[0]!.rect.width = 0;
    },
    'large dimension': (g) => {
      g.steps[0]!.rect.height = 20_001;
    },
    'fractional order': (g) => {
      g.steps[0]!.order = 0.5;
    },
    'order bound': (g) => {
      g.steps[0]!.order = 1_000_001;
    },
    'notes bound': (g) => {
      g.steps[0]!.notes = 'x'.repeat(OVERSIZED_NOTES);
    },
    'step count': (g) => {
      g.steps = Array.from({ length: 51 }, (_, i) => ({
        ...g.steps[0]!,
        id: id(i + GENERATED_ID_START),
      }));
    },
    'unsafe URL': (g) => {
      Object.assign(g.nodes[0]!.content, { externalUrl: 'javascript:alert(1)' });
    },
    'data URL': (g) => {
      Object.assign(g.nodes[0]!.content, { externalUrl: 'data:text/html,test' });
    },
    'invalid handle': (g) => {
      Object.assign(g.edges[0]!, { sourceHandle: 'center' });
    },
    'invalid enum': (g) => {
      Object.assign(g.nodes[0]!, { color: 'arbitrary' });
    },
    'forged graph history': (g) => {
      Object.assign(g, { deletedNodes: [] });
    },
  };
  it.each(Object.entries(mutations))('rejects %s', (_name, mutate) => {
    const file = fixture();
    mutate(file.graph);
    expect(exportEnvelopeSchema.safeParse(file).success).toBe(false);
  });
  it('leaves missing/repeated live references tolerated in the existing graph schema', () => {
    const file = fixture();
    file.graph.steps[0]!.nodeIds = [id(MISSING_ID_INDEX), id(MISSING_ID_INDEX)];
    expect(graphProjectionSchema.safeParse(file.graph).success).toBe(true);
    expect(exportEnvelopeSchema.safeParse(file).success).toBe(false);
  });
  it('accepts only fixed template IDs and rejects import target/authority fields', () => {
    for (const templateId of ['web-application', 'event-processing', 'service-boundary'])
      expect(createTemplateBoardSchema.safeParse({ title: 'New', templateId }).success).toBe(true);
    expect(
      createTemplateBoardSchema.safeParse({ title: 'New', templateId: 'custom' }).success,
    ).toBe(false);
    expect(
      importBoardSchema.safeParse({ title: 'New', file: fixture(), boardId: id(BOARD_ID_INDEX) })
        .success,
    ).toBe(false);
    expect(
      createTemplateBoardSchema.safeParse({ title: 'New', owner: id(BOARD_ID_INDEX) }).success,
    ).toBe(false);
  });
});

describe('checkpoint contracts', () => {
  const summary = {
    id: id(MISSING_ID_INDEX),
    boardId: id(BOARD_ID_INDEX),
    name: 'Checkpoint',
    createdBy: { id: 'synthetic-user', name: 'Synthetic', image: null },
    createdAt: timestamp,
    throughSeq: '9007199254740993',
    schemaVersion: 1,
  };
  it('keeps bigint sequences exact and server metadata read-only', () => {
    expect(
      createCheckpointSchema.parse({ name: ' Capture ', expectedSeq: '9223372036854775807' }),
    ).toEqual({ name: 'Capture', expectedSeq: '9223372036854775807' });
    expect(checkpointSummarySchema.parse(summary).throughSeq).toBe('9007199254740993');
    expect(checkpointDetailSchema.safeParse({ ...summary, graph: fixture().graph }).success).toBe(
      true,
    );
    for (const key of [
      'id',
      'boardId',
      'createdBy',
      'createdAt',
      'throughSeq',
      'schemaVersion',
      'updateBytes',
      'graph',
    ])
      expect(
        createCheckpointSchema.safeParse({ name: 'Capture', expectedSeq: '0', [key]: summary.id })
          .success,
      ).toBe(false);
  });
  it.each([0, -1, '', '01', '-1', '1.0', '1e3', ' 1', '9223372036854775808'])(
    'rejects malformed sequence %s',
    (expectedSeq) => {
      expect(createCheckpointSchema.safeParse({ name: 'Capture', expectedSeq }).success).toBe(
        false,
      );
    },
  );
  it('bounds names, paths, queries and restore requests', () => {
    for (const name of ['', ' ', 'x'.repeat(OVERSIZED_NAME)])
      expect(createCheckpointSchema.safeParse({ name, expectedSeq: '0' }).success).toBe(false);
    expect(checkpointListQuerySchema.parse({}).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(
      checkpointListQuerySchema.parse({
        limit: '100',
        cursor: encodePageCursor(timestamp, id(MISSING_ID_INDEX)),
      }).limit,
    ).toBe(MAX_PAGE_SIZE);
    for (const query of [{ limit: '101' }, { limit: '01' }, { cursor: 'bad' }, { owner: id(1) }])
      expect(checkpointListQuerySchema.safeParse(query).success).toBe(false);
    expect(
      checkpointPathSchema.safeParse({ id: id(BOARD_ID_INDEX), checkpointId: id(MISSING_ID_INDEX) })
        .success,
    ).toBe(true);
    expect(
      checkpointPathSchema.safeParse({ id: id(BOARD_ID_INDEX), checkpointId: 'bad' }).success,
    ).toBe(false);
    expect(
      restoreCheckpointSchema.safeParse({ title: 'New', graph: fixture().graph }).success,
    ).toBe(false);
    expect(checkpointSummarySchema.safeParse({ ...summary, updateBytes: 'hidden' }).success).toBe(
      false,
    );
  });
});
