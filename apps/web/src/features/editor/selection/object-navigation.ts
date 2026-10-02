import type { GraphProjection } from '@archboard/contracts';
import { SELECTION_KINDS, type SelectionReference } from '@/features/editor/state';

export interface NavigableObject {
  readonly reference: SelectionReference;
  readonly label: string;
}

/** Read the current projection; never keep a second editable graph or stale references. */
export function navigableObjects(projection: GraphProjection): NavigableObject[] {
  const titles = new Map(projection.nodes.map((node) => [node.id, node.title || 'Untitled card']));
  return [
    ...projection.nodes.map((node) => ({
      reference: { kind: SELECTION_KINDS.NODE, id: node.id },
      label: `${node.kind} card: ${node.title || 'Untitled card'}`,
    })),
    ...projection.boundaries.map((boundary) => ({
      reference: { kind: SELECTION_KINDS.BOUNDARY, id: boundary.id },
      label: `Boundary: ${boundary.title || 'Untitled boundary'}`,
    })),
    ...projection.edges.map((edge) => ({
      reference: { kind: SELECTION_KINDS.EDGE, id: edge.id },
      label: `Connection: ${titles.get(edge.sourceId) ?? 'Deleted source'} to ${titles.get(edge.targetId) ?? 'Deleted target'}${edge.label ? `; ${edge.label}` : ''}`,
    })),
  ];
}

export function toggleObjectSelection(
  selection: readonly SelectionReference[],
  reference: SelectionReference,
): SelectionReference[] {
  const matches = (candidate: SelectionReference) =>
    candidate.id === reference.id && candidate.kind === reference.kind;
  return selection.some(matches)
    ? selection.filter((candidate) => !matches(candidate))
    : [...selection, reference];
}

/** Recover focus only when an owned control disappears and the browser has lost focus. */
export function shouldRecoverObjectFocus(
  ownedControlRemoved: boolean,
  focusOnBody: boolean,
  modalOpen: boolean,
): boolean {
  return ownedControlRemoved && focusOnBody && !modalOpen;
}
