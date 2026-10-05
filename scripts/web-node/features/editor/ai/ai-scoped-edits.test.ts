import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  GRAPH_SCHEMA_VERSION,
  aiResultForRequestSchema,
  type AiEditProposal,
  type AiOperation,
  type GraphNode,
} from '@archboard/contracts';
import {
  createGraphDocument,
  createGraphObjects,
  projectGraphDocument,
  editGraphText,
  setNodeColor,
  moveNode,
  tombstoneNode,
  createLocalUndoManager,
  applyRemoteUpdate,
  accessGraphText,
} from '@archboard/document-model';
import {
  prepareAiEdit,
  preflightAiEdit,
  applyAiEditBatch,
  applyReviewedAiEdit,
  validateCurrentAiEdit,
} from '@/features/editor/ai/ai-scoped-edits';
import { reviewAiGuidance, retainAiGuidanceExchange } from '@/features/editor/ai/ai-guidance-model';
import { AiApplyJournal } from '@/features/editor/ai/ai-apply-intent';

const TWO = 2;
const MINIMUM_BYTE_LIMIT = 1;
const MAX_CLIENT_ID = 4_294_967_295;
const geometry = { position: { x: 0, y: 0 }, size: { width: 320, height: 180 } };
function fixture() {
  const document = createGraphDocument();
  const nodes: GraphNode[] = [
    {
      id: crypto.randomUUID(),
      kind: 'component',
      title: 'API',
      color: 'blue',
      ...geometry,
      content: {
        category: 'service',
        technology: 'Node',
        description: 'Reviewed',
        externalUrl: null,
      },
    },
    {
      id: crypto.randomUUID(),
      kind: 'code',
      title: 'Code',
      color: 'gray',
      ...geometry,
      content: { language: 'typescript', body: 'const value = 1;' },
    },
    {
      id: crypto.randomUUID(),
      kind: 'schema',
      title: 'Schema',
      color: 'gray',
      ...geometry,
      content: { body: 'type User' },
    },
    {
      id: crypto.randomUUID(),
      kind: 'note',
      title: 'Note',
      color: 'gray',
      ...geometry,
      content: { body: 'Original note' },
    },
  ];
  const edge = {
    id: crypto.randomUUID(),
    sourceId: nodes[0]!.id,
    targetId: nodes[1]!.id,
    sourceHandle: 'right' as const,
    targetHandle: 'left' as const,
    label: 'request',
    protocol: 'HTTPS',
    direction: 'forward' as const,
    style: 'solid' as const,
  };
  createGraphObjects(document, { nodes, edges: [edge] });
  const graph = projectGraphDocument(document);
  const request = reviewAiGuidance(
    crypto.randomUUID(),
    'scoped-edit',
    'Improve reviewed architecture',
    graph,
    nodes.map((node) => ({ kind: 'node', id: node.id })),
    [{ role: 'assistant', text: 'Prior proposals are not authority' }],
  );
  const proposal = (operations: AiOperation[]): AiEditProposal => ({
    kind: 'edits',
    schemaVersion: 1,
    operations,
    explanation: 'Proposed scoped changes',
    claims: [],
    assumptions: [],
    questions: [],
  });
  const rename: AiOperation = {
    type: 'rename-node',
    nodeId: nodes[0]!.id,
    expectedTitle: 'API',
    title: 'API gateway',
  };
  const additions: AiOperation[] = [
    {
      type: 'add-node',
      node: {
        key: 'queue',
        kind: 'note',
        title: 'Proposed queue',
        color: 'blue',
        content: { body: 'Hypothesis' },
      },
    },
    {
      type: 'add-edge',
      edge: {
        key: 'enqueue',
        source: request.boardContext!.nodeBindings.find((item) => item.nodeId === nodes[0]!.id)!
          .key,
        target: 'queue',
        label: 'event',
        protocol: 'AMQP',
        direction: 'forward',
        style: 'dashed',
      },
    },
  ];
  return { document, graph, nodes, edge, request, proposal, rename, additions };
}
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
}
describe('reviewed scoped edits and collaboration boundaries', () => {
  it('keeps supplementary Unicode intact when a proposed replacement shares surrogate prefixes', () => {
    const f = fixture();
    const target = { entity: 'node' as const, id: f.nodes[0]!.id, field: 'title' as const };
    const before = '\u{1F600} service';
    const after = '\u{1F601} service';
    editGraphText(f.document, target, { index: 0, deleteCount: 'API'.length, insert: before });
    const graph = projectGraphDocument(f.document);
    const request = reviewAiGuidance(
      f.request.target.kind === 'board' ? f.request.target.boardId : '',
      'scoped-edit',
      'Rename this card',
      graph,
      [{ kind: 'node', id: target.id }],
      [],
    );
    const draft = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      request,
      f.proposal([{ type: 'rename-node', nodeId: target.id, expectedTitle: before, title: after }]),
    );
    applyAiEditBatch(f.document, draft, () => undefined);
    const replica = createGraphDocument();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(f.document));
    expect(accessGraphText(replica, target).value).toBe(after);
    replica.destroy();
    f.document.destroy();
  });
  it('validates a full detached candidate, preserves source and uses application-owned stable additions', () => {
    const f = fixture();
    const source = Y.encodeStateAsUpdate(f.document);
    const draft = prepareAiEdit(source, f.request, f.proposal([f.rename, ...f.additions]));
    const candidate = preflightAiEdit(source, draft);
    expect(Y.encodeStateAsUpdate(f.document)).toEqual(source);
    expect(candidate.graph.nodes.find((node) => node.id === f.nodes[0]!.id)?.title).toBe(
      'API gateway',
    );
    expect(candidate.graph.nodes).toHaveLength(f.nodes.length + 1);
    expect(candidate.graph.edges.find((edge) => edge.id === draft.ids.enqueue)).toMatchObject({
      sourceId: f.nodes[0]!.id,
      targetId: draft.ids.queue,
    });
    expect(Object.keys(draft.ids).sort()).toEqual(['enqueue', 'queue']);
    applyAiEditBatch(f.document, draft, () => undefined);
    expect(projectGraphDocument(f.document)).toEqual(candidate.graph);
    f.document.destroy();
  });
  it('applies all allowed typed content, rename and connection text commands and groups field Undo', () => {
    const f = fixture();
    const component = f.nodes[0]!;
    const code = f.nodes[1]!;
    if (component.kind !== 'component' || code.kind !== 'code')
      throw new Error('Typed fixture required');
    const proposal = f.proposal([
      f.rename,
      {
        type: 'set-component-properties',
        nodeId: component.id,
        expected: component.content,
        content: {
          ...component.content,
          category: 'database',
          technology: 'Postgres',
          description: 'Proposed data service',
          externalUrl: 'https://example.test',
        },
      },
      {
        type: 'set-code-body',
        nodeId: code.id,
        expected: code.content,
        content: { ...code.content, language: 'javascript', body: 'const value = 2;' },
      },
      {
        type: 'set-schema-body',
        nodeId: f.nodes[2]!.id,
        expectedBody: 'type User',
        body: 'type Account',
      },
      {
        type: 'set-note-body',
        nodeId: f.nodes[3]!.id,
        expectedBody: 'Original note',
        body: 'Proposed note',
      },
      {
        type: 'label-edge',
        edgeId: f.edge.id,
        expectedLabel: 'request',
        expectedProtocol: 'HTTPS',
        label: 'queries',
        protocol: 'SQL',
      },
    ]);
    const draft = prepareAiEdit(Y.encodeStateAsUpdate(f.document), f.request, proposal);
    const undo = createLocalUndoManager(f.document);
    const title = accessGraphText(f.document, {
      entity: 'node',
      id: component.id,
      field: 'title',
    });
    applyAiEditBatch(f.document, draft, () => undefined);
    expect(title.value).toBe('API gateway');
    expect(undo.undoStack).toHaveLength(1);
    expect(
      projectGraphDocument(f.document).nodes.find((node) => node.id === f.nodes[0]!.id),
    ).toMatchObject({
      title: 'API gateway',
      content: { technology: 'Postgres' },
    });
    undo.undo();
    expect(projectGraphDocument(f.document)).toEqual(f.graph);
    undo.redo();
    expect(projectGraphDocument(f.document).edges[0]?.label).toBe('queries');
    undo.destroy();
    f.document.destroy();
  });
  it('preserves structural additions outside Undo while field changes use normal Undo', () => {
    const f = fixture();
    const undo = createLocalUndoManager(f.document);
    const draft = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      f.request,
      f.proposal([f.rename, ...f.additions]),
    );
    applyAiEditBatch(f.document, draft, () => undefined);
    undo.undo();
    expect(
      projectGraphDocument(f.document).nodes.find((node) => node.id === f.nodes[0]!.id)?.title,
    ).toBe('API');
    expect(projectGraphDocument(f.document).nodes.some((node) => node.id === draft.ids.queue)).toBe(
      true,
    );
    undo.destroy();
    f.document.destroy();
  });
  it('rejects received collaborator edits to touched fields without any partial mutation', () => {
    const f = fixture();
    const source = Y.encodeStateAsUpdate(f.document);
    const draft = prepareAiEdit(source, f.request, f.proposal([...f.additions, f.rename]));
    const remote = createGraphDocument();
    Y.applyUpdate(remote, source);
    editGraphText(
      remote,
      { entity: 'node', id: f.nodes[0]!.id, field: 'title' },
      { index: 0, deleteCount: 0, insert: 'Collaborator ' },
    );
    applyRemoteUpdate(f.document, Y.encodeStateAsUpdate(remote));
    const changed = Y.encodeStateAsUpdate(f.document);
    const commit = vi.fn();
    expect(() => applyAiEditBatch(f.document, draft, commit)).toThrow(/field changed/);
    expect(commit).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(f.document)).toEqual(changed);
    remote.destroy();
    f.document.destroy();
  });
  it('rejects unsynchronized local body changes, tombstones and deleted addition endpoints', () => {
    const f = fixture();
    const draft = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      f.request,
      f.proposal([
        {
          type: 'set-note-body',
          nodeId: f.nodes[3]!.id,
          expectedBody: 'Original note',
          body: 'Proposal',
        },
      ]),
    );
    editGraphText(
      f.document,
      { entity: 'node', id: f.nodes[3]!.id, field: 'body' },
      { index: 0, deleteCount: 0, insert: 'local ' },
    );
    expect(() => applyAiEditBatch(f.document, draft, () => undefined)).toThrow(/field changed/);
    const addition = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      f.request,
      f.proposal(f.additions),
    );
    const rename = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      f.request,
      f.proposal([f.rename]),
    );
    tombstoneNode(f.document, f.nodes[0]!.id);
    const before = Y.encodeStateAsUpdate(f.document);
    expect(() => applyAiEditBatch(f.document, addition, () => undefined)).toThrow(
      /endpoint.*deleted/,
    );
    expect(() => applyAiEditBatch(f.document, rename, () => undefined)).toThrow(/deleted/);
    expect(Y.encodeStateAsUpdate(f.document)).toEqual(before);
    f.document.destroy();
  });
  it('accepts unrelated received geometry/color/body changes and preserves them', () => {
    const f = fixture();
    const draft = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      f.request,
      f.proposal([f.rename]),
    );
    moveNode(f.document, f.nodes[0]!.id, { x: 90, y: 80 });
    setNodeColor(f.document, f.nodes[0]!.id, 'red');
    editGraphText(
      f.document,
      { entity: 'node', id: f.nodes[3]!.id, field: 'body' },
      { index: 0, deleteCount: 0, insert: 'Unrelated ' },
    );
    validateCurrentAiEdit(draft, projectGraphDocument(f.document));
    applyAiEditBatch(f.document, draft, () => undefined);
    expect(
      projectGraphDocument(f.document).nodes.find((node) => node.id === f.nodes[0]!.id),
    ).toMatchObject({
      title: 'API gateway',
      color: 'red',
      position: { x: 90, y: 80 },
    });
    expect(
      projectGraphDocument(f.document).nodes.find((node) => node.id === f.nodes[3]!.id),
    ).toMatchObject({
      content: { body: 'Unrelated Original note' },
    });
    f.document.destroy();
  });
  it('converges concurrent inserts without erasing the collaborator and Undo leaves that insert intact', () => {
    const f = fixture();
    const source = Y.encodeStateAsUpdate(f.document);
    const remote = createGraphDocument();
    Y.applyUpdate(remote, source);
    const draft = prepareAiEdit(source, f.request, f.proposal([f.rename]));
    const undo = createLocalUndoManager(f.document);
    editGraphText(
      remote,
      { entity: 'node', id: f.nodes[0]!.id, field: 'title' },
      { index: 0, deleteCount: 0, insert: 'Remote ' },
    );
    applyAiEditBatch(f.document, draft, () => undefined);
    applyRemoteUpdate(f.document, Y.encodeStateAsUpdate(remote));
    applyRemoteUpdate(remote, Y.encodeStateAsUpdate(f.document));
    expect(projectGraphDocument(f.document)).toEqual(projectGraphDocument(remote));
    expect(
      projectGraphDocument(f.document).nodes.find((node) => node.id === f.nodes[0]!.id)?.title,
    ).toBe('Remote API gateway');
    undo.undo();
    expect(
      projectGraphDocument(f.document).nodes.find((node) => node.id === f.nodes[0]!.id)?.title,
    ).toBe('Remote API');
    undo.destroy();
    remote.destroy();
    f.document.destroy();
  });
  it('rejects unsupported operations, forged old values and duplicate field writes at the contract boundary', () => {
    const f = fixture();
    const validator = aiResultForRequestSchema(f.request);
    for (const operations of [
      [f.rename, f.rename],
      [{ ...f.rename, expectedTitle: 'Forged' }],
      [{ type: 'delete-node', nodeId: f.nodes[0]!.id }],
      [{ ...f.rename, patch: { kind: 'code' } }],
    ])
      expect(validator.safeParse({ ...f.proposal([f.rename]), operations }).success).toBe(false);
    f.document.destroy();
  });
  it('rejects a malformed complete candidate, self-loop and tombstone ID collisions before writing', () => {
    const f = fixture();
    const source = Y.encodeStateAsUpdate(f.document);
    const draft = prepareAiEdit(source, f.request, f.proposal([...f.additions, f.rename]));
    const altered = {
      ...draft,
      additions: {
        ...draft.additions,
        nodes: draft.additions.nodes.map((node) => ({ ...node, title: 'Forged addition' })),
      },
    };
    const commit = vi.fn();
    expect(() => applyAiEditBatch(f.document, altered, commit)).toThrow(/differs/);
    const edge = f.additions[1]!;
    if (edge.type !== 'add-edge') throw new Error('Edge fixture required');
    expect(() =>
      prepareAiEdit(
        source,
        f.request,
        f.proposal([{ type: 'add-edge', edge: { ...edge.edge, target: edge.edge.source } }]),
      ),
    ).toThrow();
    tombstoneNode(f.document, f.nodes[3]!.id);
    expect(() =>
      prepareAiEdit(
        Y.encodeStateAsUpdate(f.document),
        f.request,
        f.proposal([f.additions[0]!]),
        () => f.nodes[3]!.id,
      ),
    ).toThrow(/tombstoned/);
    expect(commit).not.toHaveBeenCalled();
    f.document.destroy();
  });
  it('rejects encoded limits and matches final writer-client byte sizing', () => {
    const f = fixture();
    f.document.clientID = MAX_CLIENT_ID;
    const source = Y.encodeStateAsUpdate(f.document);
    const vector = Y.encodeStateVector(f.document);
    const draft = prepareAiEdit(source, f.request, f.proposal([f.rename, ...f.additions]));
    expect(() => preflightAiEdit(source, draft, { updateBytes: MINIMUM_BYTE_LIMIT })).toThrow(
      /budget/,
    );
    expect(() => preflightAiEdit(source, draft, { stateBytes: MINIMUM_BYTE_LIMIT })).toThrow(
      /budget/,
    );
    const candidate = preflightAiEdit(source, draft, { clientId: f.document.clientID });
    applyAiEditBatch(f.document, draft, () => undefined);
    expect(Y.encodeStateAsUpdate(f.document, vector).byteLength).toBe(candidate.updateBytes);
    f.document.destroy();
  });
  it('blocks duplicate Apply, reload and Undo replay; journal scope and storage failures fence mutation', () => {
    const f = fixture();
    const draft = prepareAiEdit(
      Y.encodeStateAsUpdate(f.document),
      f.request,
      f.proposal([f.rename]),
    );
    const storage = memoryStorage();
    const namespace = {
      deploymentOrigin: 'https://example.test',
      userId: 'actor',
      boardId: crypto.randomUUID(),
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    };
    const journal = new AiApplyJournal(namespace, storage);
    const runId = crypto.randomUUID();
    const session = {
      canEdit: () => true,
      applyAiEdits: (value: typeof draft, beforeMutation: () => void) =>
        applyAiEditBatch(f.document, value, beforeMutation),
    };
    const before = Y.encodeStateAsUpdate(f.document);
    expect(() => applyReviewedAiEdit(session, journal, runId, draft, () => false)).toThrow(
      /authority/,
    );
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('Storage quota');
    });
    expect(() => applyReviewedAiEdit(session, journal, runId, draft, () => true)).toThrow(/quota/);
    expect(Y.encodeStateAsUpdate(f.document)).toEqual(before);
    const undo = createLocalUndoManager(f.document);
    applyReviewedAiEdit(session, journal, runId, draft, () => true);
    expect(journal.get(runId)?.kind).toBe('scoped-edit');
    const reload = new AiApplyJournal(namespace, storage);
    expect(() => applyReviewedAiEdit(session, reload, runId, draft, () => true)).toThrow(/replay/);
    undo.undo();
    expect(
      accessGraphText(f.document, { entity: 'node', id: f.nodes[0]!.id, field: 'title' }).value,
    ).toBe('API');
    expect(() => applyReviewedAiEdit(session, reload, runId, draft, () => true)).toThrow(/replay/);
    expect(
      new AiApplyJournal({ ...namespace, userId: 'other-actor' }, storage).get(runId),
    ).toBeUndefined();
    expect(storage.values.size).toBe(1);
    undo.destroy();
    f.document.destroy();
  });
  it('retains edit text as exact private follow-up data without implying Apply', () => {
    const f = fixture();
    const proposal = f.proposal([f.rename]);
    const history = retainAiGuidanceExchange(f.request, proposal);
    expect(history).toHaveLength(f.request.history.length + TWO);
    expect(history.at(-1)).toEqual({ role: 'assistant', text: JSON.stringify(proposal) });
    expect(projectGraphDocument(f.document)).toEqual(f.graph);
    f.document.destroy();
  });
});
