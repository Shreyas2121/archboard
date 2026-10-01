import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GRAPH_COORDINATE,
  MAX_RECT_DIMENSION,
  MAX_STEP_ORDER,
} from '../packages/contracts/dist/index.js';
import { allEntityGraphFixture, FIXED_IDS } from '../packages/fixtures/dist/index.js';
// Node strips this pure module's TypeScript; its only runtime import is contracts.
import {
  adjacentStep,
  captureHighlights,
  newStepOrder,
  presentationShortcut,
  reorderedSteps,
  sortedSteps,
  visibleWorldRect,
} from '../apps/web/src/features/editor/presentation/presentation-model.ts';

const size = { width: 1000, height: 600 };
const viewport = { x: 200, y: -100, zoom: 2 };
const unmodified = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
describe('local presentation geometry, selection and navigation', () => {
  it('captures actual world bounds and preserves viewport inputs', () => {
    assert.deepEqual(visibleWorldRect(size, viewport), { x: -100, y: 50, width: 500, height: 300 });
    assert.deepEqual(viewport, { x: 200, y: -100, zoom: 2 });
    assert.equal(
      visibleWorldRect(
        { width: MAX_RECT_DIMENSION, height: MAX_RECT_DIMENSION },
        { x: -MAX_GRAPH_COORDINATE, y: MAX_GRAPH_COORDINATE, zoom: 1 },
      ).x,
      MAX_GRAPH_COORDINATE,
    );
  });
  for (const zoom of [0, -1, Infinity, NaN])
    it(`rejects invalid zoom ${zoom}`, () =>
      assert.throws(() => visibleWorldRect(size, { ...viewport, zoom })));
  it('rejects invalid/out-of-range captures without silently clipping', () => {
    for (const candidate of [
      { width: 0, height: size.height },
      { width: MAX_RECT_DIMENSION + 1, height: size.height },
      { width: Infinity, height: size.height },
    ])
      assert.throws(() => visibleWorldRect(candidate, { x: 0, y: 0, zoom: 1 }));
    assert.throws(() => visibleWorldRect(size, { x: MAX_GRAPH_COORDINATE + 1, y: 0, zoom: 1 }));
  });
  it('captures unique live cards/edges and excludes boundary/missing targets', () => {
    assert.deepEqual(
      captureHighlights(allEntityGraphFixture, [
        { id: FIXED_IDS.NODE_A, kind: 'node' },
        { id: FIXED_IDS.NODE_A, kind: 'node' },
        { id: FIXED_IDS.EDGE_A, kind: 'edge' },
        { id: FIXED_IDS.BOUNDARY_A, kind: 'boundary' },
        { id: FIXED_IDS.STEP_A, kind: 'node' },
      ]),
      { nodeIds: [FIXED_IDS.NODE_A], edgeIds: [FIXED_IDS.EDGE_A] },
    );
    assert.deepEqual(captureHighlights(allEntityGraphFixture, []), { nodeIds: [], edgeIds: [] });
  });
  it('sorts/reorders deterministically within the integer domain without changing the source', () => {
    const steps = allEntityGraphFixture.steps
      .map((step) => ({ ...step, order: MAX_STEP_ORDER }))
      .reverse();
    const before = structuredClone(steps);
    assert.deepEqual(
      sortedSteps(steps).map(({ id }) => id),
      [FIXED_IDS.STEP_A, FIXED_IDS.STEP_B],
    );
    assert.deepEqual(reorderedSteps(steps, FIXED_IDS.STEP_A, FIXED_IDS.STEP_B), [
      { id: FIXED_IDS.STEP_B, order: 0 },
      { id: FIXED_IDS.STEP_A, order: 1 },
    ]);
    assert.deepEqual(steps, before);
    assert.equal(newStepOrder(steps), MAX_STEP_ORDER);
    assert.equal(newStepOrder([]), 0);
    assert.deepEqual(reorderedSteps(steps, 'deleted', FIXED_IDS.STEP_A), []);
  });
  it('does not wrap navigation or silently pick a step after deletion', () => {
    assert.equal(adjacentStep([], FIXED_IDS.STEP_A, 1), null);
    assert.equal(adjacentStep(allEntityGraphFixture.steps, 'deleted', 1), null);
    assert.equal(adjacentStep(allEntityGraphFixture.steps, FIXED_IDS.STEP_A, -1), null);
    assert.equal(adjacentStep(allEntityGraphFixture.steps, FIXED_IDS.STEP_A, 1), FIXED_IDS.STEP_B);
    assert.equal(adjacentStep(allEntityGraphFixture.steps, FIXED_IDS.STEP_B, 1), null);
  });
  for (const [key, command] of [
    ['ArrowLeft', 'previous'],
    ['ArrowRight', 'next'],
    ['Escape', 'exit'],
    ['Delete', null],
    ['x', null],
  ])
    it(`maps ${key}`, () => assert.equal(presentationShortcut({ ...unmodified, key }), command));
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])
    it(`preserves ${modifier} native shortcuts`, () =>
      assert.equal(
        presentationShortcut({ ...unmodified, key: 'ArrowRight', [modifier]: true }),
        null,
      ));
});
