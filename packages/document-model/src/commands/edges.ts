import type { GraphEdge } from '@archboard/contracts';
import type * as Y from 'yjs';

import { EDGE_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  edgeMap,
  liveEdge,
  liveNode,
  parseEdge,
  replaceText,
  requireText,
} from './internal.js';

function validateEdgeEndpoints(document: Y.Doc, edge: GraphEdge): void {
  liveNode(document, edge.sourceId);
  liveNode(document, edge.targetId);
  if (edge.sourceId === edge.targetId) {
    throw new GraphCommandError(`Edge ${edge.id} cannot connect a node to itself.`);
  }
}

export function createEdge(document: Y.Doc, input: GraphEdge): void {
  const edge = parseEdge(input);
  assertFreshId(document, edge.id);
  assertLiveCapacity(document, { edges: 1 });
  validateEdgeEndpoints(document, edge);
  document.transact(
    () => getGraphDocumentRoots(document).edges.set(edge.id, edgeMap(edge)),
    LOCAL_STRUCTURAL_ORIGIN,
  );
}

export function editEdge(
  document: Y.Doc,
  id: string,
  changes: Partial<Pick<GraphEdge, 'label' | 'protocol' | 'direction' | 'style'>>,
): void {
  const supplied = changes as Record<string, unknown>;
  for (const immutable of ['id', 'sourceId', 'targetId', 'sourceHandle', 'targetHandle']) {
    if (immutable in supplied)
      throw new GraphCommandError(
        `Edge field ${immutable} is immutable; replace the edge instead.`,
      );
  }
  const current = liveEdge(document, id);
  const edge = parseEdge({ ...current, ...changes });
  const map = getGraphDocumentRoots(document).edges.get(id) as Y.Map<unknown>;
  document.transact(() => {
    if (changes.label !== undefined)
      replaceText(
        requireText(map.get(EDGE_FIELDS.LABEL), `Edge ${id}`, EDGE_FIELDS.LABEL),
        edge.label,
      );
    if (changes.protocol !== undefined)
      replaceText(
        requireText(map.get(EDGE_FIELDS.PROTOCOL), `Edge ${id}`, EDGE_FIELDS.PROTOCOL),
        edge.protocol,
      );
    if (changes.direction !== undefined) map.set(EDGE_FIELDS.DIRECTION, edge.direction);
    if (changes.style !== undefined) map.set(EDGE_FIELDS.STYLE, edge.style);
  }, LOCAL_EDIT_ORIGIN);
}

export function replaceEdge(document: Y.Doc, originalId: string, input: GraphEdge): void {
  liveEdge(document, originalId);
  const replacement = parseEdge(input);
  assertFreshId(document, replacement.id);
  validateEdgeEndpoints(document, replacement);
  const roots = getGraphDocumentRoots(document);
  document.transact(() => {
    roots.deletedEdges.set(originalId, true);
    roots.edges.set(replacement.id, edgeMap(replacement));
  }, LOCAL_STRUCTURAL_ORIGIN);
}
