import {
  MAX_LIVE_PRESENTATION_STEPS,
  presentationStepFieldsSchema,
  type PresentationStep,
} from '@archboard/contracts';
import type * as Y from 'yjs';

import { STEP_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { readPhysicalGraph, type PhysicalGraph } from '../validation/read.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  liveStep,
  parseStep,
  requireText,
  stepMap,
} from './internal.js';

const stepChangesSchema = presentationStepFieldsSchema.omit({ id: true }).partial();
const stepOrderingSchema = presentationStepFieldsSchema
  .pick({ id: true, order: true })
  .array()
  .max(MAX_LIVE_PRESENTATION_STEPS);

function assertHighlightTargets(
  graph: PhysicalGraph,
  changes: Pick<Partial<PresentationStep>, 'nodeIds' | 'edgeIds'>,
): void {
  for (const field of ['nodeIds', 'edgeIds'] as const) {
    const references = changes[field];
    if (references === undefined) continue;
    if (new Set(references).size !== references.length)
      throw new GraphCommandError('Step highlights must not repeat IDs.');
    for (const id of references) {
      const nodeIsLive = (nodeId: string): boolean =>
        graph.nodes.has(nodeId) && !graph.deletedNodes.has(nodeId);
      const edge = graph.edges.get(id);
      const live =
        field === 'nodeIds'
          ? nodeIsLive(id)
          : edge !== undefined &&
            !graph.deletedEdges.has(id) &&
            nodeIsLive(edge.sourceId) &&
            nodeIsLive(edge.targetId);
      if (!live)
        throw new GraphCommandError(
          'Step highlights must reference live objects of the correct kind.',
        );
    }
  }
}

// Preserve unchanged Y.Text items so concurrent edits to those items and local undo
// keep their identities. Interactive text bindings may also use editGraphText directly.
function updateStepText(text: Y.Text, value: string): void {
  const current = text.toString();
  let prefix = 0;
  while (prefix < current.length && prefix < value.length && current[prefix] === value[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < value.length - prefix &&
    current[current.length - suffix - 1] === value[value.length - suffix - 1]
  )
    suffix += 1;
  const removed = current.length - prefix - suffix;
  const inserted = value.slice(prefix, value.length - suffix);
  if (removed > 0) text.delete(prefix, removed);
  if (inserted.length > 0) text.insert(prefix, inserted);
}

export function createPresentationStep(document: Y.Doc, input: PresentationStep): void {
  const step = parseStep(input);
  assertFreshId(document, step.id);
  const graph = readPhysicalGraph(document);
  assertLiveCapacity(document, { steps: 1 }, graph);
  assertHighlightTargets(graph, step);
  document.transact(
    () => getGraphDocumentRoots(document).steps.set(step.id, stepMap(step)),
    LOCAL_STRUCTURAL_ORIGIN,
  );
}

export function editPresentationStep(
  document: Y.Doc,
  id: string,
  changes: Partial<Omit<PresentationStep, 'id'>>,
): void {
  stepChangesSchema.parse(changes);
  const step = parseStep({ ...liveStep(document, id), ...changes, id });
  // Only explicitly changed references need current live targets. Existing references
  // can disappear through concurrent deletion without blocking unrelated edits.
  if (changes.nodeIds !== undefined || changes.edgeIds !== undefined)
    assertHighlightTargets(readPhysicalGraph(document), changes);
  const map = getGraphDocumentRoots(document).steps.get(id) as Y.Map<unknown>;
  document.transact(() => {
    if (changes.title !== undefined)
      updateStepText(
        requireText(map.get(STEP_FIELDS.TITLE), `Step ${id}`, STEP_FIELDS.TITLE),
        step.title,
      );
    if (changes.notes !== undefined)
      updateStepText(
        requireText(map.get(STEP_FIELDS.NOTES), `Step ${id}`, STEP_FIELDS.NOTES),
        step.notes,
      );
    if (changes.order !== undefined) map.set(STEP_FIELDS.ORDER, step.order);
    if (changes.rect !== undefined) map.set(STEP_FIELDS.RECT, { ...step.rect });
    if (changes.nodeIds !== undefined) map.set(STEP_FIELDS.NODE_IDS, [...step.nodeIds]);
    if (changes.edgeIds !== undefined) map.set(STEP_FIELDS.EDGE_IDS, [...step.edgeIds]);
  }, LOCAL_EDIT_ORIGIN);
}

export function reorderPresentationSteps(
  document: Y.Doc,
  ordering: readonly { readonly id: string; readonly order: number }[],
): void {
  const input = stepOrderingSchema.parse(ordering);
  const graph = readPhysicalGraph(document);
  const seen = new Set<string>();
  const changes = input.map(({ id, order }) => {
    if (seen.has(id))
      throw new GraphCommandError(`Step ${id} occurs more than once in the reorder command.`);
    seen.add(id);
    if (!graph.steps.has(id) || graph.deletedSteps.has(id))
      throw new GraphCommandError(`Step ${id} does not exist or is deleted.`);
    return { id, order };
  });
  if (changes.length === 0) return;
  const root = getGraphDocumentRoots(document).steps;
  document.transact(() => {
    for (const { id, order } of changes) {
      (root.get(id) as Y.Map<unknown>).set(STEP_FIELDS.ORDER, order);
    }
  }, LOCAL_EDIT_ORIGIN);
}
