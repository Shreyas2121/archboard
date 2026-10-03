import {
  graphProjectionSchema,
  MAX_CONTENT_BODY_CHARACTERS,
  MAX_NODE_TITLE_CHARACTERS,
  MAX_COMPONENT_DESCRIPTION_CHARACTERS,
  MAX_STEP_NOTES_CHARACTERS,
  type GraphProjection,
} from '@archboard/contracts';
import { createLimitGraphFixture, createTypicalGraphFixture } from './fixtures.js';
import { LIMIT_GRAPH_COUNTS } from './fixtures.js';
import { buildGraphFixture, type GraphFixtureCounts } from './builders.js';

export const PERFORMANCE_SEED = 804;
export const PERFORMANCE_TEXT_CHARACTERS = 8_192;
const MAX_SEED = 0xffff_ffff;
const SEED_MULTIPLIER = 1_664_525;
const SEED_INCREMENT = 1_013_904_223;
const HEX_RADIX = 16;

/** Stable IDs/topology from the named fixtures; seeded synthetic text, never real content. */
export function createPerformanceGraphFixture(
  size: 'typical' | 'limit',
  seed = PERFORMANCE_SEED,
): GraphProjection {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new Error('Performance seed must be an unsigned 32-bit integer.');
  }
  let state = seed;
  const next = () => (state = (Math.imul(state, SEED_MULTIPLIER) + SEED_INCREMENT) >>> 0);
  const graph = size === 'typical' ? createTypicalGraphFixture() : createLimitGraphFixture();
  return graphProjectionSchema.parse({
    ...graph,
    nodes: graph.nodes.map((node) => {
      const line = `// synthetic ${next().toString(HEX_RADIX)}\nexport const value = 804;\n`;
      const body = line
        .repeat(Math.ceil(PERFORMANCE_TEXT_CHARACTERS / line.length))
        .slice(0, PERFORMANCE_TEXT_CHARACTERS);
      return node.kind === 'component' ? node : { ...node, content: { ...node.content, body } };
    }),
  });
}

/** Independent below/exact/above cap families, not a combined all-maxima document. */
export function createPerformanceCapFixtures() {
  const baselineCounts: GraphFixtureCounts = {
    nodeCount: 4,
    edgeCount: 1,
    boundaryCount: 1,
    stepCount: 1,
  };
  const families: readonly [string, number, (length: number) => GraphProjection][] = [
    ...Object.entries(LIMIT_GRAPH_COUNTS).map(
      ([key, cap]): [string, number, (length: number) => GraphProjection] => [
        key,
        cap,
        (length) => buildGraphFixture({ ...baselineCounts, [key]: length }),
      ],
    ),
    [
      'title',
      MAX_NODE_TITLE_CHARACTERS,
      (length) => {
        const graph = buildGraphFixture(baselineCounts);
        graph.nodes[0] = { ...graph.nodes[0]!, title: 'x'.repeat(length) };
        return graph;
      },
    ],
    [
      'description',
      MAX_COMPONENT_DESCRIPTION_CHARACTERS,
      (length) => {
        const graph = buildGraphFixture(baselineCounts);
        const node = graph.nodes[0]!;
        if (node.kind === 'component')
          graph.nodes[0] = {
            ...node,
            content: { ...node.content, description: 'x'.repeat(length) },
          };
        return graph;
      },
    ],
    [
      'body',
      MAX_CONTENT_BODY_CHARACTERS,
      (length) => {
        const graph = buildGraphFixture(baselineCounts);
        const node = graph.nodes[1]!;
        if (node.kind === 'code')
          graph.nodes[1] = { ...node, content: { ...node.content, body: 'x'.repeat(length) } };
        return graph;
      },
    ],
    [
      'notes',
      MAX_STEP_NOTES_CHARACTERS,
      (length) => {
        const graph = buildGraphFixture(baselineCounts);
        graph.steps[0] = { ...graph.steps[0]!, notes: 'x'.repeat(length) };
        return graph;
      },
    ],
  ];
  return families.flatMap(([family, cap, build]) =>
    [-1, 0, 1].map((offset) => ({
      family,
      cap,
      offset,
      accepted: offset <= 0,
      candidate: build(cap + offset),
    })),
  );
}
