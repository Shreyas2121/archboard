import {
  GRAPH_SCHEMA_VERSION,
  MAX_GRAPH_COORDINATE,
  type GraphProjection,
} from '@archboard/contracts';

import { SELECTION_KINDS, type SelectionReference } from '@/features/editor/state';

import {
  PASTE_OFFSET,
  SELECTION_CLIPBOARD_FORMAT,
  SELECTION_CLIPBOARD_VERSION,
} from './history-constants';
import { selectionClipboardSchema } from './history-schemas';
import type { PastedSelection, SelectionClipboardPayload } from './history-types';

export function captureSelection(
  projection: GraphProjection,
  selection: readonly SelectionReference[],
): SelectionClipboardPayload {
  const nodeIds = new Set(
    selection.filter(({ kind }) => kind === SELECTION_KINDS.NODE).map(({ id }) => id),
  );
  const boundaryIds = new Set(
    selection.filter(({ kind }) => kind === SELECTION_KINDS.BOUNDARY).map(({ id }) => id),
  );
  return selectionClipboardSchema.parse({
    format: SELECTION_CLIPBOARD_FORMAT,
    version: SELECTION_CLIPBOARD_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: projection.nodes.filter(({ id }) => nodeIds.has(id)),
    edges: projection.edges.filter(
      ({ sourceId, targetId }) => nodeIds.has(sourceId) && nodeIds.has(targetId),
    ),
    boundaries: projection.boundaries.filter(({ id }) => boundaryIds.has(id)),
  });
}

export function serializeSelection(payload: SelectionClipboardPayload): string {
  return JSON.stringify(selectionClipboardSchema.parse(payload));
}

export function parseSelection(text: string): SelectionClipboardPayload | null {
  try {
    return selectionClipboardSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function offsetCoordinate(value: number, offset: number): number {
  const next = value + offset;
  if (next < -MAX_GRAPH_COORDINATE || next > MAX_GRAPH_COORDINATE) {
    throw new Error('Pasted geometry exceeds the shared coordinate limits.');
  }
  return next;
}

function remappedId(ids: ReadonlyMap<string, string>, sourceId: string): string {
  const id = ids.get(sourceId);
  if (id === undefined)
    throw new Error(`Clipboard reference ${sourceId} is outside the selection.`);
  return id;
}

export function preparePastedSelection(
  payload: SelectionClipboardPayload,
  pasteNumber: number,
  createId: () => string,
): PastedSelection {
  const source = selectionClipboardSchema.parse(payload);
  const offset = PASTE_OFFSET * pasteNumber;
  const nodeIds = new Map(source.nodes.map(({ id }) => [id, createId()]));
  const boundaryIds = new Map(source.boundaries.map(({ id }) => [id, createId()]));
  const nodes = source.nodes.map((node) => ({
    ...node,
    id: remappedId(nodeIds, node.id),
    position: {
      x: offsetCoordinate(node.position.x, offset),
      y: offsetCoordinate(node.position.y, offset),
    },
  }));
  const edges = source.edges.map((edge) => ({
    ...edge,
    id: createId(),
    sourceId: remappedId(nodeIds, edge.sourceId),
    targetId: remappedId(nodeIds, edge.targetId),
  }));
  const boundaries = source.boundaries.map((boundary) => ({
    ...boundary,
    id: remappedId(boundaryIds, boundary.id),
    rect: {
      ...boundary.rect,
      x: offsetCoordinate(boundary.rect.x, offset),
      y: offsetCoordinate(boundary.rect.y, offset),
    },
  }));
  return {
    batch: { nodes, edges, boundaries },
    selection: [
      ...nodes.map(({ id }) => ({ id, kind: SELECTION_KINDS.NODE }) as const),
      ...edges.map(({ id }) => ({ id, kind: SELECTION_KINDS.EDGE }) as const),
      ...boundaries.map(({ id }) => ({ id, kind: SELECTION_KINDS.BOUNDARY }) as const),
    ],
  };
}
