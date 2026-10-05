import {
  aiCreateRunSchema,
  aiResultForRequestSchema,
  applicationIdSchema,
  graphNodeSchema,
  graphEdgeSchema,
  presentationStepSchema,
  graphProjectionSchema,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  type AiCreateRun,
  type AiPresentationProposal,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';
import {
  createPresentationStep,
  tombstonePresentationStep,
  COMMAND_ORIGINS,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import * as Y from 'yjs';
import { enclosingAiRect, semanticOrder } from './ai-diagram-geometry';
import type { AiApplyJournal } from './ai-apply-intent';
import type { EditorSession } from '../application/editor-session';

export interface AiPresentationDraft {
  readonly request: AiCreateRun;
  readonly proposal: AiPresentationProposal;
  readonly steps: readonly PresentationStep[];
  readonly ids: Readonly<Record<string, string>>;
}
function boundPresentation(input: AiCreateRun, value: unknown) {
  const request = aiCreateRunSchema.parse(input);
  if (request.task !== 'presentation')
    throw new Error('A reviewed presentation request is required.');
  const proposal = aiResultForRequestSchema(request).parse(value);
  if (proposal.kind !== 'presentation') throw new Error('A presentation proposal is required.');
  return { request, proposal };
}
function stepNodes(request: AiCreateRun, step: AiPresentationProposal['steps'][number]) {
  const graph = request.boardContext!.graph;
  const ids = new Set(step.nodeIds);
  for (const id of step.edgeIds) {
    const edge = graph.edges.find((edge) => edge.id === id);
    if (!edge) throw new Error('A proposed connection was not reviewed.');
    ids.add(edge.sourceId);
    ids.add(edge.targetId);
  }
  return graph.nodes.filter((node) => !ids.size || ids.has(node.id));
}
function nextOrder(graph: GraphProjection) {
  return graph.steps.length ? Math.max(...graph.steps.map((step) => step.order)) + 1 : 0;
}
/** Recompute every viewport and check only reviewed targets; unrelated fields remain untouched. */
export function validateCurrentAiPresentation(
  draft: AiPresentationDraft,
  graph: GraphProjection,
): void {
  const { request, proposal } = boundPresentation(draft.request, draft.proposal);
  if (
    draft.steps.length !== proposal.steps.length ||
    Object.keys(draft.ids).length !== proposal.steps.length ||
    new Set(Object.values(draft.ids)).size !== proposal.steps.length
  )
    throw new Error('Presentation mapping is incomplete or duplicated.');
  if (proposal.mode === 'replace-reviewed') {
    const reviewed = request.boardContext!.graph.steps;
    if (
      reviewed.length !== graph.steps.length ||
      reviewed.some((step) => {
        const current = graph.steps.find((item) => item.id === step.id);
        return (
          !current ||
          JSON.stringify(presentationStepSchema.parse(current)) !==
            JSON.stringify(presentationStepSchema.parse(step))
        );
      })
    )
      throw new Error(
        'Reviewed presentation steps changed or were deleted. Request a fresh replacement proposal.',
      );
  }
  const base = proposal.mode === 'append' ? nextOrder(graph) : 0;
  const reviewedGraph = request.boardContext!.graph;
  proposal.steps.forEach((step, index) => {
    const nodes = stepNodes(request, step);
    for (const node of nodes) {
      const current = graph.nodes.find((item) => item.id === node.id);
      if (
        !current ||
        JSON.stringify(graphNodeSchema.parse(current)) !==
          JSON.stringify(graphNodeSchema.parse(node))
      )
        throw new Error(
          'A walkthrough target changed or was deleted. Review fresh architecture before applying.',
        );
    }
    for (const id of step.edgeIds) {
      const before = reviewedGraph.edges.find((edge) => edge.id === id)!;
      const current = graph.edges.find((edge) => edge.id === id);
      if (
        !current ||
        JSON.stringify(graphEdgeSchema.parse(current)) !==
          JSON.stringify(graphEdgeSchema.parse(before))
      )
        throw new Error('A walkthrough connection changed or was deleted.');
    }
    const expected = presentationStepSchema.parse({
      id: applicationIdSchema.parse(draft.ids[step.key]),
      title: step.title,
      notes: step.notes,
      nodeIds: step.nodeIds,
      edgeIds: step.edgeIds,
      order: base + index,
      rect: enclosingAiRect(nodes),
    });
    if (
      JSON.stringify(presentationStepSchema.parse(draft.steps[index])) !== JSON.stringify(expected)
    )
      throw new Error(
        'Presentation geometry, order or fields changed. Refresh the reviewed candidate.',
      );
  });
}
function mutatePresentation(document: Y.Doc, draft: AiPresentationDraft) {
  document.transact(() => {
    if (draft.proposal.mode === 'replace-reviewed')
      for (const id of draft.proposal.expectedStepIds) tombstonePresentationStep(document, id);
    for (const step of draft.steps) createPresentationStep(document, step);
  }, COMMAND_ORIGINS.LOCAL_STRUCTURAL);
}
export function preflightAiPresentation(
  source: Uint8Array,
  draft: AiPresentationDraft,
  options: { clientId?: number; updateBytes?: number; stateBytes?: number } = {},
) {
  const stateLimit = Math.min(
    options.stateBytes ?? MAX_ENCODED_YJS_STATE_BYTES,
    MAX_ENCODED_YJS_STATE_BYTES,
  );
  const updateLimit = Math.min(
    options.updateBytes ?? MAX_CLIENT_UPDATE_BYTES,
    MAX_CLIENT_UPDATE_BYTES,
  );
  if (source.byteLength > stateLimit) throw new Error('Existing state exceeds its encoded budget.');
  const candidate = new Y.Doc({ gc: false });
  const accepted = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(candidate, source);
    Y.applyUpdate(accepted, source);
    if (options.clientId !== undefined) candidate.clientID = options.clientId;
    validateGraphDocument(candidate);
    validateCurrentAiPresentation(draft, projectGraphDocument(candidate));
    const vector = Y.encodeStateVector(candidate);
    mutatePresentation(candidate, draft);
    validateGraphDocument(candidate, accepted);
    const graph = graphProjectionSchema.parse(projectGraphDocument(candidate));
    const updateBytes = Y.encodeStateAsUpdate(candidate, vector).byteLength;
    const stateBytes = Y.encodeStateAsUpdate(candidate).byteLength;
    if (updateBytes > updateLimit || stateBytes > stateLimit)
      throw new Error('Presentation candidate exceeds its encoded budget.');
    return { graph, updateBytes, stateBytes };
  } finally {
    candidate.destroy();
    accepted.destroy();
  }
}
export function prepareAiPresentation(
  source: Uint8Array,
  input: AiCreateRun,
  value: unknown,
  options: { ids?: Readonly<Record<string, string>>; allocate?: () => string } = {},
): AiPresentationDraft {
  const { request, proposal } = boundPresentation(input, value);
  if (source.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
    throw new Error('Existing state exceeds its budget.');
  const document = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(document, source);
    validateGraphDocument(document);
    const graph = projectGraphDocument(document);
    const used = new Set(
      [...document.share.values()].flatMap((root) =>
        root instanceof Y.Map ? [...root.keys()] : [],
      ),
    );
    const ids: Record<string, string> = {};
    for (const step of [...proposal.steps].sort(semanticOrder)) {
      const id = applicationIdSchema.parse(
        options.ids ? options.ids[step.key] : (options.allocate ?? (() => crypto.randomUUID()))(),
      );
      if (used.has(id)) throw new Error('Step ID conflicts with an existing or tombstoned object.');
      used.add(id);
      ids[step.key] = id;
    }
    const base = proposal.mode === 'append' ? nextOrder(graph) : 0;
    const steps = proposal.steps.map((step, index) =>
      presentationStepSchema.parse({
        id: ids[step.key],
        title: step.title,
        notes: step.notes,
        nodeIds: step.nodeIds,
        edgeIds: step.edgeIds,
        order: base + index,
        rect: enclosingAiRect(stepNodes(request, step)),
      }),
    );
    const draft = { request, proposal, steps, ids: Object.freeze(ids) };
    preflightAiPresentation(source, draft);
    return draft;
  } finally {
    document.destroy();
  }
}
export function applyAiPresentationBatch(
  document: Y.Doc,
  draft: AiPresentationDraft,
  beforeMutation: () => void,
): void {
  preflightAiPresentation(Y.encodeStateAsUpdate(document), draft, { clientId: document.clientID });
  beforeMutation();
  mutatePresentation(document, draft);
}
export function applyReviewedAiPresentation(
  session: Pick<EditorSession, 'canEdit' | 'applyAiPresentation'>,
  journal: AiApplyJournal,
  runId: string,
  draft: AiPresentationDraft,
  allowed: () => boolean,
): void {
  if (!allowed() || !session.canEdit())
    throw new Error('Current account, editability or result validity was lost.');
  if (journal.get(runId))
    throw new Error(
      'This presentation has an Apply intent. Inspect saved steps; automatic replay is blocked.',
    );
  session.applyAiPresentation(draft, () => journal.prepare(runId, draft.ids, 'presentation'));
}
