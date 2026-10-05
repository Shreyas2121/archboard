import {
  aiBoardContextSchema,
  aiCreateRunSchema,
  aiResultForRequestSchema,
  GRAPH_SCHEMA_VERSION,
  type AiCreateRun,
  type AiResult,
  type GraphProjection,
} from '@archboard/contracts';
import type { SelectionReference } from '@/features/editor/state';

export type AiGuidanceTask = 'explain-selection' | 'trace-flow';
export type AiGuidanceHistory = AiCreateRun['history'];
export const GUIDANCE_STARTERS: Readonly<Record<AiGuidanceTask, string>> = {
  'explain-selection':
    'Explain the selected components, stated responsibilities and tradeoffs. Identify missing facts and ask up to three focused questions.',
  'trace-flow':
    'Trace the declared request or event path through the selected connections. Explain direction and unknowns; ask up to three focused questions.',
};

/** Explicit selected connections include their endpoints; no graph traversal or hidden steps. */
export function selectedAiBoardContext(
  graph: GraphProjection,
  selection: readonly SelectionReference[],
) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'boundary')
      throw new Error('Select cards or connections for guidance. Boundaries are not included.');
    const found = graph[item.kind === 'node' ? 'nodes' : 'edges'].some(
      (entity) => entity.id === item.id,
    );
    if (!found) throw new Error('A selected object was deleted. Select current objects again.');
    (item.kind === 'node' ? nodes : edges).add(item.id);
  }
  for (const edge of graph.edges)
    if (edges.has(edge.id)) {
      nodes.add(edge.sourceId);
      nodes.add(edge.targetId);
    }
  if (!nodes.size)
    throw new Error('Select at least one card or connection before reviewing guidance.');
  const selectedNodes = graph.nodes
    .filter((node) => nodes.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const selectedEdges = graph.edges
    .filter((edge) => edges.has(edge.id) || (nodes.has(edge.sourceId) && nodes.has(edge.targetId)))
    .sort((a, b) => a.id.localeCompare(b.id));
  // Schema parsing copies the chosen fields. No references to the live graph survive review.
  return aiBoardContextSchema.parse({
    graph: {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: selectedNodes,
      edges: selectedEdges,
      boundaries: [],
      steps: [],
    },
    nodeBindings: selectedNodes.map((node, index) => ({
      key: `selected_${index}`,
      nodeId: node.id,
    })),
    confirmedServerSequence: null,
  });
}

export function reviewAiGuidance(
  boardId: string,
  task: AiGuidanceTask,
  prompt: string,
  graph: GraphProjection,
  selection: readonly SelectionReference[],
  history: AiGuidanceHistory,
): AiCreateRun {
  return aiCreateRunSchema.parse({
    schemaVersion: 1,
    task,
    target: { kind: 'board', boardId },
    prompt,
    boardContext: selectedAiBoardContext(graph, selection),
    history,
  });
}

export function retainAiGuidanceExchange(
  request: AiCreateRun,
  result: AiResult,
): AiGuidanceHistory {
  const validated = aiResultForRequestSchema(request).parse(result);
  if (validated.kind !== 'guidance' && validated.kind !== 'clarification')
    throw new Error('A guidance result is required.');
  // Reject the complete exchange if it will not fit; never silently summarize or truncate facts.
  return aiCreateRunSchema.parse({
    ...request,
    history: [
      ...request.history,
      { role: 'user', text: request.prompt },
      { role: 'assistant', text: JSON.stringify(validated) },
    ],
  }).history;
}

export function aiGuidanceMatchesContext(
  request: AiCreateRun,
  graph: GraphProjection,
  selection: readonly SelectionReference[],
  history: AiGuidanceHistory,
  prompt: string,
  task: AiGuidanceTask,
) {
  try {
    return (
      request.task === task &&
      request.prompt === prompt &&
      JSON.stringify(request.history) === JSON.stringify(history) &&
      JSON.stringify(request.boardContext) ===
        JSON.stringify(selectedAiBoardContext(graph, selection))
    );
  } catch {
    return false;
  }
}

export function currentAiGuidanceHighlights(
  request: AiCreateRun,
  result: AiResult,
  graph: GraphProjection,
) {
  const valid = aiResultForRequestSchema(request).parse(result);
  if (valid.kind !== 'guidance') throw new Error('This result has no guidance highlights.');
  try {
    const reviewed = request.boardContext!.graph;
    const selection: SelectionReference[] = [
      ...reviewed.nodes.map((node) => ({ kind: 'node' as const, id: node.id })),
      ...reviewed.edges.map((edge) => ({ kind: 'edge' as const, id: edge.id })),
    ];
    if (JSON.stringify(selectedAiBoardContext(graph, selection).graph) !== JSON.stringify(reviewed))
      throw new Error('Stale context');
  } catch {
    throw new Error('The reviewed graph changed. Review current context before highlighting.');
  }
  return { nodeIds: valid.highlightNodeIds, edgeIds: valid.highlightEdgeIds };
}
