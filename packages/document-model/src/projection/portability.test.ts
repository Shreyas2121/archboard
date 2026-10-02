import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allEntityGraphFixture,
  createTypicalGraphFixture,
  normalizeGraphFixtureIds,
  resolveTemplate,
  TEMPLATE_CHOICES,
} from '@archboard/fixtures';
import { createFreshGraphUpdate } from './fresh.js';
import { projectGraphDocument } from './project.js';
import { getGraphDocumentRoots } from '../schema/document.js';
const fixtures = [
  { name: 'all-kind', graph: allEntityGraphFixture },
  { name: 'typical', graph: createTypicalGraphFixture() },
  ...TEMPLATE_CHOICES.map((choice) => ({ name: choice.id, graph: resolveTemplate(choice.id) })),
];

describe('integrated copy semantics', () => {
  it.each(fixtures)('preserves every authored field and reference in $name', ({ graph }) => {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, createFreshGraphUpdate(graph));
      const copy = projectGraphDocument(doc);
      expect(normalizeGraphFixtureIds(copy)).toEqual(normalizeGraphFixtureIds(graph));
      const oldIds = new Set(
        [...graph.nodes, ...graph.edges, ...graph.boundaries, ...graph.steps].map((e) => e.id),
      );
      expect(
        [...copy.nodes, ...copy.edges, ...copy.boundaries, ...copy.steps].every(
          (e) => !oldIds.has(e.id),
        ),
      ).toBe(true);
      const roots = getGraphDocumentRoots(doc);
      for (const deleted of [
        roots.deletedNodes,
        roots.deletedEdges,
        roots.deletedBoundaries,
        roots.deletedSteps,
      ])
        expect(deleted.size).toBe(0);
      const changed = structuredClone(copy);
      changed.nodes[0]!.position.x++;
      expect(normalizeGraphFixtureIds(changed)).not.toEqual(normalizeGraphFixtureIds(graph));
      changed.nodes[0]!.position = { ...copy.nodes[0]!.position };
      changed.steps[0]!.notes += 'modified';
      expect(normalizeGraphFixtureIds(changed)).not.toEqual(normalizeGraphFixtureIds(copy));
    } finally {
      doc.destroy();
    }
  });
  it('rejects invalid references instead of hiding corruption during comparison', () => {
    const graph = structuredClone(allEntityGraphFixture);
    graph.edges[0]!.sourceId = crypto.randomUUID();
    expect(() => normalizeGraphFixtureIds(graph)).toThrow();
  });
});
