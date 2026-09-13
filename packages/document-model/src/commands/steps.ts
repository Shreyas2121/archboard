import { presentationStepSchema, type PresentationStep } from '@archboard/contracts';
import type * as Y from 'yjs';

import { STEP_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  liveStep,
  parseStep,
  replaceText,
  requireText,
  stepMap,
} from './internal.js';

export function createPresentationStep(document: Y.Doc, input: PresentationStep): void {
  const step = parseStep(input);
  assertFreshId(document, step.id);
  assertLiveCapacity(document, { steps: 1 });
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
  if ('id' in (changes as Record<string, unknown>))
    throw new GraphCommandError('Step IDs are immutable.');
  const step = parseStep({ ...liveStep(document, id), ...changes, id });
  const map = getGraphDocumentRoots(document).steps.get(id) as Y.Map<unknown>;
  document.transact(() => {
    if (changes.title !== undefined)
      replaceText(
        requireText(map.get(STEP_FIELDS.TITLE), `Step ${id}`, STEP_FIELDS.TITLE),
        step.title,
      );
    if (changes.notes !== undefined)
      replaceText(
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
  const seen = new Set<string>();
  const changes = ordering.map(({ id, order }) => {
    if (seen.has(id))
      throw new GraphCommandError(`Step ${id} occurs more than once in the reorder command.`);
    seen.add(id);
    const step = presentationStepSchema.parse({ ...liveStep(document, id), order });
    return { id, order: step.order };
  });
  const root = getGraphDocumentRoots(document).steps;
  document.transact(() => {
    for (const { id, order } of changes) {
      (root.get(id) as Y.Map<unknown>).set(STEP_FIELDS.ORDER, order);
    }
  }, LOCAL_EDIT_ORIGIN);
}
