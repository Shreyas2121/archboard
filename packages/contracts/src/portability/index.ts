import { z } from 'zod';

import {
  boardDescriptionSchema,
  boardSummaryResponseSchema,
  boardTitleSchema,
} from '../boards/index.js';
import { graphProjectionSchema } from '../graph/index.js';
import { utcTimestampSchema } from '../http/index.js';

export const EXPORT_FORMAT_VERSION = 1 as const;
export const templateIdSchema = z.enum(['web-application', 'event-processing', 'service-boundary']);

// Import is a complete standalone graph. Live CRDT projection deliberately retains its
// separate, concurrency-tolerant contract; do not apply these refinements to live updates.
export const portableGraphProjectionSchema = graphProjectionSchema.superRefine((graph, context) => {
  const nodes = new Set(graph.nodes.map(({ id }) => id));
  const edges = new Set(graph.edges.map(({ id }) => id));
  const ids = new Set<string>();
  for (const kind of ['nodes', 'edges', 'boundaries', 'steps'] as const) {
    graph[kind].forEach(({ id }, index) => {
      if (ids.has(id))
        context.addIssue({
          code: 'custom',
          path: [kind, index, 'id'],
          message: 'Entity IDs must be unique across the graph.',
        });
      ids.add(id);
    });
  }
  graph.edges.forEach((edge, index) => {
    for (const field of ['sourceId', 'targetId'] as const) {
      if (!nodes.has(edge[field]))
        context.addIssue({
          code: 'custom',
          path: ['edges', index, field],
          message: 'Endpoint must reference a live node.',
        });
    }
    if (edge.sourceId === edge.targetId)
      context.addIssue({
        code: 'custom',
        path: ['edges', index, 'targetId'],
        message: 'Self-loops are not supported.',
      });
  });
  graph.steps.forEach((step, index) => {
    for (const field of ['nodeIds', 'edgeIds'] as const) {
      const targets = field === 'nodeIds' ? nodes : edges;
      const seen = new Set<string>();
      step[field].forEach((id, referenceIndex) => {
        if (!targets.has(id) || seen.has(id))
          context.addIssue({
            code: 'custom',
            path: ['steps', index, field, referenceIndex],
            message: 'Highlight must reference a unique live target of the correct kind.',
          });
        seen.add(id);
      });
    }
  });
});

export const exportEnvelopeSchema = z.strictObject({
  format: z.literal('archboard'),
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: utcTimestampSchema,
  syncStatusAtExport: z.enum(['server-saved', 'local-only']),
  board: z.strictObject({ title: boardTitleSchema, description: boardDescriptionSchema }),
  graph: portableGraphProjectionSchema,
});

export const importBoardSchema = z.strictObject({
  title: boardTitleSchema,
  file: exportEnvelopeSchema,
});
// Blank and fixed-template creation share the existing private-board route.
export const createTemplateBoardSchema = z.strictObject({
  title: boardTitleSchema,
  description: boardDescriptionSchema.optional(),
  templateId: templateIdSchema.optional(),
});
export const importBoardResponseSchema = boardSummaryResponseSchema;
export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;
export type ImportBoard = z.infer<typeof importBoardSchema>;
export type ImportBoardResponse = z.infer<typeof importBoardResponseSchema>;
export type TemplateId = z.infer<typeof templateIdSchema>;
export type CreateTemplateBoard = z.infer<typeof createTemplateBoardSchema>;
