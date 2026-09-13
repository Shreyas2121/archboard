import { allEntityGraphFixture, FIXED_IDS } from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { EDGE_FIELDS, STEP_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { validateGraphDocument } from '../validation/validate.js';
import { projectGraphDocument } from './project.js';

describe('deterministic graph projection', () => {
  it('sorts every entity collection stably regardless of insertion order', () => {
    const reversed = {
      ...allEntityGraphFixture,
      nodes: [...allEntityGraphFixture.nodes].reverse(),
      edges: [...allEntityGraphFixture.edges].reverse(),
      boundaries: [...allEntityGraphFixture.boundaries].reverse(),
      steps: [...allEntityGraphFixture.steps].reverse(),
    };

    expect(projectGraphDocument(hydrateGraphDocument(reversed))).toEqual(allEntityGraphFixture);
  });

  it('filters tombstones, incident edges, and missing step targets', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const roots = getGraphDocumentRoots(document);
    roots.deletedNodes.set(FIXED_IDS.NODE_A, true);
    roots.deletedBoundaries.set(FIXED_IDS.BOUNDARY_A, true);
    roots.deletedSteps.set(FIXED_IDS.STEP_B, true);

    const projection = projectGraphDocument(document);
    expect(projection.nodes.map(({ id }) => id)).not.toContain(FIXED_IDS.NODE_A);
    expect(projection.edges.map(({ id }) => id)).not.toContain(FIXED_IDS.EDGE_A);
    expect(projection.boundaries).toEqual([]);
    expect(projection.steps.map(({ id }) => id)).toEqual([FIXED_IDS.STEP_A]);
    expect(projection.steps[0]?.nodeIds).toEqual([FIXED_IDS.NODE_B]);
    expect(projection.steps[0]?.edgeIds).toEqual([]);
  });

  it('treats missing graph references as valid structure rather than a causal gap', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const roots = getGraphDocumentRoots(document);
    const edge = roots.edges.get(FIXED_IDS.EDGE_A) as Y.Map<unknown>;
    const step = roots.steps.get(FIXED_IDS.STEP_A) as Y.Map<unknown>;
    edge.set(EDGE_FIELDS.SOURCE_ID, FIXED_IDS.UPDATE_A);
    step.set(STEP_FIELDS.NODE_IDS, [FIXED_IDS.NODE_A, FIXED_IDS.UPDATE_A]);
    step.set(STEP_FIELDS.EDGE_IDS, [FIXED_IDS.EDGE_A, FIXED_IDS.UPDATE_B]);

    expect(() => validateGraphDocument(document)).not.toThrow();
    const projection = projectGraphDocument(document);
    expect(projection.edges.map(({ id }) => id)).not.toContain(FIXED_IDS.EDGE_A);
    expect(projection.steps[0]?.nodeIds).toEqual([FIXED_IDS.NODE_A]);
    expect(projection.steps[0]?.edgeIds).toEqual([]);
  });
});
