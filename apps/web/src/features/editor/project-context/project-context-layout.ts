import { z } from 'zod';
import {
  MAX_AI_CONTEXT_COMPONENTS,
  MAX_AI_CONTEXT_CONNECTIONS,
  MAX_AI_CONTEXT_GROUPS,
  MAX_GRAPH_COORDINATE,
  nodeSizeSchema,
  pointSchema,
  rectSchema,
  aiSemanticKeySchema,
  type GraphNode,
  type Rect,
} from '@archboard/contracts';

export const PROJECT_LAYOUT_TIMEOUT_MS = 5_000;
export const PROJECT_LAYOUT_PADDING = 40;
const FALLBACK_COLUMNS = 4;
const NODE_GAP = 100;
const TITLE_CHARACTER_WIDTH = 7;
const CARD_TITLE_OVERHEAD = 64;
const MAX_COMPONENT_WIDTH = 460;

export const PROJECT_NODE_SIZES: Record<GraphNode['kind'], GraphNode['size']> = {
  component: { width: 360, height: 180 },
  code: { width: 400, height: 260 },
  schema: { width: 400, height: 240 },
  note: { width: 280, height: 180 },
};
export function projectNodeSize(kind: GraphNode['kind'], title: string): GraphNode['size'] {
  return {
    ...PROJECT_NODE_SIZES[kind],
    ...(kind === 'component'
      ? {
          width: Math.min(
            MAX_COMPONENT_WIDTH,
            Math.max(
              PROJECT_NODE_SIZES.component.width,
              title.length * TITLE_CHARACTER_WIDTH + CARD_TITLE_OVERHEAD,
            ),
          ),
        }
      : {}),
  };
}
const key = aiSemanticKeySchema;
export const projectLayoutInputSchema = z
  .strictObject({
    nodes: z
      .array(z.strictObject({ key, size: nodeSizeSchema }))
      .min(1)
      .max(MAX_AI_CONTEXT_COMPONENTS),
    edges: z
      .array(z.strictObject({ key, source: key, target: key }))
      .max(MAX_AI_CONTEXT_CONNECTIONS),
    groups: z
      .array(
        z.strictObject({
          key,
          nodeKeys: z.array(key).min(1).max(MAX_AI_CONTEXT_COMPONENTS),
        }),
      )
      .max(MAX_AI_CONTEXT_GROUPS)
      .optional(),
  })
  .superRefine((input, context) => {
    const nodes = new Set(input.nodes.map((node) => node.key));
    const edges = new Set(input.edges.map((edge) => edge.key));
    if (nodes.size !== input.nodes.length || edges.size !== input.edges.length)
      context.addIssue({ code: 'custom', message: 'Layout keys must be unique.' });
    for (const edge of input.edges)
      if (!nodes.has(edge.source) || !nodes.has(edge.target) || edge.source === edge.target)
        context.addIssue({ code: 'custom', message: 'Invalid layout edge.' });
    const groups = input.groups ?? [];
    if (new Set(groups.map((group) => group.key)).size !== groups.length)
      context.addIssue({ code: 'custom', message: 'Layout group keys must be unique.' });
    for (const group of groups)
      if (
        nodes.has(group.key) ||
        new Set(group.nodeKeys).size !== group.nodeKeys.length ||
        group.nodeKeys.some((key) => !nodes.has(key))
      )
        context.addIssue({ code: 'custom', message: 'Invalid layout group.' });
  });
export const projectLayoutPositionsSchema = z
  .array(z.strictObject({ key, position: pointSchema }))
  .min(1)
  .max(MAX_AI_CONTEXT_COMPONENTS);
export type ProjectLayoutInput = z.infer<typeof projectLayoutInputSchema>;
export type ProjectLayoutPositions = z.infer<typeof projectLayoutPositionsSchema>;
export type ProjectLayout = {
  positions: ProjectLayoutPositions;
  status: 'layered' | 'fallback';
  reason?: 'unavailable' | 'timeout' | 'invalid' | 'failed';
};
export const semanticOrder = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/** Compound layout requires one parent; overlapping semantic boundaries stay visual only. */
export function projectLayoutGroups(input: ProjectLayoutInput) {
  const assigned = new Set<string>();
  return [...(input.groups ?? [])].sort(semanticOrder).filter((group) => {
    if (group.nodeKeys.some((key) => assigned.has(key))) return false;
    group.nodeKeys.forEach((key) => assigned.add(key));
    return true;
  });
}
export function validateProjectPositions(
  input: ProjectLayoutInput,
  value: unknown,
): ProjectLayoutPositions {
  const positions = projectLayoutPositionsSchema.parse(value);
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
  enclosingProjectRect(
    input.nodes.map((node) => ({ position: found.get(node.key)!, size: node.size })),
  );
  return positions.sort(semanticOrder);
}
export function fallbackProjectLayout(input: ProjectLayoutInput): ProjectLayoutPositions {
  const nodes = [...input.nodes].sort(semanticOrder);
  const columns = Math.min(FALLBACK_COLUMNS, Math.ceil(Math.sqrt(nodes.length)));
  const width = Math.max(...nodes.map((node) => node.size.width)) + NODE_GAP;
  const height = Math.max(...nodes.map((node) => node.size.height)) + NODE_GAP;
  const groups = projectLayoutGroups(input);
  if (groups.length) {
    const grouped = new Set(groups.flatMap((group) => group.nodeKeys));
    const partitions = [
      ...groups.map((group) => nodes.filter((node) => group.nodeKeys.includes(node.key))),
      nodes.filter((node) => !grouped.has(node.key)),
    ];
    let row = 0;
    return partitions.flatMap((partition) => {
      const positions = partition.map((node, index) => ({
        key: node.key,
        position: {
          x: (index % columns) * width + PROJECT_LAYOUT_PADDING,
          y: (row + Math.floor(index / columns)) * height + PROJECT_LAYOUT_PADDING,
        },
      }));
      row += Math.ceil(partition.length / columns);
      return positions;
    });
  }
  return nodes.map((node, index) => ({
    key: node.key,
    position: {
      x: (index % columns) * width + PROJECT_LAYOUT_PADDING,
      y: Math.floor(index / columns) * height + PROJECT_LAYOUT_PADDING,
    },
  }));
}
export function enclosingProjectRect(nodes: readonly Pick<GraphNode, 'position' | 'size'>[]): Rect {
  if (!nodes.length) throw new Error('Cannot enclose an empty diagram.');
  const x = Math.min(...nodes.map((node) => node.position.x)) - PROJECT_LAYOUT_PADDING;
  const y = Math.min(...nodes.map((node) => node.position.y)) - PROJECT_LAYOUT_PADDING;
  const right =
    Math.max(...nodes.map((node) => node.position.x + node.size.width)) + PROJECT_LAYOUT_PADDING;
  const bottom =
    Math.max(...nodes.map((node) => node.position.y + node.size.height)) + PROJECT_LAYOUT_PADDING;
  pointSchema.parse({ x: right, y: bottom });
  return rectSchema.parse({ x, y, width: right - x, height: bottom - y });
}
