import {
  aiCreateRunSchema,
  aiResultForRequestSchema,
  applicationIdSchema,
  graphProjectionSchema,
  graphNodeSchema,
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  type AiCreateRun,
  type AiEditProposal,
  type GraphProjection,
  type GraphNode,
} from '@archboard/contracts';
import {
  COMMAND_ORIGINS,
  createGraphObjects,
  editGraphText,
  projectGraphDocument,
  setComponentCategory,
  setComponentExternalUrl,
  setCodeLanguage,
  validateGraphDocument,
  type GraphTextTarget,
} from '@archboard/document-model';
import * as Y from 'yjs';
import type { AiApplyJournal } from './ai-apply-intent';
import {
  AI_NODE_SIZES,
  aiLayoutInput,
  fallbackAiLayout,
  semanticOrder,
} from './ai-diagram-geometry';
import { getProjectionBounds } from '../canvas/projection-adapter';
import type { EditorSession } from '../application/editor-session';

const ADDITIVE_GAP = 80;
export interface AiEditDraft {
  readonly request: AiCreateRun;
  readonly proposal: AiEditProposal;
  readonly additions: GraphProjection;
  readonly ids: Readonly<Record<string, string>>;
}
function boundEdit(request: AiCreateRun, proposal: unknown): AiEditProposal {
  if (request.task !== 'scoped-edit') throw new Error('A reviewed scoped edit is required.');
  const valid = aiResultForRequestSchema(request).parse(proposal);
  if (valid.kind !== 'edits') throw new Error('An edit proposal is required.');
  return valid;
}
/** Compare touched fields, immutable identity and endpoint liveness, not a server sequence. */
export function validateCurrentAiEdit(draft: AiEditDraft, graph: GraphProjection): void {
  const request = aiCreateRunSchema.parse(draft.request);
  const proposal = boundEdit(request, draft.proposal);
  const reviewed = request.boardContext!.graph;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  for (const operation of proposal.operations) {
    if ('nodeId' in operation) {
      const node = nodes.get(operation.nodeId);
      const before = reviewed.nodes.find((item) => item.id === operation.nodeId);
      if (!node || !before || node.kind !== before.kind)
        throw new Error('A reviewed card was deleted or its identity changed.');
      const matches =
        operation.type === 'rename-node'
          ? node.title === operation.expectedTitle
          : 'expected' in operation
            ? JSON.stringify(node.content) === JSON.stringify(operation.expected)
            : 'body' in node.content && node.content.body === operation.expectedBody;
      if (!matches)
        throw new Error(
          'A target field changed. Reject this proposal and request a fresh reviewed edit.',
        );
    }
    if ('edgeId' in operation) {
      const edge = edges.get(operation.edgeId);
      const before = reviewed.edges.find((item) => item.id === operation.edgeId);
      if (
        !edge ||
        !before ||
        !nodes.has(edge.sourceId) ||
        !nodes.has(edge.targetId) ||
        ['sourceId', 'targetId', 'sourceHandle', 'targetHandle'].some(
          (field) => edge[field as keyof typeof edge] !== before[field as keyof typeof before],
        )
      )
        throw new Error('A reviewed connection or endpoint was deleted or replaced.');
      if (edge.label !== operation.expectedLabel || edge.protocol !== operation.expectedProtocol)
        throw new Error('A connection field changed. Request a fresh reviewed edit.');
    }
  }
  // Existing semantic bindings used by new edges must still identify live reviewed cards.
  for (const operation of proposal.operations)
    if (operation.type === 'add-edge') {
      for (const key of [operation.edge.source, operation.edge.target]) {
        const binding = request.boardContext!.nodeBindings.find((item) => item.key === key);
        if (binding) {
          const node = nodes.get(binding.nodeId);
          const before = reviewed.nodes.find((item) => item.id === binding.nodeId);
          if (!node || node.kind !== before?.kind)
            throw new Error('An addition endpoint was deleted or replaced.');
        }
      }
    }
  validateAdditions(draft);
}
function validateAdditions(draft: AiEditDraft) {
  // Addition edges may point into reviewed existing context; validate that union.
  graphProjectionSchema.parse({
    ...draft.additions,
    nodes: [...draft.request.boardContext!.graph.nodes, ...draft.additions.nodes],
  });
  const graph = draft.additions;
  if (graph.boundaries.length || graph.steps.length)
    throw new Error('Edits cannot add boundaries or presentation steps.');
  const nodes = draft.proposal.operations.flatMap((op) =>
    op.type === 'add-node' ? [op.node] : [],
  );
  const edges = draft.proposal.operations.flatMap((op) =>
    op.type === 'add-edge' ? [op.edge] : [],
  );
  const keys = [...nodes, ...edges].map((item) => item.key);
  if (
    Object.keys(draft.ids).length !== keys.length ||
    new Set(Object.values(draft.ids)).size !== keys.length
  )
    throw new Error('Addition mapping does not match the reviewed proposal.');
  for (const id of Object.values(draft.ids)) applicationIdSchema.parse(id);
  if (graph.nodes.length !== nodes.length || graph.edges.length !== edges.length)
    throw new Error('Addition batch differs from the proposal.');
  for (const { key, ...node } of nodes) {
    const mapped = graph.nodes.find((item) => item.id === draft.ids[key]);
    if (
      !mapped ||
      JSON.stringify(
        graphNodeSchema.parse({
          ...node,
          id: mapped.id,
          position: mapped.position,
          size: mapped.size,
        }),
      ) !== JSON.stringify(graphNodeSchema.parse(mapped))
    )
      throw new Error('An added card differs from the proposal.');
  }
  const bindings = new Map(
    draft.request.boardContext!.nodeBindings.map((item) => [item.key, item.nodeId]),
  );
  for (const node of nodes) bindings.set(node.key, draft.ids[node.key]!);
  for (const { key, source, target, ...edge } of edges) {
    const mapped = graph.edges.find((item) => item.id === draft.ids[key]);
    if (
      !mapped ||
      mapped.sourceId !== bindings.get(source) ||
      mapped.targetId !== bindings.get(target) ||
      Object.entries(edge).some(([field, value]) => mapped[field as keyof typeof mapped] !== value)
    )
      throw new Error('An added connection differs from the proposal.');
  }
}
/** Minimal range edits preserve unchanged Y.Text identities and concurrent inserts. */
function changeText(document: Y.Doc, target: GraphTextTarget, before: string, after: string) {
  if (before === after) return;
  const a = Array.from(before);
  const b = Array.from(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  editGraphText(document, target, {
    // Y.Text offsets are UTF-16; never split a surrogate pair while finding ranges.
    index: a.slice(0, start).join('').length,
    deleteCount: a.slice(start, a.length - end).join('').length,
    insert: b.slice(start, b.length - end).join(''),
  });
}
function mutateEdit(document: Y.Doc, draft: AiEditDraft) {
  // Structural creation retains the existing non-Undo origin. Field changes form one Undo entry.
  createGraphObjects(document, draft.additions);
  document.transact(() => {
    for (const op of draft.proposal.operations) {
      if (op.type === 'add-node' || op.type === 'add-edge') continue;
      if (op.type === 'label-edge') {
        changeText(
          document,
          { entity: 'edge', id: op.edgeId, field: 'label' },
          op.expectedLabel,
          op.label,
        );
        changeText(
          document,
          { entity: 'edge', id: op.edgeId, field: 'protocol' },
          op.expectedProtocol,
          op.protocol,
        );
      } else if (op.type === 'rename-node') {
        changeText(
          document,
          { entity: 'node', id: op.nodeId, field: 'title' },
          op.expectedTitle,
          op.title,
        );
      } else if (op.type === 'set-component-properties') {
        changeText(
          document,
          { entity: 'node', id: op.nodeId, field: 'description' },
          op.expected.description,
          op.content.description,
        );
        changeText(
          document,
          { entity: 'node', id: op.nodeId, field: 'technology' },
          op.expected.technology,
          op.content.technology,
        );
        if (op.expected.category !== op.content.category)
          setComponentCategory(document, op.nodeId, op.content.category);
        if (op.expected.externalUrl !== op.content.externalUrl)
          setComponentExternalUrl(
            document,
            op.nodeId,
            op.content.externalUrl,
            op.expected.externalUrl,
          );
      } else if (op.type === 'set-code-body') {
        changeText(
          document,
          { entity: 'node', id: op.nodeId, field: 'body' },
          op.expected.body,
          op.content.body,
        );
        if (op.expected.language !== op.content.language)
          setCodeLanguage(document, op.nodeId, op.content.language);
      } else {
        changeText(
          document,
          { entity: 'node', id: op.nodeId, field: 'body' },
          op.expectedBody,
          op.body,
        );
      }
    }
  }, COMMAND_ORIGINS.LOCAL_EDIT);
}
/** Detached full-state validation includes tombstones, capacity, schema and encoded ceilings. */
export function preflightAiEdit(
  source: Uint8Array,
  draft: AiEditDraft,
  options: { clientId?: number; updateBytes?: number; stateBytes?: number } = {},
) {
  const stateLimit = Math.min(
    options.stateBytes ?? MAX_ENCODED_YJS_STATE_BYTES,
    MAX_ENCODED_YJS_STATE_BYTES,
  );
  const updateLimit = Math.min(
    options.updateBytes ?? MAX_CLIENT_UPDATE_BYTES,
    MAX_CLIENT_UPDATE_BYTES,
  );
  if (source.byteLength > stateLimit) throw new Error('Existing state exceeds its encoded budget.');
  const candidate = new Y.Doc({ gc: false });
  const accepted = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(candidate, source);
    Y.applyUpdate(accepted, source);
    if (options.clientId !== undefined) candidate.clientID = options.clientId;
    validateGraphDocument(candidate);
    validateCurrentAiEdit(draft, projectGraphDocument(candidate));
    const vector = Y.encodeStateVector(candidate);
    mutateEdit(candidate, draft);
    validateGraphDocument(candidate, accepted);
    graphProjectionSchema.parse(projectGraphDocument(candidate));
    const updateBytes = Y.encodeStateAsUpdate(candidate, vector).byteLength;
    const stateBytes = Y.encodeStateAsUpdate(candidate).byteLength;
    if (updateBytes > updateLimit || stateBytes > stateLimit)
      throw new Error('Edit candidate exceeds its encoded budget.');
    return { updateBytes, stateBytes, graph: projectGraphDocument(candidate) };
  } finally {
    candidate.destroy();
    accepted.destroy();
  }
}
export function prepareAiEdit(
  source: Uint8Array,
  input: AiCreateRun,
  value: unknown,
  allocate: () => string = () => crypto.randomUUID(),
): AiEditDraft {
  const request = aiCreateRunSchema.parse(input);
  const proposal = boundEdit(request, value);
  const document = new Y.Doc({ gc: false });
  try {
    if (source.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
      throw new Error('Existing state exceeds its budget.');
    Y.applyUpdate(document, source);
    validateGraphDocument(document);
    const current = projectGraphDocument(document);
    const occupied = new Set(
      [...document.share.values()].flatMap((root) =>
        root instanceof Y.Map ? [...root.keys()] : [],
      ),
    );
    const nodes = proposal.operations
      .flatMap((op) => (op.type === 'add-node' ? [op.node] : []))
      .sort(semanticOrder);
    const edges = proposal.operations
      .flatMap((op) => (op.type === 'add-edge' ? [op.edge] : []))
      .sort(semanticOrder);
    const ids: Record<string, string> = {};
    for (const { key } of [...nodes, ...edges].sort(semanticOrder)) {
      const id = applicationIdSchema.parse(allocate());
      if (occupied.has(id))
        throw new Error('A fresh addition ID collides with an existing or tombstoned object.');
      occupied.add(id);
      ids[key] = id;
    }
    const positions = nodes.length
      ? fallbackAiLayout(
          aiLayoutInput({
            kind: 'diagram',
            schemaVersion: 1,
            nodes,
            edges: [],
            boundaries: [],
            steps: [],
            explanation: '',
            claims: [],
            assumptions: [],
            questions: [],
          }),
        )
      : [];
    const bounds = getProjectionBounds(current);
    const mappedNodes: GraphNode[] = nodes.map(({ key, ...node }, index) => ({
      ...node,
      id: ids[key]!,
      size: AI_NODE_SIZES[node.kind],
      position: {
        x: positions[index]!.position.x + (bounds ? bounds.x + bounds.width + ADDITIVE_GAP : 0),
        y: positions[index]!.position.y + (bounds?.y ?? 0),
      },
    }));
    const bindings = new Map(
      request.boardContext!.nodeBindings.map((item) => [item.key, item.nodeId]),
    );
    for (const node of nodes) bindings.set(node.key, ids[node.key]!);
    const additions: GraphProjection = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: mappedNodes,
      edges: edges.map(({ key, source, target, ...edge }) => ({
        ...edge,
        id: ids[key]!,
        sourceId: bindings.get(source)!,
        targetId: bindings.get(target)!,
        sourceHandle: 'right',
        targetHandle: 'left',
      })),
      boundaries: [],
      steps: [],
    };
    const draft = { request, proposal, additions, ids: Object.freeze(ids) };
    preflightAiEdit(source, draft);
    return draft;
  } finally {
    document.destroy();
  }
}
/** Caller holds the normal writer lock. Storage succeeds after preflight and before mutation. */
export function applyAiEditBatch(
  document: Y.Doc,
  draft: AiEditDraft,
  beforeMutation: () => void,
): void {
  preflightAiEdit(Y.encodeStateAsUpdate(document), draft, { clientId: document.clientID });
  beforeMutation();
  mutateEdit(document, draft);
}
export function applyReviewedAiEdit(
  session: Pick<EditorSession, 'canEdit' | 'applyAiEdits'>,
  journal: AiApplyJournal,
  runId: string,
  draft: AiEditDraft,
  allowed: () => boolean,
): void {
  if (!allowed() || !session.canEdit())
    throw new Error('Current editing authority or result validity was lost.');
  if (journal.get(runId))
    throw new Error(
      'This edit already has an Apply intent. Inspect the board; automatic replay is blocked.',
    );
  session.applyAiEdits(draft, () => journal.prepare(runId, draft.ids, 'scoped-edit'));
}
