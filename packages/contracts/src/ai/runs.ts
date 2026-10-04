import { z } from 'zod';

import { applicationIdSchema } from '../graph/index.js';
import { objectEnvelopeSchema, utcTimestampSchema } from '../http/index.js';
import * as limits from '../limits/index.js';
import { portableGraphProjectionSchema } from '../portability/index.js';
import {
  AI_SCHEMA_VERSION,
  aiByteLimit,
  aiNonblankTextSchema,
  aiSemanticKeySchema,
  aiUnsignedDecimalSchema,
  aiReferences,
  aiUniqueKeys,
} from './common.js';
import { projectContextV1Schema } from './context.js';
import { aiResultSchema } from './proposals.js';

export const aiTaskSchema = z.enum([
  'diagram-described',
  'propose-design',
  'explain-selection',
  'trace-flow',
  'scoped-edit',
  'presentation',
]);
const taskResultKinds = {
  'diagram-described': 'diagram',
  'propose-design': 'diagram',
  'explain-selection': 'guidance',
  'trace-flow': 'guidance',
  'scoped-edit': 'edits',
  presentation: 'presentation',
} as const;
export const aiBoardContextSchema = z
  .strictObject({
    graph: portableGraphProjectionSchema,
    nodeBindings: z
      .array(z.strictObject({ key: aiSemanticKeySchema, nodeId: applicationIdSchema }))
      .max(limits.MAX_AI_CONTEXT_COMPONENTS),
    confirmedServerSequence: aiUnsignedDecimalSchema.nullable(),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.graph.nodes.map((node) => node.id));
    aiUniqueKeys(value.nodeBindings, ['nodeBindings'], context);
    aiReferences(
      value.nodeBindings.map((binding) => binding.nodeId),
      ids,
      ['nodeBindings'],
      context,
    );
    if (ids.size !== value.nodeBindings.length)
      context.addIssue({
        code: 'custom',
        path: ['nodeBindings'],
        message: 'Each reviewed node must have exactly one logical binding.',
      });
    if (
      value.graph.edges.length > limits.MAX_AI_CONTEXT_CONNECTIONS ||
      value.graph.boundaries.length > limits.MAX_AI_CONTEXT_GROUPS
    )
      context.addIssue({
        code: 'custom',
        path: ['graph'],
        message: 'Reviewed graph context budget exceeded.',
      });
  });

export const aiCreateRunSchema = aiByteLimit(
  z
    .strictObject({
      schemaVersion: z.literal(AI_SCHEMA_VERSION),
      task: aiTaskSchema,
      target: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('new-board') }),
        z.strictObject({ kind: z.literal('board'), boardId: applicationIdSchema }),
      ]),
      prompt: z
        .string()
        .max(limits.MAX_AI_PROMPT_CHARACTERS)
        .refine((text) => text.trim().length > 0),
      context: projectContextV1Schema.optional(),
      boardContext: aiBoardContextSchema.optional(),
      history: z
        .array(z.strictObject({ role: z.enum(['user', 'assistant']), text: aiNonblankTextSchema }))
        .max(limits.MAX_AI_HISTORY_MESSAGES)
        .default([]),
    })
    .superRefine((value, context) => {
      if (value.target.kind === 'new-board' && value.boardContext)
        context.addIssue({
          code: 'custom',
          path: ['boardContext'],
          message: 'New-board requests cannot attach existing board context.',
        });
      if (!['diagram-described', 'propose-design'].includes(value.task) && !value.boardContext)
        context.addIssue({
          code: 'custom',
          path: ['boardContext'],
          message: 'This task requires explicitly reviewed board context.',
        });
      if (
        value.history.reduce((sum, entry) => sum + Array.from(entry.text).length, 0) >
        limits.MAX_AI_HISTORY_CHARACTERS
      )
        context.addIssue({
          code: 'custom',
          path: ['history'],
          message: 'History budget exceeded.',
        });
    }),
  limits.MAX_AI_REQUEST_BYTES,
);

export const AI_RUN_STATES = [
  'validating',
  'generating',
  'needs-input',
  'ready-for-review',
  'failed',
  'cancelled',
  'outcome-unknown',
] as const;
export const aiRunStateSchema = z.enum(AI_RUN_STATES);
export const aiErrorCodeSchema = z.enum([
  'AI_DISABLED',
  'AI_ALLOWANCE_REACHED',
  'AI_INPUT_TOO_LARGE',
  'AI_CAPABILITY_UNSUPPORTED',
  'AI_REFUSED',
  'AI_OUTPUT_INVALID',
  'AI_OUTCOME_UNKNOWN',
  'AI_RESULT_EXPIRED',
  'AI_GENERATION_FAILED',
  'RATE_LIMITED',
  'TEMPORARILY_UNAVAILABLE',
]);
// No raw error message, SDK object, provider request ID, prompt, key, or endpoint.
export const aiFailureSchema = z.strictObject({
  code: aiErrorCodeSchema,
  retryAfterSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export const aiRunSchema = z
  .strictObject({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    id: applicationIdSchema,
    task: aiTaskSchema,
    state: aiRunStateSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    content: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('pending') }),
      z.strictObject({
        status: z.literal('available'),
        expiresAt: utcTimestampSchema,
        result: aiResultSchema,
      }),
      z.strictObject({ status: z.literal('expired'), expiredAt: utcTimestampSchema }),
      z.strictObject({ status: z.literal('unavailable') }),
    ]),
    failure: aiFailureSchema.nullable(),
    source: z.enum(['generation', 'cache', 'deduplicated']),
  })
  .superRefine((run, context) => {
    const resultState = run.state === 'ready-for-review' || run.state === 'needs-input';
    if (resultState !== (run.content.status === 'available' || run.content.status === 'expired'))
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Result content status must agree with run state.',
      });
    if (
      (run.state === 'validating' || run.state === 'generating') !==
      (run.content.status === 'pending')
    )
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Only active runs have pending content.',
      });
    if (run.content.status === 'available') {
      if (
        run.content.result.kind !== 'clarification' &&
        run.content.result.kind !== taskResultKinds[run.task]
      )
        context.addIssue({
          code: 'custom',
          path: ['content', 'result', 'kind'],
          message: 'Result kind must match the run task.',
        });
      if ((run.state === 'needs-input') !== (run.content.result.kind === 'clarification'))
        context.addIssue({
          code: 'custom',
          path: ['content'],
          message: 'Clarification requires needs-input state.',
        });
      if (Date.parse(run.content.expiresAt) <= Date.parse(run.createdAt))
        context.addIssue({
          code: 'custom',
          path: ['content', 'expiresAt'],
          message: 'Expiry must follow creation.',
        });
    }
    if ((run.state === 'failed' || run.state === 'outcome-unknown') !== (run.failure !== null))
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Failure must agree with terminal error state.',
      });
    if (run.state === 'outcome-unknown' && run.failure?.code !== 'AI_OUTCOME_UNKNOWN')
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Unknown outcomes require the unknown-outcome code.',
      });
    if (Date.parse(run.updatedAt) < Date.parse(run.createdAt))
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Update time must not precede creation.',
      });
  });
export const aiRunResponseSchema = objectEnvelopeSchema(aiRunSchema);
export const aiCancelRunSchema = z.strictObject({ schemaVersion: z.literal(AI_SCHEMA_VERSION) });
export const aiRunPathSchema = z.strictObject({ runId: applicationIdSchema });
export const aiEmptyQuerySchema = z.strictObject({});
export const aiAvailabilityQuerySchema = z.strictObject({
  boardId: applicationIdSchema.optional(),
});
// Select this one header from the HTTP header bag; credentials belong only in cookies.
export const aiEventHeadersSchema = z.strictObject({
  lastEventId: aiUnsignedDecimalSchema.optional(),
});

export const aiAllowanceSchema = z.strictObject({
  remainingFreshRuns: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resetsAt: utcTimestampSchema.nullable(),
  // Integer micro-USD, never floating-point or browser-authoritative cost.
  remainingMicroUsd: aiUnsignedDecimalSchema.nullable(),
});
export const aiAvailabilitySchema = z.discriminatedUnion('available', [
  z.strictObject({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    available: z.literal(true),
    allowance: aiAllowanceSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    available: z.literal(false),
    reason: z.enum([
      'disabled',
      'unavailable',
      'allowance-reached',
      'sign-in-required',
      'board-not-editable',
    ]),
    allowance: aiAllowanceSchema.nullable(),
  }),
]);
export const aiAvailabilityResponseSchema = objectEnvelopeSchema(aiAvailabilitySchema);

const eventShape = {
  schemaVersion: z.literal(AI_SCHEMA_VERSION),
  runId: applicationIdSchema,
  sequence: aiUnsignedDecimalSchema,
};
export const aiRunEventSchema = aiByteLimit(
  z.discriminatedUnion('type', [
    z.strictObject({ ...eventShape, type: z.literal('status'), state: aiRunStateSchema }),
    z.strictObject({
      ...eventShape,
      type: z.literal('text-delta'),
      text: z.string().max(limits.MAX_AI_EVENT_DELTA_CHARACTERS),
    }),
    // Clients fetch the authorized bounded result; large proposals never ride SSE.
    z.strictObject({
      ...eventShape,
      type: z.literal('result-available'),
      state: z.enum(['needs-input', 'ready-for-review']),
      expiresAt: utcTimestampSchema,
    }),
    z.strictObject({
      ...eventShape,
      type: z.literal('content-expired'),
      expiredAt: utcTimestampSchema,
    }),
    z.strictObject({ ...eventShape, type: z.literal('failed'), failure: aiFailureSchema }),
    z.strictObject({ ...eventShape, type: z.literal('cancelled') }),
  ]),
  limits.MAX_AI_EVENT_BYTES,
);

// Context-bound validation is required after neutral output assembly and before
// caching/return. Structural schemas alone cannot establish grounding or authority.
export function aiResultForRequestSchema(request: AiCreateRun) {
  return aiResultSchema.superRefine((result, context) => {
    const expectedKind = taskResultKinds[request.task];
    if (result.kind !== 'clarification' && result.kind !== expectedKind)
      context.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Result kind must match the requested task.',
      });
    if (result.kind === 'clarification') return;
    const evidence = new Set(request.context?.evidence.map((entry) => entry.key) ?? []);
    result.claims.forEach((claim, index) =>
      aiReferences(claim.evidenceKeys, evidence, ['claims', index, 'evidenceKeys'], context),
    );
    const graph = request.boardContext?.graph;
    const nodes = new Set(graph?.nodes.map((node) => node.id) ?? []);
    const edges = new Set(graph?.edges.map((edge) => edge.id) ?? []);
    if (result.kind === 'guidance') {
      aiReferences(result.highlightNodeIds, nodes, ['highlightNodeIds'], context);
      aiReferences(result.highlightEdgeIds, edges, ['highlightEdgeIds'], context);
    }
    if (result.kind === 'presentation') {
      aiReferences(
        result.expectedStepIds,
        new Set(graph?.steps.map((step) => step.id) ?? []),
        ['expectedStepIds'],
        context,
      );
      if (
        result.mode === 'replace-reviewed' &&
        result.expectedStepIds.length !== (graph?.steps.length ?? 0)
      )
        context.addIssue({
          code: 'custom',
          path: ['expectedStepIds'],
          message: 'Replacement must name every reviewed step.',
        });
      result.steps.forEach((step, index) => {
        aiReferences(step.nodeIds, nodes, ['steps', index, 'nodeIds'], context);
        aiReferences(step.edgeIds, edges, ['steps', index, 'edgeIds'], context);
      });
    }
    if (result.kind === 'edits') {
      const addedNodes = result.operations.flatMap((operation) =>
        operation.type === 'add-node' ? [operation.node] : [],
      );
      const addedEdges = result.operations.flatMap((operation) =>
        operation.type === 'add-edge' ? [operation.edge] : [],
      );
      const logicalNodes = new Set(
        request.boardContext?.nodeBindings.map((binding) => binding.key) ?? [],
      );
      const addedKeys = aiUniqueKeys([...addedNodes, ...addedEdges], ['operations'], context);
      for (const key of addedKeys)
        if (logicalNodes.has(key))
          context.addIssue({
            code: 'custom',
            path: ['operations'],
            message: 'Added keys conflict with reviewed node bindings.',
          });
      for (const node of addedNodes) logicalNodes.add(node.key);
      addedEdges.forEach((edge, index) =>
        aiReferences([edge.source, edge.target], logicalNodes, ['operations', index], context),
      );
      result.operations.forEach((operation, index) => {
        if ('nodeId' in operation) {
          aiReferences([operation.nodeId], nodes, ['operations', index, 'nodeId'], context);
          const node = graph?.nodes.find((node) => node.id === operation.nodeId);
          if (node) {
            const expectedMatches =
              operation.type === 'rename-node'
                ? operation.expectedTitle === node.title
                : 'expected' in operation
                  ? JSON.stringify(operation.expected) === JSON.stringify(node.content)
                  : 'expectedBody' in operation &&
                    'body' in node.content &&
                    operation.expectedBody === node.content.body;
            if (!expectedMatches)
              context.addIssue({
                code: 'custom',
                path: ['operations', index],
                message: 'Field preconditions must match the reviewed context.',
              });
          }
          if (node && operation.type !== 'rename-node') {
            const kind = {
              'set-component-properties': 'component',
              'set-code-body': 'code',
              'set-schema-body': 'schema',
              'set-note-body': 'note',
            }[operation.type];
            if (node.kind !== kind)
              context.addIssue({
                code: 'custom',
                path: ['operations', index],
                message: 'Property operation must match the reviewed node kind.',
              });
          }
        }
        if ('edgeId' in operation) {
          aiReferences([operation.edgeId], edges, ['operations', index, 'edgeId'], context);
          const edge = graph?.edges.find((edge) => edge.id === operation.edgeId);
          if (
            edge &&
            (operation.expectedLabel !== edge.label || operation.expectedProtocol !== edge.protocol)
          )
            context.addIssue({
              code: 'custom',
              path: ['operations', index],
              message: 'Edge field preconditions must match the reviewed context.',
            });
        }
      });
      if (
        addedNodes.length > limits.MAX_AI_OUTPUT_NODES ||
        addedEdges.length > limits.MAX_AI_OUTPUT_EDGES
      )
        context.addIssue({
          code: 'custom',
          path: ['operations'],
          message: 'Additive output budget exceeded.',
        });
    }
  });
}

export type AiTask = z.infer<typeof aiTaskSchema>;
export type AiCreateRun = z.infer<typeof aiCreateRunSchema>;
export type AiBoardContext = z.infer<typeof aiBoardContextSchema>;
export type AiRun = z.infer<typeof aiRunSchema>;
export type AiRunState = z.infer<typeof aiRunStateSchema>;
export type AiFailure = z.infer<typeof aiFailureSchema>;
export type AiAllowance = z.infer<typeof aiAllowanceSchema>;
export type AiAvailability = z.infer<typeof aiAvailabilitySchema>;
export type AiRunEvent = z.infer<typeof aiRunEventSchema>;
export type AiRunResponse = z.infer<typeof aiRunResponseSchema>;
export type AiAvailabilityResponse = z.infer<typeof aiAvailabilityResponseSchema>;
export type AiCancelRun = z.infer<typeof aiCancelRunSchema>;
export type AiRunPath = z.infer<typeof aiRunPathSchema>;
export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;
