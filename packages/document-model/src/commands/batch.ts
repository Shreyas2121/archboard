import {
  GRAPH_SCHEMA_VERSION,
  boundarySchema,
  graphEdgeSchema,
  graphNodeSchema,
  graphProjectionSchema,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
  type Point,
  type Rect,
} from '@archboard/contracts';
import type * as Y from 'yjs';

import { BOUNDARY_FIELDS, NODE_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { readPhysicalGraph, type PhysicalGraph } from '../validation/read.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  boundaryMap,
  edgeMap,
  liveBoundary,
  liveNode,
  nodeMap,
} from './internal.js';

export interface NodePositionChange {
  readonly id: string;
  readonly position: Point;
}

export interface NodeGeometryChange extends NodePositionChange {
  readonly size?: GraphNode['size'];
}

export interface BoundaryGeometryChange {
  readonly id: string;
  readonly rect: Rect;
}

export interface GeometryBatch {
  readonly nodes?: readonly NodeGeometryChange[];
  readonly boundaries?: readonly BoundaryGeometryChange[];
}

export interface GraphObjectBatch {
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
  readonly boundaries?: readonly Boundary[];
}

/** Partial-intersection policy: any positive-area overlap selects the object. */
export function rectanglesIntersect(selection: Rect, object: Rect): boolean {
  return (
    selection.x < object.x + object.width &&
    selection.x + selection.width > object.x &&
    selection.y < object.y + object.height &&
    selection.y + selection.height > object.y
  );
}

function assertUniqueIds(entries: readonly { readonly id: string }[], label: string): void {
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new GraphCommandError(`${label} contains a duplicate entity ID.`);
  }
}

export function setNodePositions(document: Y.Doc, positions: readonly NodePositionChange[]): void {
  setGraphGeometry(document, { nodes: positions });
}

export function setGraphGeometry(document: Y.Doc, batch: GeometryBatch): void {
  if ((batch.nodes?.length ?? 0) + (batch.boundaries?.length ?? 0) === 0) return;
  setGraphGeometryFromPhysical(document, batch, readPhysicalGraph(document));
}

/** Internal command composition: reuse the same pre-mutation validation read. */
export function setGraphGeometryFromPhysical(
  document: Y.Doc,
  batch: GeometryBatch,
  physical: PhysicalGraph,
): void {
  const nodeChanges = batch.nodes ?? [];
  const boundaryChanges = batch.boundaries ?? [];
  assertUniqueIds(nodeChanges, 'Node geometry batch');
  assertUniqueIds(boundaryChanges, 'Boundary geometry batch');

  const nodes = nodeChanges.map((change) => {
    const current = liveNode(document, change.id, physical);
    graphNodeSchema.parse({
      ...current,
      position: change.position,
      size: change.size ?? current.size,
    });
    return change;
  });
  const boundaries = boundaryChanges.map((change) => {
    boundarySchema.parse({ ...liveBoundary(document, change.id, physical), rect: change.rect });
    return change;
  });
  if (nodes.length === 0 && boundaries.length === 0) return;

  const roots = getGraphDocumentRoots(document);
  document.transact(() => {
    for (const change of nodes) {
      const map = roots.nodes.get(change.id) as Y.Map<unknown>;
      map.set(NODE_FIELDS.POSITION, { ...change.position });
      if (change.size !== undefined) map.set(NODE_FIELDS.SIZE, { ...change.size });
    }
    for (const change of boundaries) {
      (roots.boundaries.get(change.id) as Y.Map<unknown>).set(BOUNDARY_FIELDS.RECT, {
        ...change.rect,
      });
    }
  }, LOCAL_EDIT_ORIGIN);
}

export function createGraphObjects(document: Y.Doc, batch: GraphObjectBatch): void {
  const nodes = (batch.nodes ?? []).map((node) => graphNodeSchema.parse(node));
  const edges = (batch.edges ?? []).map((edge) => graphEdgeSchema.parse(edge));
  const boundaries = (batch.boundaries ?? []).map((boundary) => boundarySchema.parse(boundary));
  const entities = [...nodes, ...edges, ...boundaries];
  assertUniqueIds(entities, 'Creation batch');
  for (const { id } of entities) assertFreshId(document, id);
  const physical = readPhysicalGraph(document);
  assertLiveCapacity(
    document,
    {
      nodes: nodes.length,
      edges: edges.length,
      boundaries: boundaries.length,
    },
    physical,
  );
  const availableNodeIds = new Set(
    [...physical.nodes.keys()].filter((id) => !physical.deletedNodes.has(id)),
  );
  for (const { id } of nodes) availableNodeIds.add(id);
  for (const edge of edges) {
    if (!availableNodeIds.has(edge.sourceId) || !availableNodeIds.has(edge.targetId)) {
      throw new GraphCommandError(`Edge ${edge.id} refers to a node outside the live batch.`);
    }
    if (edge.sourceId === edge.targetId) {
      throw new GraphCommandError(`Edge ${edge.id} cannot connect a node to itself.`);
    }
  }
  if (entities.length === 0) return;

  const roots = getGraphDocumentRoots(document);
  document.transact(() => {
    for (const node of nodes) roots.nodes.set(node.id, nodeMap(node));
    for (const edge of edges) roots.edges.set(edge.id, edgeMap(edge));
    for (const boundary of boundaries) roots.boundaries.set(boundary.id, boundaryMap(boundary));
  }, LOCAL_STRUCTURAL_ORIGIN);
}

export interface DeleteGraphObjectsSelection {
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
  readonly boundaryIds?: readonly string[];
}

export function deleteGraphObjects(
  document: Y.Doc,
  selection: DeleteGraphObjectsSelection,
): GraphProjection {
  const nodeIds = selection.nodeIds ?? [];
  const selectedEdgeIds = selection.edgeIds ?? [];
  const boundaryIds = selection.boundaryIds ?? [];
  assertUniqueIds(
    nodeIds.map((id) => ({ id })),
    'Node deletion selection',
  );
  assertUniqueIds(
    selectedEdgeIds.map((id) => ({ id })),
    'Edge deletion selection',
  );
  assertUniqueIds(
    boundaryIds.map((id) => ({ id })),
    'Boundary deletion selection',
  );

  const physical = readPhysicalGraph(document);
  const nodes = nodeIds.map((id) => liveNode(document, id, physical));
  const boundaries = boundaryIds.map((id) => liveBoundary(document, id, physical));
  const selectedNodes = new Set(nodeIds);
  const edgeIds = new Set(selectedEdgeIds);
  for (const edge of physical.edges.values()) {
    if (
      !physical.deletedEdges.has(edge.id) &&
      selectedNodes.has(edge.sourceId) &&
      selectedNodes.has(edge.targetId)
    ) {
      edgeIds.add(edge.id);
    }
  }
  const edges = [...edgeIds].map((id) => {
    const edge = physical.edges.get(id);
    if (edge === undefined || physical.deletedEdges.has(id)) {
      throw new GraphCommandError(`Edge ${id} does not exist or is deleted.`);
    }
    return edge;
  });
  const capture = graphProjectionSchema.parse({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
    boundaries,
    steps: [],
  });
  if (nodes.length === 0 && edges.length === 0 && boundaries.length === 0) return capture;

  const roots = getGraphDocumentRoots(document);
  document.transact(() => {
    for (const { id } of nodes) roots.deletedNodes.set(id, true);
    for (const { id } of edges) roots.deletedEdges.set(id, true);
    for (const { id } of boundaries) roots.deletedBoundaries.set(id, true);
  }, LOCAL_STRUCTURAL_ORIGIN);
  return capture;
}
