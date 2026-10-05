import {
  GRAPH_SCHEMA_VERSION,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_CLIENT_UPDATE_BYTES,
  aiResultSchema,
  applicationIdSchema,
  graphProjectionSchema,
  pointSchema,
  type AiDiagramProposal,
  type GraphProjection,
  type Point,
} from '@archboard/contracts';
import {
  createGraphObjects,
  createPresentationStep,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import * as Y from 'yjs';
import { layoutAiDiagram } from '@/platform/layout/ai-layout';
import {
  AI_NODE_SIZES,
  aiLayoutInput,
  enclosingAiRect,
  semanticOrder,
  validateAiPositions,
  type AiLayout,
  type AiLayoutInput,
} from './ai-diagram-geometry';

export interface AiDiagramDraft {
  readonly graph: GraphProjection;
  readonly ids: Readonly<Record<string, string>>;
  readonly layout: Pick<AiLayout, 'status' | 'reason'>;
  readonly commentary: Pick<
    AiDiagramProposal,
    'explanation' | 'claims' | 'assumptions' | 'questions'
  >;
  readonly preflight: { readonly updateBytes: number; readonly stateBytes: number };
}
const HALF = 2;
function diagram(value: unknown): AiDiagramProposal {
  const proposal = aiResultSchema.parse(value);
  if (proposal.kind !== 'diagram') throw new Error('A diagram proposal is required.');
  return proposal;
}
/** Stable semantic ordering; the allocator is application-owned, never model data. */
export function mapAiDiagram(
  value: unknown,
  layout: AiLayout,
  occupied: ReadonlySet<string> = new Set(),
  allocate: () => string = () => crypto.randomUUID(),
  origin: Point = { x: 0, y: 0 },
  stepOrder = 0,
): { graph: GraphProjection; ids: Readonly<Record<string, string>> } {
  const proposal = diagram(value);
  pointSchema.parse(origin);
  const input = aiLayoutInput(proposal);
  const orderedNodes = [...proposal.nodes].sort(semanticOrder);
  const positions = new Map(
    validateAiPositions(input, layout.positions).map(({ key, position }) => [
      key,
      pointSchema.parse({ x: position.x + origin.x, y: position.y + origin.y }),
    ]),
  );
  const used = new Set(occupied);
  const ids = new Map<string, string>();
  for (const entity of [
    ...proposal.nodes,
    ...proposal.edges,
    ...proposal.boundaries,
    ...proposal.steps,
  ].sort(semanticOrder)) {
    const id = applicationIdSchema.parse(allocate());
    if (used.has(id)) throw new Error('Allocated diagram ID is already used.');
    used.add(id);
    ids.set(entity.key, id);
  }
  const nodes = orderedNodes.map(({ key, ...node }) => ({
    ...node,
    id: ids.get(key)!,
    position: positions.get(key)!,
    size: { ...AI_NODE_SIZES[node.kind] },
  }));
  // Validate node extents as well as top-left coordinates, including origin translation.
  validateAiPositions(
    input,
    nodes.map((node, index) => ({
      key: orderedNodes[index]!.key,
      position: node.position,
    })),
  );
  const byKey = new Map(orderedNodes.map((node, index) => [node.key, nodes[index]!]));
  const edges = [...proposal.edges].sort(semanticOrder).map(({ key, source, target, ...edge }) => {
    const a = byKey.get(source)!;
    const b = byKey.get(target)!;
    const dx = b.position.x + b.size.width / HALF - a.position.x - a.size.width / HALF;
    const dy = b.position.y + b.size.height / HALF - a.position.y - a.size.height / HALF;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    return {
      ...edge,
      id: ids.get(key)!,
      sourceId: a.id,
      targetId: b.id,
      sourceHandle: horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top',
      targetHandle: horizontal ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom',
    };
  });
  const edgeByKey = new Map(
    [...proposal.edges].sort(semanticOrder).map((edge, index) => [edge.key, edges[index]!]),
  );
  const boundaries = [...proposal.boundaries].sort(semanticOrder).map((boundary) => ({
    id: ids.get(boundary.key)!,
    title: boundary.title,
    color: 'gray',
    rect: enclosingAiRect(boundary.nodeKeys.map((key) => byKey.get(key)!)),
  }));
  const steps = proposal.steps.map((step, index) => {
    const referenced = new Set(step.nodeKeys);
    for (const key of step.edgeKeys) {
      const edge = proposal.edges.find((edge) => edge.key === key)!;
      referenced.add(edge.source);
      referenced.add(edge.target);
    }
    return {
      id: ids.get(step.key)!,
      title: step.title,
      notes: step.notes,
      order: stepOrder + index,
      rect: enclosingAiRect(
        referenced.size ? [...referenced].map((key) => byKey.get(key)!) : nodes,
      ),
      nodeIds: step.nodeKeys.map((key) => byKey.get(key)!.id),
      edgeIds: step.edgeKeys.map((key) => edgeByKey.get(key)!.id),
    };
  });
  return {
    graph: graphProjectionSchema.parse({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes,
      edges,
      boundaries,
      steps,
    }),
    ids: Object.freeze(Object.fromEntries(ids)),
  };
}

/** Full CRDT state, including tombstones/history, is cloned; the source is never mutated. */
export function preflightAiDiagram(
  source: Uint8Array,
  graph: GraphProjection,
  limits: { updateBytes?: number; stateBytes?: number; clientId?: number } = {},
): AiDiagramDraft['preflight'] {
  const updateLimit = Math.min(
    limits.updateBytes ?? MAX_CLIENT_UPDATE_BYTES,
    MAX_CLIENT_UPDATE_BYTES,
  );
  const stateLimit = Math.min(
    limits.stateBytes ?? MAX_ENCODED_YJS_STATE_BYTES,
    MAX_ENCODED_YJS_STATE_BYTES,
  );
  if (source.byteLength > stateLimit)
    throw new Error('Existing diagram state exceeds its byte budget.');
  const candidate = new Y.Doc({ gc: false });
  const accepted = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(candidate, source);
    Y.applyUpdate(accepted, source);
    // Apply uses the live writer's ID so variable-width CRDT IDs cannot undercount bytes.
    if (limits.clientId !== undefined) candidate.clientID = limits.clientId;
    validateGraphDocument(candidate);
    const vector = Y.encodeStateVector(candidate);
    const batch = graphProjectionSchema.parse(graph);
    createGraphObjects(candidate, batch);
    for (const step of batch.steps) createPresentationStep(candidate, step);
    validateGraphDocument(candidate, accepted);
    // Includes existing live content and capacity, not only the new proposal.
    graphProjectionSchema.parse(projectGraphDocument(candidate));
    const updateBytes = Y.encodeStateAsUpdate(candidate, vector).byteLength;
    const stateBytes = Y.encodeStateAsUpdate(candidate).byteLength;
    if (updateBytes > updateLimit || stateBytes > stateLimit)
      throw new Error('Prepared diagram exceeds its encoded byte budget.');
    return { updateBytes, stateBytes };
  } finally {
    candidate.destroy();
    accepted.destroy();
  }
}

export async function prepareAiDiagramDraft(
  value: unknown,
  source: Uint8Array,
  signal: AbortSignal,
  options: {
    allocate?: () => string;
    origin?: Point;
    layout?: (input: AiLayoutInput, signal: AbortSignal) => Promise<AiLayout>;
  } = {},
): Promise<AiDiagramDraft> {
  if (signal.aborted) throw new Error('Diagram preparation cancelled.');
  const proposal = diagram(value);
  if (source.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
    throw new Error('Existing diagram is too large.');
  const snapshot = source.slice();
  const existing = new Y.Doc({ gc: false });
  let occupied: Set<string>;
  let stepOrder: number;
  try {
    Y.applyUpdate(existing, snapshot);
    validateGraphDocument(existing);
    const projection = projectGraphDocument(existing);
    stepOrder = projection.steps.length
      ? Math.max(...projection.steps.map((step) => step.order)) + 1
      : 0;
    occupied = new Set(
      [...existing.share.values()].flatMap((root) =>
        root instanceof Y.Map ? [...root.keys()] : [],
      ),
    );
  } finally {
    existing.destroy();
  }
  const layout = await (options.layout ?? layoutAiDiagram)(aiLayoutInput(proposal), signal);
  if (signal.aborted) throw new Error('Diagram preparation cancelled.');
  const mapped = mapAiDiagram(
    proposal,
    layout,
    occupied,
    options.allocate,
    options.origin,
    stepOrder,
  );
  const preflight = preflightAiDiagram(snapshot, mapped.graph);
  return {
    ...mapped,
    layout: { status: layout.status, ...(layout.reason ? { reason: layout.reason } : {}) },
    commentary: {
      explanation: proposal.explanation,
      claims: proposal.claims,
      assumptions: proposal.assumptions,
      questions: proposal.questions,
    },
    preflight,
  };
}
