import {
  graphProjectionSchema,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';
import type * as Y from 'yjs';

import { getGraphDocumentRoots } from '../schema/document.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  boundaryMap,
  edgeMap,
  nodeMap,
  stepMap,
} from './internal.js';

export type RestorableEntityKind = 'node' | 'edge' | 'boundary' | 'step';
export type FreshIdFactory = (kind: RestorableEntityKind, previousId: string) => string;

export interface RestoreResult {
  readonly graph: GraphProjection;
  readonly idMap: ReadonlyMap<string, string>;
}

export function restoreDeletedObjects(
  document: Y.Doc,
  captured: GraphProjection,
  createId: FreshIdFactory,
): RestoreResult {
  const source = graphProjectionSchema.parse(captured);
  assertLiveCapacity(document, {
    nodes: source.nodes.length,
    edges: source.edges.length,
    boundaries: source.boundaries.length,
    steps: source.steps.length,
  });
  const idMap = new Map<string, string>();
  const assign = (kind: RestorableEntityKind, id: string): string => {
    const freshId = createId(kind, id);
    assertFreshId(document, freshId);
    if ([...idMap.values()].includes(freshId))
      throw new GraphCommandError(`Restore generated duplicate ID ${freshId}.`);
    idMap.set(id, freshId);
    return freshId;
  };
  for (const node of source.nodes) assign('node', node.id);
  for (const edge of source.edges) assign('edge', edge.id);
  for (const boundary of source.boundaries) assign('boundary', boundary.id);
  for (const step of source.steps) assign('step', step.id);

  const nodes: GraphNode[] = source.nodes.map((node) => ({ ...node, id: idMap.get(node.id)! }));
  const edges: GraphEdge[] = source.edges.map((edge) => ({
    ...edge,
    id: idMap.get(edge.id)!,
    sourceId: idMap.get(edge.sourceId) ?? edge.sourceId,
    targetId: idMap.get(edge.targetId) ?? edge.targetId,
  }));
  const boundaries: Boundary[] = source.boundaries.map((boundary) => ({
    ...boundary,
    id: idMap.get(boundary.id)!,
  }));
  const steps: PresentationStep[] = source.steps.map((step) => ({
    ...step,
    id: idMap.get(step.id)!,
    nodeIds: step.nodeIds.map((id) => idMap.get(id) ?? id),
    edgeIds: step.edgeIds.map((id) => idMap.get(id) ?? id),
  }));
  const graph = graphProjectionSchema.parse({ ...source, nodes, edges, boundaries, steps });
  const roots = getGraphDocumentRoots(document);
  document.transact(() => {
    for (const node of graph.nodes) roots.nodes.set(node.id, nodeMap(node));
    for (const edge of graph.edges) roots.edges.set(edge.id, edgeMap(edge));
    for (const boundary of graph.boundaries)
      roots.boundaries.set(boundary.id, boundaryMap(boundary));
    for (const step of graph.steps) roots.steps.set(step.id, stepMap(step));
  }, LOCAL_STRUCTURAL_ORIGIN);
  return { graph, idMap };
}
