import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { GRAPH_SCHEMA_VERSION, type AiDiagramProposal } from '@archboard/contracts';
import {
  COMMAND_ORIGINS,
  createGraphDocument,
  createLocalUndoManager,
  deleteGraphObjects,
  projectGraphDocument,
} from '@archboard/document-model';
import {
  AiApplyJournal,
  aiCreatedIdsState,
  applyAiGraphBatch,
  applyReviewedAiDiagram,
} from '@/features/editor/ai/ai-apply-intent';
import { prepareAiDiagramDraft, preflightAiDiagram } from '@/features/editor/ai/ai-diagram-draft';
import { fallbackAiLayout } from '@/features/editor/ai/ai-diagram-geometry';
import {
  PortableSubmission,
  RECEIPT_WINDOW_MS,
} from '@/features/editor/portability/portability-policy';

const namespace = {
  deploymentOrigin: 'https://example.test',
  userId: 'actor',
  boardId: crypto.randomUUID(),
  graphSchemaVersion: GRAPH_SCHEMA_VERSION,
};
const MAX_CRDT_CLIENT_ID = 4_294_967_295;
const JOURNAL_CAPACITY = 64;
const proposal: AiDiagramProposal = {
  kind: 'diagram',
  schemaVersion: 1,
  nodes: [
    {
      key: 'service',
      kind: 'note',
      title: 'Reviewed service',
      color: 'blue',
      content: { body: 'Reviewed text' },
    },
  ],
  edges: [],
  boundaries: [],
  steps: [{ key: 'tour', title: 'Tour', notes: '', nodeKeys: ['service'], edgeKeys: [] }],
  explanation: 'Explanation',
  assumptions: [],
  questions: [],
  claims: [],
};
function storage() {
  const records = new Map<string, string>();
  return {
    records,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      records.set(key, value);
    }),
  };
}
async function harness() {
  const document = createGraphDocument();
  const draft = await prepareAiDiagramDraft(
    proposal,
    Y.encodeStateAsUpdate(document),
    new AbortController().signal,
    {
      layout: async (input) => ({
        positions: fallbackAiLayout(input),
        status: 'fallback',
        reason: 'unavailable',
      }),
    },
  );
  const projection = projectGraphDocument(document);
  const store = storage();
  const journal = new AiApplyJournal(namespace, store);
  const runId = crypto.randomUUID();
  let writable = true;
  let allowed = true;
  let current = projection;
  const target = {
    canEdit: () => writable,
    getSnapshot: () => ({ projection: current }),
    inspectAiCreatedIds: (ids: Readonly<Record<string, string>>) =>
      aiCreatedIdsState(document, ids),
    applyAiDiagram: vi.fn((graph) => applyAiGraphBatch(document, graph)),
  };
  const apply = () =>
    applyReviewedAiDiagram(target, journal, runId, draft, projection, () => allowed);
  return {
    document,
    draft,
    store,
    journal,
    runId,
    target,
    apply,
    deny: () => {
      allowed = false;
    },
    readonly: () => {
      writable = false;
    },
    stale: () => {
      current = { ...projection };
    },
  };
}

describe('reviewed additive AI Apply', () => {
  it('preflights exact full-state bytes using the live writer CRDT client ID', async () => {
    const h = await harness();
    h.document.clientID = MAX_CRDT_CLIENT_ID;
    const proof = preflightAiDiagram(Y.encodeStateAsUpdate(h.document), h.draft.graph, {
      clientId: h.document.clientID,
    });
    const updates: Uint8Array[] = [];
    h.document.on('update', (bytes) => {
      updates.push(bytes);
    });
    h.apply();
    expect(Y.encodeStateAsUpdate(h.document).byteLength).toBe(proof.stateBytes);
    expect(updates[0]!.byteLength).toBeLessThanOrEqual(proof.updateBytes);
    h.document.destroy();
  });
  it('persists IDs before one structural update and excludes additions from Undo', async () => {
    const h = await harness();
    const undo = createLocalUndoManager(h.document);
    const updates: Uint8Array[] = [];
    h.document.on('update', (bytes, origin) => {
      expect(h.journal.get(h.runId)?.ids).toEqual(h.draft.ids);
      expect(origin).toBe(COMMAND_ORIGINS.LOCAL_STRUCTURAL);
      updates.push(bytes);
    });
    h.apply();
    h.apply();
    expect(updates).toHaveLength(1);
    expect(h.target.applyAiDiagram).toHaveBeenCalledTimes(1);
    expect(projectGraphDocument(h.document)).toEqual(h.draft.graph);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
    h.document.destroy();
  });
  it('reloads pending intent and recognizes the same IDs even after deletion', async () => {
    const h = await harness();
    h.apply();
    const reloaded = new AiApplyJournal(namespace, h.store);
    expect(reloaded.get(h.runId)?.state).toBe('prepared');
    deleteGraphObjects(h.document, { nodeIds: [h.draft.graph.nodes[0]!.id] });
    expect(aiCreatedIdsState(h.document, reloaded.get(h.runId)!.ids)).toBe('present');
    applyReviewedAiDiagram(
      h.target,
      reloaded,
      h.runId,
      h.draft,
      h.target.getSnapshot().projection,
      () => true,
    );
    expect(h.target.applyAiDiagram).toHaveBeenCalledTimes(1);
    reloaded.complete(h.runId);
    expect(new AiApplyJournal(namespace, h.store).get(h.runId)?.state).toBe('applied');
    h.document.destroy();
  });
  it.each(['deny', 'readonly', 'stale'] as const)(
    'rejects %s without mutation or journal writes',
    async (change) => {
      const h = await harness();
      const before = Y.encodeStateAsUpdate(h.document);
      h[change]();
      expect(h.apply).toThrow(/changed/);
      expect(h.store.setItem).not.toHaveBeenCalled();
      expect(Y.encodeStateAsUpdate(h.document)).toEqual(before);
      h.document.destroy();
    },
  );
  it('rejects storage failure before mutation', async () => {
    const h = await harness();
    h.store.setItem.mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    expect(h.apply).toThrow(/Quota/);
    expect(projectGraphDocument(h.document).nodes).toHaveLength(0);
    expect(h.target.applyAiDiagram).not.toHaveBeenCalled();
    h.document.destroy();
  });
  it('rejects fresh ID conflicts, malformed late steps and partial recovery atomically', async () => {
    const h = await harness();
    applyAiGraphBatch(h.document, h.draft.graph);
    const before = Y.encodeStateAsUpdate(h.document);
    expect(h.apply).toThrow(/Fresh Apply IDs/);
    expect(Y.encodeStateAsUpdate(h.document)).toEqual(before);
    h.document.destroy();
    const next = await harness();
    const bad = {
      ...next.draft.graph,
      steps: [{ ...next.draft.graph.steps[0]!, nodeIds: [crypto.randomUUID()] }],
    };
    const fresh = Y.encodeStateAsUpdate(next.document);
    expect(() => applyAiGraphBatch(next.document, bad)).toThrow();
    expect(Y.encodeStateAsUpdate(next.document)).toEqual(fresh);
    next.journal.prepare(next.runId, next.draft.ids);
    applyAiGraphBatch(next.document, { ...next.draft.graph, steps: [] });
    expect(next.apply).toThrow(/conflict/);
    next.document.destroy();
  });
});

describe('scoped Apply and import recovery journal', () => {
  it('refuses capacity overflow while retaining old replay barriers', () => {
    const store = storage();
    const journal = new AiApplyJournal(namespace, store);
    const first = crypto.randomUUID();
    const ids = { service: crypto.randomUUID() };
    journal.prepare(first, ids);
    for (let index = 1; index < JOURNAL_CAPACITY; index++)
      journal.prepare(crypto.randomUUID(), { service: crypto.randomUUID() });
    const before = [...store.records.values()];
    expect(() => journal.prepare(crypto.randomUUID(), { service: crypto.randomUUID() })).toThrow(
      /full/,
    );
    expect([...store.records.values()]).toEqual(before);
    expect(journal.get(first)?.ids).toEqual(ids);
  });
  it('isolates accounts, boards and deployments and rejects remapping', () => {
    const store = storage();
    const journal = new AiApplyJournal(namespace, store);
    const run = crypto.randomUUID();
    const ids = { service: crypto.randomUUID() };
    journal.prepare(run, ids);
    for (const scope of [
      { ...namespace, userId: 'other' },
      { ...namespace, boardId: crypto.randomUUID() },
      { ...namespace, deploymentOrigin: 'https://other.test' },
    ])
      expect(new AiApplyJournal(scope, store).get(run)).toBeUndefined();
    expect(() => journal.prepare(run, { service: crypto.randomUUID() })).toThrow(
      /original Apply IDs/,
    );
  });
  it('retains exact import body/key across reload and removes private content at receipt expiry', () => {
    const store = storage();
    let now = 100;
    const journal = new AiApplyJournal(namespace, store, () => now);
    const run = crypto.randomUUID();
    journal.prepare(run, { service: crypto.randomUUID() });
    const intent = new PortableSubmission(
      crypto.randomUUID(),
      { title: 'Private reviewed import', graph: 'Original immutable graph' },
      now,
    );
    journal.saveImport(run, {
      key: intent.key,
      json: intent.json,
      startedAt: intent.startedAt,
      state: 'uncertain',
    });
    const saved = new AiApplyJournal(namespace, store, () => now).get(run)!.import!;
    expect(saved.key).toBe(intent.key);
    expect(saved.json).toBe(intent.json);
    now += RECEIPT_WINDOW_MS;
    expect(journal.get(run)!.import!.json).toBeUndefined();
    expect([...store.records.values()].join('')).not.toContain('Private reviewed import');
    expect(journal.get(run)!.import!.key).toBe(intent.key);
  });
  it('retains confirmed new-board identity while dropping its private body', () => {
    const store = storage();
    const journal = new AiApplyJournal(namespace, store);
    const run = crypto.randomUUID();
    journal.prepare(run, { service: crypto.randomUUID() });
    const board = crypto.randomUUID();
    journal.saveImport(run, undefined, board);
    expect(new AiApplyJournal(namespace, store).get(run)?.newBoardId).toBe(board);
    expect(journal.get(run)?.import).toBeUndefined();
  });
});
