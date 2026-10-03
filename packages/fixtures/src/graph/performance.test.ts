import { expect, it } from 'vitest';
import { graphProjectionSchema, MAX_CONTENT_BODY_CHARACTERS } from '@archboard/contracts';
import {
  createPerformanceGraphFixture,
  createPerformanceCapFixtures,
  PERFORMANCE_TEXT_CHARACTERS,
} from './performance.js';
import { TYPICAL_GRAPH_COUNTS, LIMIT_GRAPH_COUNTS } from './fixtures.js';
const OTHER_SEED = 805;
const NODE_KIND_COUNT = 4;

it('keeps deterministic full typical/limit topology and all kinds with seeded text', () => {
  for (const size of ['typical', 'limit'] as const) {
    const graph = createPerformanceGraphFixture(size);
    expect(graph).toEqual(createPerformanceGraphFixture(size));
    expect(graph).not.toEqual(createPerformanceGraphFixture(size, OTHER_SEED));
    expect([
      graph.nodes.length,
      graph.edges.length,
      graph.boundaries.length,
      graph.steps.length,
    ]).toEqual(Object.values(size === 'typical' ? TYPICAL_GRAPH_COUNTS : LIMIT_GRAPH_COUNTS));
    expect(new Set(graph.nodes.map(({ kind }) => kind)).size).toBe(NODE_KIND_COUNT);
    for (const node of graph.nodes)
      if (node.kind !== 'component') {
        expect(node.content.body.length).toBe(PERFORMANCE_TEXT_CHARACTERS);
        expect(node.content.body.length).toBeLessThan(MAX_CONTENT_BODY_CHARACTERS);
      }
    expect(graphProjectionSchema.safeParse(graph).success).toBe(true);
  }
  expect(() => createPerformanceGraphFixture('typical', -1)).toThrow();
});

it('tests independent exact and adjacent caps without combining text maxima', () => {
  for (const fixture of createPerformanceCapFixtures()) {
    expect(
      graphProjectionSchema.safeParse(fixture.candidate).success,
      `${fixture.family} ${fixture.offset}`,
    ).toBe(fixture.accepted);
  }
});
