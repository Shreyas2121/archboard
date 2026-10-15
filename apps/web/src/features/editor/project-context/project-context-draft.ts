import {
  applicationIdSchema,
  graphProjectionSchema,
  parseProjectContextFile,
  projectContextV1Schema,
  type GraphProjection,
  type Point,
  type ProjectContextV1,
} from '@archboard/contracts';
import { parseBoundedJson } from '@archboard/export';
import { MAX_AI_CONTEXT_FILE_BYTES } from '@archboard/contracts';
import {
  projectNodeSize,
  projectLayoutInputSchema,
  enclosingProjectRect,
  semanticOrder,
  validateProjectPositions,
  type ProjectLayoutInput,
  type ProjectLayout,
} from './project-context-layout';
import { layoutProjectDiagram } from '@/platform/layout/project-layout';
import {
  CONTEXT_CATEGORY_COLORS,
  CONTEXT_COORDINATE_DIVISOR,
  type ProjectContextDraft,
} from './project-context-policy';

/** The context already describes the graph. No model, endpoint or source execution is involved. */
export function parseProjectContext(bytes: Uint8Array): ProjectContextV1 {
  return projectContextV1Schema.parse(parseBoundedJson(bytes, MAX_AI_CONTEXT_FILE_BYTES));
}

export function projectContextLayoutInput(context: ProjectContextV1): ProjectLayoutInput {
  if (!context.components.length)
    throw new Error(
      'This file has no components to diagram. Add supported components before importing.',
    );
  const used = new Set([...context.components, ...context.groups].map(({ key }) => key));
  const freshKey = (prefix: string, index: number) => {
    let key = `${prefix}-${index}`;
    let suffix = 0;
    while (used.has(key)) key = `${prefix}-${index}-${++suffix}`;
    used.add(key);
    return key;
  };
  const groups = context.groups
    .filter((group) => group.componentKeys.length > 0)
    .sort(semanticOrder);
  return projectLayoutInputSchema.parse({
    nodes: [...context.components].sort(semanticOrder).map((component) => ({
      key: component.key,
      size: projectNodeSize('component', component.name),
    })),
    edges: context.connections.map(({ source, target }, index) => ({
      key: freshKey('context-flow', index),
      source,
      target,
    })),
    groups: groups.map((group, index) => ({
      key: freshKey('context-group', index),
      nodeKeys: [...group.componentKeys].sort(),
    })),
  });
}

export async function prepareProjectContext(
  value: unknown,
  signal: AbortSignal,
  options: {
    readonly origin?: Point;
    readonly allocate?: () => string;
    readonly layout?: (input: ProjectLayoutInput, signal: AbortSignal) => Promise<ProjectLayout>;
  } = {},
): Promise<ProjectContextDraft> {
  if (signal.aborted) throw new Error('Project import cancelled.');
  const context =
    typeof value === 'string'
      ? parseProjectContextFile(value)
      : projectContextV1Schema.parse(value);
  const input = projectContextLayoutInput(context);
  const layout = await (options.layout ?? layoutProjectDiagram)(input, signal);
  if (signal.aborted) throw new Error('Project import cancelled.');
  const origin = options.origin ?? { x: 0, y: 0 };
  const positions = validateProjectPositions(input, layout.positions).map(({ key, position }) => ({
    key,
    position: { x: position.x + origin.x, y: position.y + origin.y },
  }));
  validateProjectPositions(input, positions);
  const byKey = new Map(positions.map(({ key, position }) => [key, position]));
  const sizes = new Map(input.nodes.map(({ key, size }) => [key, size]));
  const usedIds = new Set<string>();
  const allocate = () => {
    const id = applicationIdSchema.parse(
      options.allocate ? options.allocate() : crypto.randomUUID(),
    );
    if (usedIds.has(id))
      throw new Error('The import ID allocator returned a duplicate ID. Prepare the file again.');
    usedIds.add(id);
    return id;
  };
  const nodes = [...context.components].sort(semanticOrder).map((component) => ({
    id: allocate(),
    kind: 'component' as const,
    title: component.name,
    color: CONTEXT_CATEGORY_COLORS[component.category],
    position: byKey.get(component.key)!,
    size: sizes.get(component.key)!,
    content: {
      category: component.category,
      technology: component.technology,
      description: component.description,
      externalUrl: null,
    },
  }));
  const nodeByKey = new Map(
    [...context.components].sort(semanticOrder).map(({ key }, index) => [key, nodes[index]!]),
  );
  const edges = context.connections.map((connection) => {
    const source = nodeByKey.get(connection.source)!;
    const target = nodeByKey.get(connection.target)!;
    const dx =
      target.position.x +
      target.size.width / CONTEXT_COORDINATE_DIVISOR -
      source.position.x -
      source.size.width / CONTEXT_COORDINATE_DIVISOR;
    const dy =
      target.position.y +
      target.size.height / CONTEXT_COORDINATE_DIVISOR -
      source.position.y -
      source.size.height / CONTEXT_COORDINATE_DIVISOR;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    return {
      id: allocate(),
      sourceId: source.id,
      targetId: target.id,
      sourceHandle: horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top',
      targetHandle: horizontal ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom',
      label: connection.label,
      protocol: connection.protocol,
      direction: 'forward',
      style: 'solid',
    };
  });
  const boundaries = context.groups
    .filter((group) => group.componentKeys.length > 0)
    .sort(semanticOrder)
    .map((group) => ({
      id: allocate(),
      title: group.title,
      color: 'gray',
      rect: enclosingProjectRect(group.componentKeys.map((key) => nodeByKey.get(key)!)),
    }));
  const graph: GraphProjection = graphProjectionSchema.parse({
    schemaVersion: 1,
    nodes,
    edges,
    boundaries,
    steps: [],
  });
  return {
    context,
    graph,
    layout: { status: layout.status, ...(layout.reason ? { reason: layout.reason } : {}) },
  };
}
