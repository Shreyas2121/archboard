import {
  MAX_GRAPH_COORDINATE,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_RECT_DIMENSION,
  MAX_STEP_NOTES_CHARACTERS,
  MAX_STEP_ORDER,
  MAX_STEP_REFERENCES,
  MAX_STEP_TITLE_CHARACTERS,
  MIN_STEP_ORDER,
  portableGraphProjectionSchema,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';
import {
  allEntityGraphFixture,
  CONVERGENCE_SEEDS,
  FIXED_IDS,
  FIXTURE_NAMESPACES,
  fixtureId,
} from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { projectGraphDocument } from '../projection/project.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { applyHydrationUpdate, applyRemoteUpdate } from '../undo/origins.js';
import { createLocalUndoManager } from '../undo/undo.js';
import { validateGraphDocument } from '../validation/validate.js';
import { tombstoneNode, tombstonePresentationStep } from './deletion.js';
import { createPresentationStep, editPresentationStep, reorderPresentationSteps } from './steps.js';
import { editGraphText, resolveGraphText } from './text.js';

const NEW_STEP_ORDINAL = 100;
const NEW_STEP_ID = fixtureId(FIXTURE_NAMESPACES.STEP, NEW_STEP_ORDINAL);
const CLIENT_A = 101;
const CLIENT_B = 202;
const RECEIVER_COUNT = 3;
const PRNG_MULTIPLIER = 1_664_525;
const PRNG_INCREMENT = 1_013_904_223;
const UINT32_RANGE = 0x1_0000_0000;

function graph(): GraphProjection {
  const result = structuredClone(allEntityGraphFixture);
  result.steps[0]!.title = 'Title';
  result.steps[0]!.notes = 'Notes';
  return result;
}
function step(document: Y.Doc, id = FIXED_IDS.STEP_A): PresentationStep {
  const result = projectGraphDocument(document).steps.find((candidate) => candidate.id === id);
  if (!result) throw new Error('Missing synthetic step');
  return result;
}
function freshStep(): PresentationStep {
  return { ...graph().steps[0]!, id: NEW_STEP_ID };
}
function replica(baseline: Uint8Array, clientId: number) {
  const document = new Y.Doc();
  applyHydrationUpdate(document, baseline);
  document.clientID = clientId;
  const updates: Uint8Array[] = [];
  document.on('update', (update: Uint8Array) => updates.push(update));
  return { document, updates };
}
function delivery(updates: readonly Uint8Array[], seed: number): Uint8Array[] {
  const result = updates.flatMap((update) => [update, update]);
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, PRNG_MULTIPLIER) + PRNG_INCREMENT) >>> 0;
    const other = Math.floor((state / UINT32_RANGE) * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

describe('presentation command validation and projection', () => {
  it('accepts exactly 500 combined highlights and rejects the next reference atomically', () => {
    const input = graph();
    input.nodes = Array.from({ length: MAX_STEP_REFERENCES }, (_, index) => ({
      ...input.nodes[0]!,
      id: fixtureId(FIXTURE_NAMESPACES.NODE, index + 1),
    }));
    input.edges = [
      { ...input.edges[0]!, sourceId: input.nodes[0]!.id, targetId: input.nodes[1]!.id },
    ];
    input.steps = [];
    const document = hydrateGraphDocument(input);
    const capture = {
      ...freshStep(),
      nodeIds: input.nodes.slice(1).map(({ id }) => id),
      edgeIds: [input.edges[0]!.id],
    };
    createPresentationStep(document, capture);
    expect(
      step(document, NEW_STEP_ID).nodeIds.length + step(document, NEW_STEP_ID).edgeIds.length,
    ).toBe(MAX_STEP_REFERENCES);
    const before = Y.encodeStateAsUpdate(document);
    expect(() =>
      editPresentationStep(document, NEW_STEP_ID, { nodeIds: input.nodes.map(({ id }) => id) }),
    ).toThrow();
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    document.destroy();
  });
  it('does not let incremental text commands cross shared text limits', () => {
    const document = hydrateGraphDocument(graph());
    editPresentationStep(document, FIXED_IDS.STEP_A, {
      notes: 'x'.repeat(MAX_STEP_NOTES_CHARACTERS),
    });
    expect(() =>
      editGraphText(
        document,
        { entity: 'step', id: FIXED_IDS.STEP_A, field: 'notes' },
        { index: MAX_STEP_NOTES_CHARACTERS, deleteCount: 0, insert: 'x' },
      ),
    ).toThrow();
    expect(step(document).notes).toHaveLength(MAX_STEP_NOTES_CHARACTERS);
    document.destroy();
  });
  it('rejects physical removal and tombstone clearing against an accepted step document', () => {
    const accepted = hydrateGraphDocument(graph());
    tombstonePresentationStep(accepted, FIXED_IDS.STEP_A);
    for (const root of ['steps', 'deletedSteps'] as const) {
      const candidate = new Y.Doc();
      applyHydrationUpdate(candidate, Y.encodeStateAsUpdate(accepted));
      getGraphDocumentRoots(candidate)[root].delete(FIXED_IDS.STEP_A);
      expect(() => validateGraphDocument(candidate, accepted)).toThrow();
      candidate.destroy();
    }
    accepted.destroy();
  });
  it('captures world geometry and highlights as fully initialized atomic state', () => {
    const document = hydrateGraphDocument(graph());
    const undo = createLocalUndoManager(document);
    const input = freshStep();
    input.rect = {
      x: -MAX_GRAPH_COORDINATE,
      y: MAX_GRAPH_COORDINATE,
      width: MAX_RECT_DIMENSION,
      height: 1,
    };
    input.notes = 'x'.repeat(MAX_STEP_NOTES_CHARACTERS);
    input.title = 'x'.repeat(MAX_STEP_TITLE_CHARACTERS);
    input.order = MIN_STEP_ORDER;
    let updates = 0;
    document.on('update', () => {
      updates += 1;
      validateGraphDocument(document);
    });
    createPresentationStep(document, input);
    expect(updates).toBe(1);
    expect(step(document, NEW_STEP_ID)).toEqual(input);
    input.rect.x = 0;
    input.nodeIds.length = 0;
    expect(step(document, NEW_STEP_ID).rect.x).toBe(-MAX_GRAPH_COORDINATE);
    expect(step(document, NEW_STEP_ID).nodeIds).not.toEqual([]);
    tombstonePresentationStep(document, NEW_STEP_ID);
    tombstonePresentationStep(document, NEW_STEP_ID);
    undo.undo();
    expect(undo.undoStack).toHaveLength(0);
    expect(getGraphDocumentRoots(document).steps.has(NEW_STEP_ID)).toBe(true);
    expect(getGraphDocumentRoots(document).deletedSteps.get(NEW_STEP_ID)).toBe(true);
    expect(() => createPresentationStep(document, freshStep())).toThrow();
    expect(() => editPresentationStep(document, NEW_STEP_ID, { title: 'resurrect' })).toThrow();
    undo.destroy();
    document.destroy();
  });
  const invalidChanges = [
    { rect: { x: Infinity, y: 0, width: 1, height: 1 } },
    { rect: { x: 0, y: 0, width: 0, height: 1 } },
    { rect: { x: MAX_GRAPH_COORDINATE + 1, y: 0, width: 1, height: 1 } },
    { rect: { x: 0, y: 0, width: MAX_RECT_DIMENSION + 1, height: 1 } },
    { order: MAX_STEP_ORDER + 1 },
    { order: MIN_STEP_ORDER - 1 },
    { order: 0.5 },
    { title: 'x'.repeat(MAX_STEP_TITLE_CHARACTERS + 1) },
    { notes: 'x'.repeat(MAX_STEP_NOTES_CHARACTERS + 1) },
    { nodeIds: [FIXED_IDS.NODE_A, FIXED_IDS.NODE_A] },
    { edgeIds: [FIXED_IDS.EDGE_A, FIXED_IDS.EDGE_A] },
    { nodeIds: [FIXED_IDS.BOUNDARY_A] },
    { edgeIds: [FIXED_IDS.NODE_A] },
    { nodeIds: [NEW_STEP_ID] },
    { nodeIds: Array.from({ length: MAX_STEP_REFERENCES + 1 }, () => FIXED_IDS.NODE_A) },
  ];
  it.each(invalidChanges)('rejects invalid create/edit before any transaction: %j', (changes) => {
    const document = hydrateGraphDocument(graph());
    const before = Y.encodeStateAsUpdate(document);
    expect(() => editPresentationStep(document, FIXED_IDS.STEP_A, changes)).toThrow();
    expect(() => createPresentationStep(document, { ...freshStep(), ...changes })).toThrow();
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    document.destroy();
  });
  it('rejects unknown/immutable fields and malformed reorder with no partial effect', () => {
    const document = hydrateGraphDocument(graph());
    const before = Y.encodeStateAsUpdate(document);
    const edit = (input: unknown) =>
      editPresentationStep(
        document,
        FIXED_IDS.STEP_A,
        input as Partial<Omit<PresentationStep, 'id'>>,
      );
    for (const input of [{ id: NEW_STEP_ID }, { viewport: {} }, { title: undefined }])
      expect(() => edit(input)).toThrow();
    const reorder = (input: unknown) =>
      reorderPresentationSteps(document, input as { id: string; order: number }[]);
    for (const input of [
      [
        { id: FIXED_IDS.STEP_A, order: 1 },
        { id: NEW_STEP_ID, order: 0 },
      ],
      [
        { id: FIXED_IDS.STEP_A, order: 1 },
        { id: FIXED_IDS.STEP_A, order: 0 },
      ],
      [{ id: FIXED_IDS.STEP_A, order: 0, notes: 'forged' }],
      [{ id: FIXED_IDS.STEP_A, order: MAX_STEP_ORDER + 1 }],
    ])
      expect(() => reorder(input)).toThrow();
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    document.destroy();
  });
  it('enforces the live-step cap and frees capacity only through tombstones', () => {
    const input = graph();
    input.steps = Array.from({ length: MAX_LIVE_PRESENTATION_STEPS }, (_, index) => ({
      ...freshStep(),
      id: fixtureId(FIXTURE_NAMESPACES.STEP, index + 1),
    }));
    const document = hydrateGraphDocument(input);
    expect(() => createPresentationStep(document, freshStep())).toThrow();
    tombstonePresentationStep(document, input.steps[0]!.id);
    createPresentationStep(document, freshStep());
    expect(projectGraphDocument(document).steps).toHaveLength(MAX_LIVE_PRESENTATION_STEPS);
    document.destroy();
  });
  it('projects unique surviving references without rewriting physical arrays', () => {
    const input = graph();
    input.steps[0]!.nodeIds = [FIXED_IDS.NODE_A, FIXED_IDS.NODE_A, NEW_STEP_ID];
    input.steps[0]!.edgeIds = [FIXED_IDS.EDGE_A, FIXED_IDS.EDGE_A];
    const document = hydrateGraphDocument(input);
    expect(step(document).nodeIds).toEqual([FIXED_IDS.NODE_A]);
    expect(step(document).edgeIds).toEqual([FIXED_IDS.EDGE_A]);
    tombstoneNode(document, FIXED_IDS.NODE_A);
    editPresentationStep(document, FIXED_IDS.STEP_A, { notes: 'still editable' });
    expect(step(document).nodeIds).toEqual([]);
    expect(step(document).edgeIds).toEqual([]);
    expect(() =>
      editPresentationStep(document, FIXED_IDS.STEP_A, { nodeIds: [FIXED_IDS.NODE_A] }),
    ).toThrow();
    expect(() =>
      editPresentationStep(document, FIXED_IDS.STEP_A, { edgeIds: [FIXED_IDS.EDGE_A] }),
    ).toThrow();
    expect(
      (getGraphDocumentRoots(document).steps.get(FIXED_IDS.STEP_A) as Y.Map<unknown>).get(
        'nodeIds',
      ),
    ).toEqual(input.steps[0]!.nodeIds);
    expect(portableGraphProjectionSchema.safeParse(projectGraphDocument(document)).success).toBe(
      true,
    );
    document.destroy();
  });
  it('reorders atomically with deterministic ID tie-breaking and retains unrelated fields', () => {
    const document = hydrateGraphDocument(graph());
    let updates = 0;
    document.on('update', () => {
      updates += 1;
    });
    reorderPresentationSteps(document, [
      { id: FIXED_IDS.STEP_B, order: MAX_STEP_ORDER },
      { id: FIXED_IDS.STEP_A, order: MAX_STEP_ORDER },
    ]);
    expect(updates).toBe(1);
    expect(projectGraphDocument(document).steps.map(({ id }) => id)).toEqual([
      FIXED_IDS.STEP_A,
      FIXED_IDS.STEP_B,
    ]);
    expect(step(document).notes).toBe('Notes');
    document.destroy();
  });
});

describe('independent presentation replicas', () => {
  it('undoes notes and highlight changes without reverting a remote title', () => {
    const initial = hydrateGraphDocument(graph());
    const baseline = Y.encodeStateAsUpdate(initial);
    const a = replica(baseline, CLIENT_A);
    const b = replica(baseline, CLIENT_B);
    const undo = createLocalUndoManager(a.document);
    editPresentationStep(a.document, FIXED_IDS.STEP_A, { notes: 'Notes local' });
    editPresentationStep(a.document, FIXED_IDS.STEP_A, { nodeIds: [], edgeIds: [] });
    editPresentationStep(b.document, FIXED_IDS.STEP_A, { title: 'Title remote' });
    for (const update of b.updates) applyRemoteUpdate(a.document, update);
    undo.undo();
    undo.undo();
    expect(step(a.document)).toMatchObject({
      title: 'Title remote',
      notes: 'Notes',
      nodeIds: graph().steps[0]!.nodeIds,
      edgeIds: graph().steps[0]!.edgeIds,
    });
    undo.destroy();
    initial.destroy();
    a.document.destroy();
    b.document.destroy();
  });
  it('undo retains a remote winner on the same rectangle and order fields', () => {
    const initial = hydrateGraphDocument(graph());
    const baseline = Y.encodeStateAsUpdate(initial);
    const a = replica(baseline, CLIENT_A);
    const b = replica(baseline, CLIENT_B);
    const undo = createLocalUndoManager(a.document);
    editPresentationStep(a.document, FIXED_IDS.STEP_A, {
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    reorderPresentationSteps(a.document, [{ id: FIXED_IDS.STEP_A, order: MAX_STEP_ORDER }]);
    for (const update of a.updates) applyRemoteUpdate(b.document, update);
    const remoteRect = { x: -1, y: -1, width: MAX_RECT_DIMENSION, height: 1 };
    editPresentationStep(b.document, FIXED_IDS.STEP_A, { rect: remoteRect, order: MIN_STEP_ORDER });
    for (const update of b.updates) applyRemoteUpdate(a.document, update);
    undo.undo();
    undo.undo();
    expect(step(a.document)).toMatchObject({ rect: remoteRect, order: MIN_STEP_ORDER });
    undo.destroy();
    initial.destroy();
    a.document.destroy();
    b.document.destroy();
  });
  it.each(CONVERGENCE_SEEDS)(
    'converges for text/property/reorder/delete with duplicated shuffled delivery seed %s',
    (seed) => {
      const initial = hydrateGraphDocument(graph());
      const baseline = Y.encodeStateAsUpdate(initial);
      const a = replica(baseline, CLIENT_A);
      const b = replica(baseline, CLIENT_B);
      const title = resolveGraphText(a.document, {
        entity: 'step',
        id: FIXED_IDS.STEP_A,
        field: 'title',
      });
      editPresentationStep(a.document, FIXED_IDS.STEP_A, {
        title: 'local Title',
        notes: 'Notes local',
        rect: { x: -1, y: -1, width: 1, height: 1 },
      });
      editPresentationStep(b.document, FIXED_IDS.STEP_A, {
        title: 'Title remote',
        notes: 'remote Notes',
        nodeIds: [],
        edgeIds: [],
      });
      reorderPresentationSteps(a.document, [
        { id: FIXED_IDS.STEP_A, order: MIN_STEP_ORDER },
        { id: FIXED_IDS.STEP_B, order: MAX_STEP_ORDER },
      ]);
      reorderPresentationSteps(b.document, [
        { id: FIXED_IDS.STEP_A, order: MAX_STEP_ORDER },
        { id: FIXED_IDS.STEP_B, order: MIN_STEP_ORDER },
      ]);
      tombstonePresentationStep(a.document, FIXED_IDS.STEP_B);
      editPresentationStep(b.document, FIXED_IDS.STEP_B, { title: 'deleted concurrently' });
      const updates = [...a.updates, ...b.updates];
      const receivers = Array.from({ length: RECEIVER_COUNT }, (_, index) => {
        const document = new Y.Doc();
        applyHydrationUpdate(document, baseline);
        for (const update of delivery(updates, seed + index)) applyRemoteUpdate(document, update);
        return document;
      });
      for (const document of [a.document, b.document])
        for (const update of delivery(updates, seed)) applyRemoteUpdate(document, update);
      const expected = projectGraphDocument(a.document);
      for (const document of [b.document, ...receivers]) {
        expect(projectGraphDocument(document)).toEqual(expected);
        validateGraphDocument(document, initial);
      }
      expect(step(a.document)).toMatchObject({
        title: 'local Title remote',
        notes: 'remote Notes local',
        nodeIds: [],
        edgeIds: [],
        rect: { x: -1, y: -1, width: 1, height: 1 },
      });
      expect(
        resolveGraphText(a.document, { entity: 'step', id: FIXED_IDS.STEP_A, field: 'title' }),
      ).toBe(title);
      expect(expected.steps).toHaveLength(1);
      expect(getGraphDocumentRoots(a.document).steps.has(FIXED_IDS.STEP_B)).toBe(true);
      expect(getGraphDocumentRoots(a.document).deletedSteps.get(FIXED_IDS.STEP_B)).toBe(true);
      for (const document of [initial, a.document, b.document, ...receivers]) document.destroy();
    },
  );
  it('undoes local text/property/reorder while retaining remote inserts and properties', () => {
    const initial = hydrateGraphDocument(graph());
    const baseline = Y.encodeStateAsUpdate(initial);
    const a = replica(baseline, CLIENT_A);
    const b = replica(baseline, CLIENT_B);
    const undo = createLocalUndoManager(a.document);
    editPresentationStep(a.document, FIXED_IDS.STEP_A, { title: 'local Title' });
    editPresentationStep(a.document, FIXED_IDS.STEP_A, {
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    reorderPresentationSteps(a.document, [
      { id: FIXED_IDS.STEP_A, order: MAX_STEP_ORDER },
      { id: FIXED_IDS.STEP_B, order: MIN_STEP_ORDER },
    ]);
    editGraphText(
      b.document,
      { entity: 'step', id: FIXED_IDS.STEP_A, field: 'title' },
      { index: 'Title'.length, deleteCount: 0, insert: ' remote' },
    );
    editPresentationStep(b.document, FIXED_IDS.STEP_A, { notes: 'remote notes' });
    for (const update of b.updates) applyRemoteUpdate(a.document, update);
    undo.undo();
    undo.undo();
    undo.undo();
    expect(step(a.document)).toMatchObject({
      title: 'Title remote',
      notes: 'remote notes',
      rect: graph().steps[0]!.rect,
      order: graph().steps[0]!.order,
    });
    expect(step(a.document, FIXED_IDS.STEP_B).order).toBe(graph().steps[1]!.order);
    undo.redo();
    expect(step(a.document).title).toBe('local Title remote');
    for (const update of a.updates) applyRemoteUpdate(b.document, update);
    expect(projectGraphDocument(b.document)).toEqual(projectGraphDocument(a.document));
    undo.destroy();
    initial.destroy();
    a.document.destroy();
    b.document.destroy();
  });
});
