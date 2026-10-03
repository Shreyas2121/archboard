import { z } from 'zod';

import {
  applicationIdSchema,
  graphNodeSchema,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
} from '../graph/index.js';
import * as limits from '../limits/index.js';
import {
  AI_SCHEMA_VERSION,
  aiByteLimit,
  aiNonblankTextSchema,
  aiReferences,
  aiSemanticKeySchema,
  aiTextSchema,
  aiUniqueKeys,
} from './common.js';

const semanticNodeShape = { key: aiSemanticKeySchema };
const omitGeometry = { id: true, position: true, size: true } as const;
export const aiSemanticNodeSchema = z.discriminatedUnion('kind', [
  graphNodeSchema.options[0].omit(omitGeometry).extend(semanticNodeShape),
  graphNodeSchema.options[1].omit(omitGeometry).extend(semanticNodeShape),
  graphNodeSchema.options[2].omit(omitGeometry).extend(semanticNodeShape),
  graphNodeSchema.options[3].omit(omitGeometry).extend(semanticNodeShape),
]);
export const aiSemanticEdgeSchema = z.strictObject({
  key: aiSemanticKeySchema,
  source: aiSemanticKeySchema,
  target: aiSemanticKeySchema,
  label: z.string().max(limits.MAX_EDGE_LABEL_CHARACTERS),
  protocol: z.string().max(limits.MAX_EDGE_PROTOCOL_CHARACTERS),
  direction: z.enum(EDGE_DIRECTIONS),
  style: z.enum(EDGE_STYLES),
});
export const aiSemanticBoundarySchema = z.strictObject({
  key: aiSemanticKeySchema,
  title: z.string().max(limits.MAX_BOUNDARY_TITLE_CHARACTERS),
  nodeKeys: z.array(aiSemanticKeySchema).min(1).max(limits.MAX_AI_OUTPUT_NODES),
});
export const aiSemanticStepSchema = z.strictObject({
  key: aiSemanticKeySchema,
  title: z.string().max(limits.MAX_STEP_TITLE_CHARACTERS),
  notes: z.string().max(limits.MAX_STEP_NOTES_CHARACTERS),
  nodeKeys: z.array(aiSemanticKeySchema).max(limits.MAX_AI_OUTPUT_NODES),
  edgeKeys: z.array(aiSemanticKeySchema).max(limits.MAX_AI_OUTPUT_EDGES),
});

export const aiClaimSchema = z
  .strictObject({
    text: aiNonblankTextSchema,
    provenance: z.enum(['provided', 'evidenced', 'proposed']),
    evidenceKeys: z.array(aiSemanticKeySchema).max(limits.MAX_AI_EVIDENCE_ENTRIES),
  })
  .refine(
    (claim) =>
      claim.provenance === 'evidenced'
        ? claim.evidenceKeys.length > 0
        : claim.evidenceKeys.length === 0,
    {
      path: ['evidenceKeys'],
      message: 'Only evidenced claims carry evidence keys, and they require at least one.',
    },
  );

const commentaryShape = {
  explanation: aiTextSchema,
  claims: z.array(aiClaimSchema).max(limits.MAX_AI_CLAIMS),
  assumptions: z.array(aiNonblankTextSchema).max(limits.MAX_AI_LIST_ITEMS),
  questions: z.array(aiNonblankTextSchema).max(limits.MAX_AI_QUESTIONS),
};

export const aiDiagramProposalSchema = z
  .strictObject({
    kind: z.literal('diagram'),
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    nodes: z.array(aiSemanticNodeSchema).min(1).max(limits.MAX_AI_OUTPUT_NODES),
    edges: z.array(aiSemanticEdgeSchema).max(limits.MAX_AI_OUTPUT_EDGES),
    boundaries: z.array(aiSemanticBoundarySchema).max(limits.MAX_AI_OUTPUT_BOUNDARIES),
    // Array order is the presentation order; viewport geometry is application-owned.
    steps: z.array(aiSemanticStepSchema).max(limits.MAX_AI_OUTPUT_STEPS),
    ...commentaryShape,
  })
  .superRefine((value, context) => {
    const nodes = aiUniqueKeys(value.nodes, ['nodes'], context);
    const edges = aiUniqueKeys(value.edges, ['edges'], context);
    const all = new Set<string>();
    for (const kind of ['nodes', 'edges', 'boundaries', 'steps'] as const) {
      aiUniqueKeys(value[kind], [kind], context);
      value[kind].forEach(({ key }, index) => {
        if (all.has(key))
          context.addIssue({
            code: 'custom',
            path: [kind, index, 'key'],
            message: 'Proposal keys must be unique across entity kinds.',
          });
        all.add(key);
      });
    }
    value.edges.forEach((edge, index) =>
      aiReferences([edge.source, edge.target], nodes, ['edges', index], context),
    );
    value.boundaries.forEach((boundary, index) =>
      aiReferences(boundary.nodeKeys, nodes, ['boundaries', index, 'nodeKeys'], context),
    );
    value.steps.forEach((step, index) => {
      aiReferences(step.nodeKeys, nodes, ['steps', index, 'nodeKeys'], context);
      aiReferences(step.edgeKeys, edges, ['steps', index, 'edgeKeys'], context);
    });
  });

export const aiClarificationSchema = z.strictObject({
  kind: z.literal('clarification'),
  schemaVersion: z.literal(AI_SCHEMA_VERSION),
  explanation: aiTextSchema,
  questions: z.array(aiNonblankTextSchema).min(1).max(limits.MAX_AI_QUESTIONS),
});
export const aiGuidanceSchema = z
  .strictObject({
    kind: z.literal('guidance'),
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    ...commentaryShape,
    highlightNodeIds: z.array(applicationIdSchema).max(limits.MAX_AI_CONTEXT_COMPONENTS),
    highlightEdgeIds: z.array(applicationIdSchema).max(limits.MAX_AI_CONTEXT_CONNECTIONS),
  })
  .superRefine((value, context) => {
    for (const field of ['highlightNodeIds', 'highlightEdgeIds'] as const)
      if (new Set(value[field]).size !== value[field].length)
        context.addIssue({ code: 'custom', path: [field], message: 'Highlights must be unique.' });
  });

// Each operation names exactly the reviewed fields. Endpoint/kind edits, deletion,
// whole-document replacement and arbitrary patches are deliberately absent.
export const aiOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add-node'), node: aiSemanticNodeSchema }),
  z.strictObject({ type: z.literal('add-edge'), edge: aiSemanticEdgeSchema }),
  z.strictObject({
    type: z.literal('rename-node'),
    nodeId: applicationIdSchema,
    expectedTitle: z.string().max(limits.MAX_NODE_TITLE_CHARACTERS),
    title: z.string().max(limits.MAX_NODE_TITLE_CHARACTERS),
  }),
  z.strictObject({
    type: z.literal('label-edge'),
    edgeId: applicationIdSchema,
    expectedLabel: z.string().max(limits.MAX_EDGE_LABEL_CHARACTERS),
    label: z.string().max(limits.MAX_EDGE_LABEL_CHARACTERS),
    expectedProtocol: z.string().max(limits.MAX_EDGE_PROTOCOL_CHARACTERS),
    protocol: z.string().max(limits.MAX_EDGE_PROTOCOL_CHARACTERS),
  }),
  z.strictObject({
    type: z.literal('set-component-properties'),
    nodeId: applicationIdSchema,
    expected: graphNodeSchema.options[0].shape.content,
    content: graphNodeSchema.options[0].shape.content,
  }),
  z.strictObject({
    type: z.literal('set-code-body'),
    nodeId: applicationIdSchema,
    expected: graphNodeSchema.options[1].shape.content,
    content: graphNodeSchema.options[1].shape.content,
  }),
  z.strictObject({
    type: z.literal('set-schema-body'),
    nodeId: applicationIdSchema,
    expectedBody: z.string().max(limits.MAX_CONTENT_BODY_CHARACTERS),
    body: z.string().max(limits.MAX_CONTENT_BODY_CHARACTERS),
  }),
  z.strictObject({
    type: z.literal('set-note-body'),
    nodeId: applicationIdSchema,
    expectedBody: z.string().max(limits.MAX_CONTENT_BODY_CHARACTERS),
    body: z.string().max(limits.MAX_CONTENT_BODY_CHARACTERS),
  }),
]);

export const aiEditProposalSchema = z.strictObject({
  kind: z.literal('edits'),
  schemaVersion: z.literal(AI_SCHEMA_VERSION),
  operations: z.array(aiOperationSchema).min(1).max(limits.MAX_AI_OPERATIONS),
  ...commentaryShape,
});
export const aiPresentationProposalSchema = z
  .strictObject({
    kind: z.literal('presentation'),
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    mode: z.enum(['append', 'replace-reviewed']),
    expectedStepIds: z.array(applicationIdSchema).max(limits.MAX_LIVE_PRESENTATION_STEPS),
    steps: z
      .array(
        z.strictObject({
          key: aiSemanticKeySchema,
          title: z.string().max(limits.MAX_STEP_TITLE_CHARACTERS),
          notes: z.string().max(limits.MAX_STEP_NOTES_CHARACTERS),
          nodeIds: z.array(applicationIdSchema).max(limits.MAX_AI_CONTEXT_COMPONENTS),
          edgeIds: z.array(applicationIdSchema).max(limits.MAX_AI_CONTEXT_CONNECTIONS),
        }),
      )
      .min(1)
      .max(limits.MAX_AI_OUTPUT_STEPS),
    ...commentaryShape,
  })
  .superRefine((value, context) => {
    aiUniqueKeys(value.steps, ['steps'], context);
    if (new Set(value.expectedStepIds).size !== value.expectedStepIds.length)
      context.addIssue({
        code: 'custom',
        path: ['expectedStepIds'],
        message: 'Step preconditions must be unique.',
      });
  });

export const aiResultSchema = aiByteLimit(
  z.discriminatedUnion('kind', [
    aiDiagramProposalSchema,
    aiClarificationSchema,
    aiGuidanceSchema,
    aiEditProposalSchema,
    aiPresentationProposalSchema,
  ]),
  limits.MAX_AI_RESULT_BYTES,
);

export type AiSemanticNode = z.infer<typeof aiSemanticNodeSchema>;
export type AiSemanticEdge = z.infer<typeof aiSemanticEdgeSchema>;
export type AiSemanticBoundary = z.infer<typeof aiSemanticBoundarySchema>;
export type AiSemanticStep = z.infer<typeof aiSemanticStepSchema>;
export type AiClaim = z.infer<typeof aiClaimSchema>;
export type AiDiagramProposal = z.infer<typeof aiDiagramProposalSchema>;
export type AiClarification = z.infer<typeof aiClarificationSchema>;
export type AiGuidance = z.infer<typeof aiGuidanceSchema>;
export type AiOperation = z.infer<typeof aiOperationSchema>;
export type AiEditProposal = z.infer<typeof aiEditProposalSchema>;
export type AiPresentationProposal = z.infer<typeof aiPresentationProposalSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;
