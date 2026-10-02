import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TEMPLATE_CHOICES, resolveTemplate } from '@archboard/fixtures';
import { portableGraphProjectionSchema } from '@archboard/contracts';
import { createFreshGraphUpdate } from './fresh.js';
import { projectGraphDocument } from './project.js';
import { getGraphDocumentRoots } from '../schema/document.js';
const ids = (graph: ReturnType<typeof resolveTemplate>) =>
  [...graph.nodes, ...graph.edges, ...graph.boundaries, ...graph.steps].map((e) => e.id);

describe('fresh template initialization', () => {
  it.each(TEMPLATE_CHOICES)(
    'creates disjoint $id graphs with empty history and connected highlights',
    ({ id }) => {
      const source = resolveTemplate(id);
      const docs = [new Y.Doc(), new Y.Doc()];
      try {
        const graphs = docs.map((doc) => {
          Y.applyUpdate(doc, createFreshGraphUpdate(source));
          const graph = portableGraphProjectionSchema.parse(projectGraphDocument(doc));
          const roots = getGraphDocumentRoots(doc);
          for (const root of [
            roots.deletedNodes,
            roots.deletedEdges,
            roots.deletedBoundaries,
            roots.deletedSteps,
          ])
            expect(root.size).toBe(0);
          expect(
            graph.nodes
              .map((node) => ({ ...node, id: '' }))
              .sort((a, b) => a.title.localeCompare(b.title)),
          ).toEqual(
            source.nodes
              .map((node) => ({ ...node, id: '' }))
              .sort((a, b) => a.title.localeCompare(b.title)),
          );
          return graph;
        });
        expect(docs[0]!.clientID).not.toBe(docs[1]!.clientID);
        const originals = new Set(ids(source));
        const first = new Set(ids(graphs[0]!));
        expect(ids(graphs[0]!).every((id) => !originals.has(id))).toBe(true);
        expect(ids(graphs[1]!).every((id) => !originals.has(id) && !first.has(id))).toBe(true);
        for (const graph of graphs) {
          const mapping = new Map([
            ...source.nodes.map(
              (n) => [n.id, graph.nodes.find((g) => g.title === n.title)!.id] as const,
            ),
            ...source.edges.map(
              (e) => [e.id, graph.edges.find((g) => g.label === e.label)!.id] as const,
            ),
            ...source.boundaries.map(
              (b) => [b.id, graph.boundaries.find((g) => g.title === b.title)!.id] as const,
            ),
            ...source.steps.map(
              (s) => [s.id, graph.steps.find((g) => g.title === s.title)!.id] as const,
            ),
          ]);
          expect([...graph.edges].sort((a, b) => a.label.localeCompare(b.label))).toEqual(
            source.edges
              .map((e) => ({
                ...e,
                id: mapping.get(e.id),
                sourceId: mapping.get(e.sourceId),
                targetId: mapping.get(e.targetId),
              }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          );
          expect([...graph.boundaries].sort((a, b) => a.title.localeCompare(b.title))).toEqual(
            source.boundaries
              .map((b) => ({ ...b, id: mapping.get(b.id) }))
              .sort((a, b) => a.title.localeCompare(b.title)),
          );
          expect(graph.steps).toEqual(
            source.steps.map((s) => ({
              ...s,
              id: mapping.get(s.id),
              nodeIds: s.nodeIds.map((id) => mapping.get(id)),
              edgeIds: s.edgeIds.map((id) => mapping.get(id)),
            })),
          );
        }
      } finally {
        docs.forEach((doc) => doc.destroy());
      }
    },
  );
});
