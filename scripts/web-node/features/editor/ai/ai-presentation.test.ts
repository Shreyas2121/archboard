import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  aiCreateRunSchema,
  aiResultForRequestSchema,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_AI_OUTPUT_STEPS,
  MAX_STEP_NOTES_CHARACTERS,
  type AiPresentationProposal,
} from '@archboard/contracts';
import {
  createGraphDocument,
  createGraphObjects,
  createPresentationStep,
  projectGraphDocument,
  createLocalUndoManager,
  moveNode,
  tombstoneNode,
  editGraphText,
} from '@archboard/document-model';
import {
  prepareAiPresentation,
  preflightAiPresentation,
  applyAiPresentationBatch,
  applyReviewedAiPresentation,
  validateCurrentAiPresentation,
} from '@/features/editor/ai/ai-presentation';
import {
  reviewAiGuidance,
  retainAiGuidanceExchange,
  aiGuidanceMatchesContext,
} from '@/features/editor/ai/ai-guidance-model';
import { AiApplyJournal } from '@/features/editor/ai/ai-apply-intent';

const TWO = 2;
const OLD_ORDER = 7;
const NEW_ORDER = 8;
const SHIFT = 400;
const MAX_ORDER = 1_000_000;
const MINIMUM_BUDGET = 1;
function fixture(mode: 'append' | 'replace-reviewed' = 'append') {
  const document = createGraphDocument();
  const nodes = ['API', 'Queue', 'Private card'].map((title, index) => ({
    id: crypto.randomUUID(),
    kind: 'note' as const,
    title,
    color: 'gray' as const,
    position: { x: index * SHIFT, y: 0 },
    size: { width: 320, height: 180 },
    content: { body: `${title} declared description` },
  }));
  const edge = {
    id: crypto.randomUUID(),
    sourceId: nodes[0]!.id,
    targetId: nodes[1]!.id,
    sourceHandle: 'right' as const,
    targetHandle: 'left' as const,
    label: 'Enqueue',
    protocol: 'HTTPS',
    direction: 'forward' as const,
    style: 'solid' as const,
  };
  createGraphObjects(document, { nodes, edges: [edge] });
  const old = {
    id: crypto.randomUUID(),
    title: 'Existing step',
    notes: 'Private existing notes',
    nodeIds: [nodes[2]!.id],
    edgeIds: [],
    order: OLD_ORDER,
    rect: { x: 0, y: 0, width: 320, height: 180 },
  };
  createPresentationStep(document, old);
  const graph = projectGraphDocument(document);
  const selection = [{ kind: 'edge' as const, id: edge.id }];
  const boardId = crypto.randomUUID();
  const request = reviewAiGuidance(
    boardId,
    'presentation',
    'Recruiter walkthrough',
    graph,
    selection,
    [],
    mode,
  );
  const proposal: AiPresentationProposal = {
    kind: 'presentation',
    schemaVersion: 1,
    mode,
    expectedStepIds: mode === 'append' ? [] : [old.id],
    steps: [
      {
        key: 'z-flow',
        title: 'Declared flow',
        notes: 'Explain the declared request',
        nodeIds: [],
        edgeIds: [edge.id],
      },
      {
        key: 'a-api',
        title: 'API',
        notes: 'Discuss unknown runtime behavior',
        nodeIds: [nodes[0]!.id],
        edgeIds: [],
      },
    ],
    explanation: 'Proposed walkthrough',
    claims: [],
    assumptions: [],
    questions: [],
  };
  const source = () => Y.encodeStateAsUpdate(document);
  const prepare = () => prepareAiPresentation(source(), request, proposal);
  return {
    document,
    nodes,
    edge,
    old,
    graph,
    selection,
    boardId,
    request,
    proposal,
    source,
    prepare,
  };
}
describe('reviewed presentation proposals', () => {
  it('keeps append review private and maps fresh IDs, array order and endpoint rectangles in a detached candidate', () => {
    const f = fixture();
    const before = f.source();
    const draft = f.prepare();
    expect(f.request.presentationMode).toBe('append');
    expect(f.request.boardContext!.graph.nodes).toHaveLength(TWO);
    expect(f.request.boardContext!.graph.steps).toEqual([]);
    expect(JSON.stringify(f.request)).not.toContain(f.old.notes);
    expect(f.source()).toEqual(before);
    expect(draft.steps.map((step) => step.order)).toEqual([NEW_ORDER, NEW_ORDER + 1]);
    expect(draft.steps[0]!.edgeIds).toEqual([f.edge.id]);
    expect(draft.steps[0]!.rect).toEqual({ x: -40, y: -40, width: 800, height: 260 });
    expect(new Set(Object.values(draft.ids)).size).toBe(TWO);
    expect(draft.steps[0]!.id).toBe(draft.ids['z-flow']);
    const refresh = prepareAiPresentation(f.source(), f.request, f.proposal, { ids: draft.ids });
    expect(refresh.steps).toEqual(draft.steps);
    const candidate = preflightAiPresentation(before, draft);
    expect(f.source()).toEqual(before);
    const commit = vi.fn();
    applyAiPresentationBatch(f.document, draft, commit);
    expect(commit).toHaveBeenCalledOnce();
    expect(projectGraphDocument(f.document)).toEqual(candidate.graph);
    expect(candidate.graph.nodes).toEqual(f.graph.nodes);
    expect(candidate.graph.edges).toEqual(f.graph.edges);
    expect(candidate.graph.steps).toContainEqual(f.old);
    f.document.destroy();
  });
  it('requires explicit replacement mode and includes all existing steps and their referenced cards in review', () => {
    const f = fixture('replace-reviewed');
    expect(f.request.boardContext!.graph.steps).toEqual([f.old]);
    expect(f.request.boardContext!.graph.nodes).toHaveLength(f.nodes.length);
    const draft = f.prepare();
    const undo = createLocalUndoManager(f.document);
    applyAiPresentationBatch(f.document, draft, () => undefined);
    expect(projectGraphDocument(f.document).steps.map((step) => step.order)).toEqual([0, 1]);
    expect(
      projectGraphDocument(f.document).steps.find((step) => step.id === f.old.id),
    ).toBeUndefined();
    expect(undo.undoStack).toHaveLength(0);
    expect(() => prepareAiPresentation(f.source(), f.request, f.proposal)).toThrow();
    undo.destroy();
    f.document.destroy();
    const append = fixture();
    expect(
      aiResultForRequestSchema(append.request).safeParse({
        ...append.proposal,
        mode: 'replace-reviewed',
        expectedStepIds: [append.old.id],
      }).success,
    ).toBe(false);
    expect(
      aiCreateRunSchema.safeParse({ ...append.request, task: 'explain-selection' }).success,
    ).toBe(false);
    append.document.destroy();
  });
  it('rejects unknown, duplicate, oversized and model-owned geometry or order before any mutation', () => {
    const f = fixture();
    const before = f.source();
    const invalid = [
      { ...f.proposal, expectedStepIds: [f.old.id] },
      { ...f.proposal, steps: [{ ...f.proposal.steps[0]!, edgeIds: [crypto.randomUUID()] }] },
      { ...f.proposal, steps: [{ ...f.proposal.steps[0]!, edgeIds: [f.edge.id, f.edge.id] }] },
      {
        ...f.proposal,
        steps: [{ ...f.proposal.steps[1]!, nodeIds: [f.nodes[0]!.id, f.nodes[0]!.id] }],
      },
      { ...f.proposal, steps: [{ ...f.proposal.steps[0]!, order: 0 }] },
      { ...f.proposal, steps: [{ ...f.proposal.steps[0]!, rect: f.old.rect }] },
      {
        ...f.proposal,
        steps: Array.from({ length: MAX_AI_OUTPUT_STEPS + 1 }, (_, index) => ({
          ...f.proposal.steps[0]!,
          key: `step-${index}`,
        })),
      },
      {
        ...f.proposal,
        steps: [{ ...f.proposal.steps[0]!, notes: 'x'.repeat(MAX_STEP_NOTES_CHARACTERS + 1) }],
      },
    ];
    for (const proposal of invalid)
      expect(() => prepareAiPresentation(before, f.request, proposal)).toThrow();
    const draft = f.prepare();
    expect(() =>
      preflightAiPresentation(before, {
        ...draft,
        steps: [{ ...draft.steps[0]!, rect: f.old.rect }, draft.steps[1]!],
      }),
    ).toThrow();
    expect(f.source()).toEqual(before);
    f.document.destroy();
  });
  it.each(['move', 'delete', 'text'] as const)(
    'rejects a %s of reviewed targets before recording Apply',
    (change) => {
      const f = fixture();
      const draft = f.prepare();
      if (change === 'move') moveNode(f.document, f.nodes[0]!.id, { x: SHIFT, y: SHIFT });
      if (change === 'delete') tombstoneNode(f.document, f.nodes[0]!.id);
      if (change === 'text')
        editGraphText(
          f.document,
          { entity: 'node', id: f.nodes[0]!.id, field: 'title' },
          { index: 0, deleteCount: 0, insert: 'Changed ' },
        );
      const before = f.source();
      const record = vi.fn();
      expect(() => applyAiPresentationBatch(f.document, draft, record)).toThrow();
      expect(record).not.toHaveBeenCalled();
      expect(f.source()).toEqual(before);
      f.document.destroy();
    },
  );
  it('rejects changed replacement notes, while preserving unrelated edits during append', () => {
    for (const mode of ['append', 'replace-reviewed'] as const) {
      const f = fixture(mode);
      const draft = f.prepare();
      editGraphText(
        f.document,
        { entity: 'step', id: f.old.id, field: 'notes' },
        { index: 0, deleteCount: 0, insert: 'Changed ' },
      );
      if (mode === 'replace-reviewed')
        expect(() =>
          validateCurrentAiPresentation(draft, projectGraphDocument(f.document)),
        ).toThrow();
      else {
        moveNode(f.document, f.nodes[2]!.id, { x: SHIFT, y: SHIFT });
        applyAiPresentationBatch(f.document, draft, () => undefined);
        expect(
          projectGraphDocument(f.document).steps.find((step) => step.id === f.old.id)!.notes,
        ).toContain('Changed');
      }
      f.document.destroy();
    }
  });
  it('checks full capacity and numeric order before applying, with replacement freeing reviewed capacity', () => {
    for (const mode of ['append', 'replace-reviewed'] as const) {
      const f = fixture(mode);
      for (let index = 1; index < MAX_LIVE_PRESENTATION_STEPS; index++)
        createPresentationStep(f.document, { ...f.old, id: crypto.randomUUID(), order: index });
      const graph = projectGraphDocument(f.document);
      const request = reviewAiGuidance(
        f.boardId,
        'presentation',
        f.request.prompt,
        graph,
        f.selection,
        [],
        mode,
      );
      const proposal = {
        ...f.proposal,
        expectedStepIds: mode === 'append' ? [] : graph.steps.map((step) => step.id),
      };
      const before = f.source();
      if (mode === 'append')
        expect(() => prepareAiPresentation(before, request, proposal)).toThrow();
      else
        expect(
          preflightAiPresentation(before, prepareAiPresentation(before, request, proposal)).graph
            .steps,
        ).toHaveLength(TWO);
      expect(f.source()).toEqual(before);
      f.document.destroy();
    }
    const f = fixture();
    createPresentationStep(f.document, { ...f.old, id: crypto.randomUUID(), order: MAX_ORDER });
    expect(f.prepare).toThrow();
    f.document.destroy();
  });
  it('requires candidate refresh after a new append order and preserves the original ID mapping', () => {
    const f = fixture();
    const draft = f.prepare();
    createPresentationStep(f.document, { ...f.old, id: crypto.randomUUID(), order: NEW_ORDER });
    expect(() => applyAiPresentationBatch(f.document, draft, () => undefined)).toThrow();
    const refreshed = prepareAiPresentation(f.source(), f.request, f.proposal, { ids: draft.ids });
    expect(refreshed.ids).toEqual(draft.ids);
    expect(refreshed.steps[0]!.order).toBe(NEW_ORDER + 1);
    f.document.destroy();
  });
  it('checks encoded budgets, ID collisions and empty-reference framing without touching live state', () => {
    const f = fixture();
    const draft = f.prepare();
    const before = f.source();
    expect(() => preflightAiPresentation(before, draft, { updateBytes: MINIMUM_BUDGET })).toThrow();
    expect(() => preflightAiPresentation(before, draft, { stateBytes: MINIMUM_BUDGET })).toThrow();
    expect(() =>
      prepareAiPresentation(before, f.request, f.proposal, { allocate: () => f.old.id }),
    ).toThrow();
    const empty = prepareAiPresentation(before, f.request, {
      ...f.proposal,
      steps: [{ ...f.proposal.steps[0]!, nodeIds: [], edgeIds: [] }],
    });
    expect(empty.steps[0]!.rect).toEqual(draft.steps[0]!.rect);
    expect(f.source()).toEqual(before);
    f.document.destroy();
  });
  it('rejects over-wide derived viewports and replacement review with deleted references', () => {
    const f = fixture();
    moveNode(f.document, f.nodes[1]!.id, { x: 30_000, y: 0 });
    const wide = reviewAiGuidance(
      f.boardId,
      'presentation',
      f.request.prompt,
      projectGraphDocument(f.document),
      f.selection,
      [],
      'append',
    );
    expect(() => prepareAiPresentation(f.source(), wide, f.proposal)).toThrow();
    const dangling = projectGraphDocument(f.document);
    dangling.nodes = dangling.nodes.filter((node) => node.id !== f.nodes[2]!.id);
    expect(() =>
      reviewAiGuidance(
        f.boardId,
        'presentation',
        f.request.prompt,
        dangling,
        f.selection,
        [],
        'replace-reviewed',
      ),
    ).toThrow();
    f.document.destroy();
  });
  it('preflights encoded mutation size using the actual writer identity', () => {
    const f = fixture();
    const draft = f.prepare();
    const candidate = preflightAiPresentation(f.source(), draft, { clientId: f.document.clientID });
    const vector = Y.encodeStateVector(f.document);
    applyAiPresentationBatch(f.document, draft, () => undefined);
    expect(Y.encodeStateAsUpdate(f.document, vector).byteLength).toBe(candidate.updateBytes);
    f.document.destroy();
  });
  it('blocks unauthorized Apply, journal failures and replays across reload, with isolated account/board namespaces', () => {
    const f = fixture();
    const draft = f.prepare();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const scope = {
      deploymentOrigin: 'https://example.test',
      userId: crypto.randomUUID(),
      boardId: f.boardId,
      graphSchemaVersion: 1 as const,
    };
    const journal = new AiApplyJournal(scope, storage);
    const session = {
      canEdit: () => true,
      applyAiPresentation: (value: typeof draft, before: () => void) =>
        applyAiPresentationBatch(f.document, value, before),
    };
    const runId = crypto.randomUUID();
    const before = f.source();
    expect(() =>
      applyReviewedAiPresentation(session, journal, runId, draft, () => false),
    ).toThrow();
    expect(f.source()).toEqual(before);
    const failing = new AiApplyJournal(scope, {
      ...storage,
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });
    expect(() => applyReviewedAiPresentation(session, failing, runId, draft, () => true)).toThrow();
    expect(f.source()).toEqual(before);
    applyReviewedAiPresentation(session, journal, runId, draft, () => true);
    expect(journal.get(runId)!.kind).toBe('presentation');
    expect(() =>
      applyReviewedAiPresentation(
        session,
        new AiApplyJournal(scope, storage),
        runId,
        draft,
        () => true,
      ),
    ).toThrow();
    expect(
      new AiApplyJournal({ ...scope, userId: crypto.randomUUID() }, storage).get(runId),
    ).toBeUndefined();
    expect(
      new AiApplyJournal({ ...scope, boardId: crypto.randomUUID() }, storage).get(runId),
    ).toBeUndefined();
    f.document.destroy();
  });
  it('retains exact bounded private history and invalidates review on history or mode transition', () => {
    const f = fixture();
    const history = retainAiGuidanceExchange(f.request, f.proposal);
    expect(history[1]!.text).toBe(JSON.stringify(f.proposal));
    expect(
      aiGuidanceMatchesContext(
        f.request,
        f.graph,
        f.selection,
        [],
        f.request.prompt,
        'presentation',
        'append',
      ),
    ).toBe(true);
    expect(
      aiGuidanceMatchesContext(
        f.request,
        f.graph,
        f.selection,
        history,
        f.request.prompt,
        'presentation',
        'append',
      ),
    ).toBe(false);
    expect(
      aiGuidanceMatchesContext(
        f.request,
        f.graph,
        f.selection,
        [],
        f.request.prompt,
        'presentation',
        'replace-reviewed',
      ),
    ).toBe(false);
    f.document.destroy();
  });
});
