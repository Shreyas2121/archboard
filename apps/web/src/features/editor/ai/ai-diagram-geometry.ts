import { z } from 'zod';
import {
  MAX_AI_OUTPUT_NODES,
  MAX_AI_OUTPUT_EDGES,
  MAX_GRAPH_COORDINATE,
  nodeSizeSchema,
  pointSchema,
  rectSchema,
  aiSemanticKeySchema,
  type AiDiagramProposal,
  type GraphNode,
  type Rect,
} from '@archboard/contracts';

export const AI_LAYOUT_TIMEOUT_MS = 5_000;
export const AI_LAYOUT_PADDING = 40;
const FALLBACK_COLUMNS = 4;
const NODE_GAP = 100;
export const AI_NODE_SIZES: Record<GraphNode['kind'], GraphNode['size']> = {
  component: { width: 300, height: 160 },
  code: { width: 400, height: 260 },
  schema: { width: 400, height: 240 },
  note: { width: 280, height: 180 },
};
const key = aiSemanticKeySchema;
export const aiLayoutInputSchema = z
  .strictObject({
    nodes: z
      .array(z.strictObject({ key, size: nodeSizeSchema }))
      .min(1)
      .max(MAX_AI_OUTPUT_NODES),
    edges: z.array(z.strictObject({ key, source: key, target: key })).max(MAX_AI_OUTPUT_EDGES),
  })
  .superRefine((input, context) => {
    const nodes = new Set(input.nodes.map((node) => node.key));
    const edges = new Set(input.edges.map((edge) => edge.key));
    if (nodes.size !== input.nodes.length || edges.size !== input.edges.length)
      context.addIssue({ code: 'custom', message: 'Layout keys must be unique.' });
    for (const edge of input.edges)
      if (!nodes.has(edge.source) || !nodes.has(edge.target) || edge.source === edge.target)
        context.addIssue({ code: 'custom', message: 'Invalid layout edge.' });
  });
export const aiLayoutPositionsSchema = z
  .array(z.strictObject({ key, position: pointSchema }))
  .min(1)
  .max(MAX_AI_OUTPUT_NODES);
export type AiLayoutInput = z.infer<typeof aiLayoutInputSchema>;
export type AiLayoutPositions = z.infer<typeof aiLayoutPositionsSchema>;
export type AiLayout = {
  positions: AiLayoutPositions;
  status: 'layered' | 'fallback';
  reason?: 'unavailable' | 'timeout' | 'invalid' | 'failed';
};
export const semanticOrder = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/** Content, titles, prompts, evidence and UUIDs never cross the layout boundary. */
export function aiLayoutInput(proposal: AiDiagramProposal): AiLayoutInput {
  return aiLayoutInputSchema.parse({
    nodes: [...proposal.nodes]
      .sort(semanticOrder)
      .map(({ key, kind }) => ({ key, size: AI_NODE_SIZES[kind] })),
    edges: [...proposal.edges]
      .sort(semanticOrder)
      .map(({ key, source, target }) => ({ key, source, target })),
  });
}
export function validateAiPositions(input: AiLayoutInput, value: unknown): AiLayoutPositions {
  const positions = aiLayoutPositionsSchema.parse(value);
  const found = new Map(positions.map((entry) => [entry.key, entry.position]));
  if (positions.length !== input.nodes.length || found.size !== positions.length)
    throw new Error('Layout did not preserve all nodes.');
  for (const node of input.nodes) {
    const position = found.get(node.key);
    if (
      !position ||
      Math.abs(position.x + node.size.width) > MAX_GRAPH_COORDINATE ||
      Math.abs(position.y + node.size.height) > MAX_GRAPH_COORDINATE
    )
      throw new Error('Layout geometry is out of bounds.');
  }
  // Overlapping nodes are not a useful successful layout.
  for (let i = 0; i < input.nodes.length; i++) {
    const a = input.nodes[i]!;
    const p = found.get(a.key)!;
    for (const b of input.nodes.slice(i + 1)) {
      const q = found.get(b.key)!;
      if (
        p.x < q.x + b.size.width &&
        p.x + a.size.width > q.x &&
        p.y < q.y + b.size.height &&
        p.y + a.size.height > q.y
      )
        throw new Error('Layout nodes overlap.');
    }
  }
  enclosingAiRect(input.nodes.map((node) => ({ position: found.get(node.key)!, size: node.size })));
  return positions.sort(semanticOrder);
}
export function fallbackAiLayout(input: AiLayoutInput): AiLayoutPositions {
  const nodes = [...input.nodes].sort(semanticOrder);
  const columns = Math.min(FALLBACK_COLUMNS, Math.ceil(Math.sqrt(nodes.length)));
  const width = Math.max(...nodes.map((node) => node.size.width)) + NODE_GAP;
  const height = Math.max(...nodes.map((node) => node.size.height)) + NODE_GAP;
  return nodes.map((node, index) => ({
    key: node.key,
    position: {
      x: (index % columns) * width + AI_LAYOUT_PADDING,
      y: Math.floor(index / columns) * height + AI_LAYOUT_PADDING,
    },
  }));
}
export function enclosingAiRect(nodes: readonly Pick<GraphNode, 'position' | 'size'>[]): Rect {
  if (!nodes.length) throw new Error('Cannot enclose an empty diagram.');
  const x = Math.min(...nodes.map((node) => node.position.x)) - AI_LAYOUT_PADDING;
  const y = Math.min(...nodes.map((node) => node.position.y)) - AI_LAYOUT_PADDING;
  const right =
    Math.max(...nodes.map((node) => node.position.x + node.size.width)) + AI_LAYOUT_PADDING;
  const bottom =
    Math.max(...nodes.map((node) => node.position.y + node.size.height)) + AI_LAYOUT_PADDING;
  pointSchema.parse({ x: right, y: bottom });
  return rectSchema.parse({ x, y, width: right - x, height: bottom - y });
}
