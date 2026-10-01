import {
  MAX_STEP_ORDER,
  rectSchema,
  type GraphProjection,
  type PresentationStep,
  type Rect,
} from '@archboard/contracts';
import type { SelectionReference } from '@/features/editor/state';

export function visibleWorldRect(
  size: { width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
): Rect {
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0)
    throw new Error('The canvas zoom is unavailable.');
  const result = rectSchema.safeParse({
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  });
  if (!result.success)
    throw new Error(
      'The visible canvas exceeds the step limits. Zoom in or pan closer to the architecture, then capture again.',
    );
  return result.data;
}
export function sortedSteps(steps: readonly PresentationStep[]): PresentationStep[] {
  return [...steps].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export const PRESENTATION_MIN_ZOOM = 0.001;
export function newStepOrder(steps: readonly PresentationStep[]): number {
  const last = sortedSteps(steps).at(-1);
  return last === undefined ? 0 : Math.min(MAX_STEP_ORDER, last.order + 1);
}
export function captureHighlights(
  graph: GraphProjection,
  selection: readonly SelectionReference[],
) {
  const nodes = new Set(graph.nodes.map(({ id }) => id));
  const edges = new Set(graph.edges.map(({ id }) => id));
  return {
    nodeIds: [
      ...new Set(
        selection.filter(({ id, kind }) => kind === 'node' && nodes.has(id)).map(({ id }) => id),
      ),
    ],
    edgeIds: [
      ...new Set(
        selection.filter(({ id, kind }) => kind === 'edge' && edges.has(id)).map(({ id }) => id),
      ),
    ],
  };
}
export function reorderedSteps(
  steps: readonly PresentationStep[],
  sourceId: string,
  targetId: string,
) {
  const ordered = sortedSteps(steps);
  const source = ordered.findIndex(({ id }) => id === sourceId);
  const target = ordered.findIndex(({ id }) => id === targetId);
  if (source < 0 || target < 0 || source === target) return [];
  const [moved] = ordered.splice(source, 1);
  if (moved === undefined) return [];
  ordered.splice(target, 0, moved);
  return ordered.map(({ id }, order) => ({ id, order }));
}
export function adjacentStep(
  steps: readonly PresentationStep[],
  activeId: string,
  direction: -1 | 1,
): string | null {
  const ordered = sortedSteps(steps);
  const index = ordered.findIndex(({ id }) => id === activeId);
  return index < 0 ? null : (ordered[index + direction]?.id ?? null);
}
export function presentationShortcut(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): 'previous' | 'next' | 'exit' | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return event.key === 'ArrowLeft'
    ? 'previous'
    : event.key === 'ArrowRight'
      ? 'next'
      : event.key === 'Escape'
        ? 'exit'
        : null;
}
