import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  graphProjectionSchema,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';
import type * as Y from 'yjs';

import { DocumentValidationError } from '../validation/error.js';
import { readPhysicalGraph, type PhysicalGraph } from '../validation/read.js';

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const byId = <T extends { readonly id: string }>(left: T, right: T): number =>
  compareIds(left.id, right.id);

const byStepOrderThenId = (left: PresentationStep, right: PresentationStep): number =>
  left.order - right.order || compareIds(left.id, right.id);

export function projectPhysicalGraph(physical: PhysicalGraph): GraphProjection {
  const nodes = [...physical.nodes.values()]
    .filter(({ id }) => !physical.deletedNodes.has(id))
    .sort(byId);
  const liveNodeIds = new Set(nodes.map(({ id }) => id));
  const edges = [...physical.edges.values()]
    .filter(
      ({ id, sourceId, targetId }) =>
        !physical.deletedEdges.has(id) && liveNodeIds.has(sourceId) && liveNodeIds.has(targetId),
    )
    .sort(byId);
  const liveEdgeIds = new Set(edges.map(({ id }) => id));
  const boundaries = [...physical.boundaries.values()]
    .filter(({ id }) => !physical.deletedBoundaries.has(id))
    .sort(byId);
  const steps = [...physical.steps.values()]
    .filter(({ id }) => !physical.deletedSteps.has(id))
    .map((step) => ({
      ...step,
      nodeIds: step.nodeIds.filter((id) => liveNodeIds.has(id)),
      edgeIds: step.edgeIds.filter((id) => liveEdgeIds.has(id)),
    }))
    .sort(byStepOrderThenId);

  const result = graphProjectionSchema.safeParse({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
    boundaries,
    steps,
  });
  if (!result.success) {
    throw new DocumentValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
        message: issue.message,
      })),
      ERROR_CODES.DOCUMENT_LIMIT,
    );
  }
  return result.data;
}

export function projectGraphDocument(document: Y.Doc): GraphProjection {
  return projectPhysicalGraph(readPhysicalGraph(document));
}
