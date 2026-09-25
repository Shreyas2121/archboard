import { graphProjectionSchema, type GraphProjection } from '@archboard/contracts';

/** Give every live entity one new ID and preserve only references within the projection. */
export function remapGraphProjection(source: GraphProjection): GraphProjection {
  const graph = graphProjectionSchema.parse(source);
  const ids = new Map<string, string>();
  for (const entity of [...graph.nodes, ...graph.edges, ...graph.boundaries, ...graph.steps]) {
    if (ids.has(entity.id)) throw new Error('Graph entity IDs overlap across collections.');
    ids.set(entity.id, globalThis.crypto.randomUUID());
  }
  const mapped = (id: string): string => {
    const value = ids.get(id);
    if (!value) throw new Error('Graph reference has no live target.');
    return value;
  };
  return graphProjectionSchema.parse({
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.map((node) => ({ ...node, id: mapped(node.id) })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      id: mapped(edge.id),
      sourceId: mapped(edge.sourceId),
      targetId: mapped(edge.targetId),
    })),
    boundaries: graph.boundaries.map((boundary) => ({ ...boundary, id: mapped(boundary.id) })),
    steps: graph.steps.map((step) => ({
      ...step,
      id: mapped(step.id),
      nodeIds: step.nodeIds.map(mapped),
      edgeIds: step.edgeIds.map(mapped),
    })),
  });
}
