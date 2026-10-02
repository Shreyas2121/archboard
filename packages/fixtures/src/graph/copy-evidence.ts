import { portableGraphProjectionSchema, type GraphProjection } from '@archboard/contracts';
import { fixtureId, FIXTURE_NAMESPACES, type FixtureNamespace } from '../ids.js';

/** Test fixture comparison only: remove UUID differences while preserving every authored field.
 * Identical entities are deliberately rejected rather than guessing a graph isomorphism.
 */
export function normalizeGraphFixtureIds(source: GraphProjection): GraphProjection {
  const graph = portableGraphProjectionSchema.parse(source);
  const ids = new Map<string, string>();
  function ordered<T extends { id: string }>(entities: T[], namespace: FixtureNamespace): T[] {
    const keyed = entities.map((entity) => ({
      entity,
      key: JSON.stringify({ ...entity, id: '' }),
    }));
    if (new Set(keyed.map((row) => row.key)).size !== keyed.length)
      throw new Error('Ambiguous identical entities in comparison fixture.');
    keyed.sort((a, b) => a.key.localeCompare(b.key));
    return keyed.map(({ entity }, index) => {
      const id = fixtureId(namespace, index);
      ids.set(entity.id, id);
      return { ...entity, id };
    });
  }
  const mapped = (id: string): string => {
    const value = ids.get(id);
    if (!value) throw new Error('Missing comparison reference.');
    return value;
  };
  const nodes = ordered(graph.nodes, FIXTURE_NAMESPACES.NODE);
  const edges = ordered(
    graph.edges.map((edge) => ({
      ...edge,
      sourceId: mapped(edge.sourceId),
      targetId: mapped(edge.targetId),
    })),
    FIXTURE_NAMESPACES.EDGE,
  );
  const boundaries = ordered(graph.boundaries, FIXTURE_NAMESPACES.BOUNDARY);
  const steps = ordered(
    graph.steps.map((step) => ({
      ...step,
      nodeIds: step.nodeIds.map(mapped),
      edgeIds: step.edgeIds.map(mapped),
    })),
    FIXTURE_NAMESPACES.STEP,
  );
  return portableGraphProjectionSchema.parse({
    schemaVersion: graph.schemaVersion,
    nodes,
    edges,
    boundaries,
    steps,
  });
}
