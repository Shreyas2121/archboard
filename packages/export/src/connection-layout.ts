import type { GraphNode, GraphProjection, Handle, Point, Rect } from '@archboard/contracts';
import { TEXT_CELL_WIDTH, TEXT_LINE_HEIGHT } from './image-layout.js';

const HALF = 2;
const CLEARANCE = 16;
const LEAD = 32;
const MIN_LEAD = 4;
const LANE_GAP = 12;
const LANES = 5;
const BEND_COST = 24;
const MAX_SEARCH_STEPS = 4_096;
const MAX_ROUTED_NODES = 80;
const MAX_ROUTED_EDGES = 200;
export const CONNECTION_LABEL_INSET = 8;
const LABEL_INSET = CONNECTION_LABEL_INSET;
const LABEL_WIDTH = 192;
const LABEL_LINES = 2;
const LABEL_MIDDLE = 0.5;
const LABEL_QUARTER = 0.25;
const LABEL_THREE_QUARTERS = 0.75;
const LABEL_FRACTIONS = [LABEL_MIDDLE, LABEL_QUARTER, LABEL_THREE_QUARTERS] as const;

export interface ConnectionLayout {
  readonly points: readonly Point[];
  readonly routed: boolean;
  readonly label: { readonly rect: Rect; readonly lines: readonly string[] } | null;
}

export function connectionEndpoint(node: GraphNode, handle: Handle): Point {
  const { x, y } = node.position;
  const { width, height } = node.size;
  switch (handle) {
    case 'top':
      return { x: x + width / HALF, y };
    case 'right':
      return { x: x + width, y: y + height / HALF };
    case 'bottom':
      return { x: x + width / HALF, y: y + height };
    case 'left':
      return { x, y: y + height / HALF };
  }
}
function lead(point: Point, handle: Handle, length: number): Point {
  return {
    x: point.x + (handle === 'right' ? length : handle === 'left' ? -length : 0),
    y: point.y + (handle === 'bottom' ? length : handle === 'top' ? -length : 0),
  };
}
function endpointLead(
  point: Point,
  handle: Handle,
  obstacles: readonly Rect[],
  maximum: number,
): Point {
  for (const length of [maximum, CLEARANCE, LABEL_INSET, MIN_LEAD, 0]) {
    if (length > maximum) continue;
    const candidate = lead(point, handle, length);
    if (!obstacles.some((rect) => connectionSegmentIntersectsRect(point, candidate, rect)))
      return candidate;
  }
  return point;
}
function leadLength(a: Point, b: Point, source: Handle, target: Handle): number {
  const horizontal =
    (source === 'right' && target === 'left' && b.x >= a.x) ||
    (source === 'left' && target === 'right' && b.x <= a.x);
  const vertical =
    (source === 'bottom' && target === 'top' && b.y >= a.y) ||
    (source === 'top' && target === 'bottom' && b.y <= a.y);
  return Math.min(
    LEAD,
    horizontal ? Math.abs(b.x - a.x) / HALF : vertical ? Math.abs(b.y - a.y) / HALF : LEAD,
  );
}
function expanded(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + HALF * padding,
    height: rect.height + HALF * padding,
  };
}
export function connectionSegmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (a.x === b.x)
    return (
      a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    );
  if (a.y === b.y)
    return (
      a.y > rect.y &&
      a.y < rect.y + rect.height &&
      Math.max(a.x, b.x) > rect.x &&
      Math.min(a.x, b.x) < rect.x + rect.width
    );
  return true;
}
function rectanglesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function captionLines(source: string): string[] {
  const columns = Math.floor((LABEL_WIDTH - HALF * LABEL_INSET) / TEXT_CELL_WIDTH);
  const remaining = Array.from(source.replace(/\s+/g, ' ').trim());
  const lines: string[] = [];
  while (remaining.length && lines.length < LABEL_LINES) {
    const space = remaining.slice(0, columns + 1).lastIndexOf(' ');
    const count = remaining.length > columns && space > 0 ? space : columns;
    lines.push(remaining.splice(0, count).join(''));
    while (remaining[0] === ' ') remaining.shift();
  }
  if (remaining.length)
    lines[lines.length - 1] = `${Array.from(lines.at(-1)!)
      .slice(0, columns - 1)
      .join('')}…`;
  return lines;
}
function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && distance(previous, point) === 0) continue;
    const before = result.at(-HALF);
    if (
      before &&
      previous &&
      ((before.x === previous.x && previous.x === point.x) ||
        (before.y === previous.y && previous.y === point.y)) &&
      distance(before, point) === distance(before, previous) + distance(previous, point)
    )
      result.pop();
    result.push(point);
  }
  return result;
}
interface SearchEntry {
  index: number;
  cost: number;
  estimate: number;
  direction: number;
}
// A bounded priority queue keeps dense AI graphs off the unbounded-search path.
function push(heap: SearchEntry[], entry: SearchEntry) {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / HALF);
    if (heap[parent]!.estimate <= entry.estimate) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = entry;
}
function pop(heap: SearchEntry[]): SearchEntry {
  const first = heap[0]!;
  const last = heap.pop()!;
  if (!heap.length) return first;
  let index = 0;
  while (index * HALF + 1 < heap.length) {
    let child = index * HALF + 1;
    if (child + 1 < heap.length && heap[child + 1]!.estimate < heap[child]!.estimate) child++;
    if (last.estimate <= heap[child]!.estimate) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = last;
  return first;
}

function orthogonalPath(
  start: Point,
  end: Point,
  obstacles: readonly Rect[],
  lane: number,
): Point[] | null {
  const clear = (a: Point, b: Point) =>
    !obstacles.some((rect) => connectionSegmentIntersectsRect(a, b, rect));
  const candidates = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];
  for (const candidate of candidates)
    if (candidate.slice(1).every((point, index) => clear(candidate[index]!, point)))
      return simplify(candidate);
  const margin = CLEARANCE + (lane % LANES) * LANE_GAP;
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...obstacles.flatMap((rect) => [rect.x - margin, rect.x + rect.width + margin]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...obstacles.flatMap((rect) => [rect.y - margin, rect.y + rect.height + margin]),
    ]),
  ].sort((a, b) => a - b);
  const width = xs.length;
  const startIndex = ys.indexOf(start.y) * width + xs.indexOf(start.x);
  const endIndex = ys.indexOf(end.y) * width + xs.indexOf(end.x);
  const pointAt = (index: number): Point => ({
    x: xs[index % width]!,
    y: ys[Math.floor(index / width)]!,
  });
  const heap: SearchEntry[] = [];
  const costs = new Map<number, number>([[startIndex, 0]]);
  const parents = new Map<number, number>();
  push(heap, { index: startIndex, cost: 0, estimate: distance(start, end), direction: 0 });
  for (let visits = 0; heap.length && visits < MAX_SEARCH_STEPS; visits++) {
    const current = pop(heap);
    if (current.cost !== costs.get(current.index)) continue;
    if (current.index === endIndex) {
      const points: Point[] = [];
      let index: number | undefined = endIndex;
      while (index !== undefined) {
        points.push(pointAt(index));
        index = parents.get(index);
      }
      return simplify(points.reverse());
    }
    const x = current.index % width;
    const y = Math.floor(current.index / width);
    const adjacent = [
      ...(x > 0 ? [current.index - 1] : []),
      ...(x + 1 < width ? [current.index + 1] : []),
      ...(y > 0 ? [current.index - width] : []),
      ...(y + 1 < ys.length ? [current.index + width] : []),
    ];
    const from = pointAt(current.index);
    for (const index of adjacent) {
      const to = pointAt(index);
      if (!clear(from, to)) continue;
      const direction = from.x === to.x ? 1 : HALF;
      const cost =
        current.cost +
        distance(from, to) +
        (current.direction && direction !== current.direction ? BEND_COST : 0);
      if (cost >= (costs.get(index) ?? Infinity)) continue;
      costs.set(index, cost);
      parents.set(index, current.index);
      push(heap, { index, cost, estimate: cost + distance(to, end), direction });
    }
  }
  return null;
}

/** Ephemeral geometry shared by the canvas and controlled image renderer; never persisted. */
export function layoutConnections(
  graph: Pick<GraphProjection, 'nodes' | 'edges' | 'boundaries'>,
): ReadonlyMap<string, ConnectionLayout> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const rectangles = graph.nodes.map((node) => ({ ...node.position, ...node.size }));
  const headers = graph.boundaries.map((boundary) => ({
    ...boundary.rect,
    width: Math.min(
      boundary.rect.width,
      (boundary.title || 'Untitled boundary').length * TEXT_CELL_WIDTH + LEAD,
    ),
    height: TEXT_LINE_HEIGHT + HALF * LABEL_INSET,
  }));
  const routes = new Map<string, ConnectionLayout>();
  const ordered = [...graph.edges].sort(
    (a, b) =>
      a.sourceId.localeCompare(b.sourceId) ||
      a.targetId.localeCompare(b.targetId) ||
      a.id.localeCompare(b.id),
  );
  const bounded = graph.nodes.length <= MAX_ROUTED_NODES && graph.edges.length <= MAX_ROUTED_EDGES;
  ordered.forEach((edge, lane) => {
    const source = nodes.get(edge.sourceId);
    const target = nodes.get(edge.targetId);
    if (!source || !target) return;
    const a = connectionEndpoint(source, edge.sourceHandle);
    const b = connectionEndpoint(target, edge.targetHandle);
    // Short existing corridors and boundary titles can require an immediate turn.
    // Endpoint cards stay solid obstacles while other cards retain extra clearance.
    const obstacles = [
      ...rectangles.map((rect, index) =>
        graph.nodes[index]!.id === source.id || graph.nodes[index]!.id === target.id
          ? rect
          : expanded(rect, CLEARANCE),
      ),
      ...headers,
    ];
    const maximum = leadLength(a, b, edge.sourceHandle, edge.targetHandle);
    const start = endpointLead(a, edge.sourceHandle, obstacles, maximum);
    const end = endpointLead(b, edge.targetHandle, obstacles, maximum);
    const middle = bounded ? orthogonalPath(start, end, obstacles, lane) : null;
    routes.set(edge.id, {
      points: middle ? simplify([a, ...middle, b]) : simplify([a, { x: b.x, y: a.y }, b]),
      routed: middle !== null,
      label: null,
    });
  });
  const occupied: Rect[] = [...rectangles.map((rect) => expanded(rect, LABEL_INSET)), ...headers];
  for (const edge of ordered) {
    const route = routes.get(edge.id);
    const text = edge.label.trim() || edge.protocol.trim();
    if (!route || !text) continue;
    const lines = captionLines(text);
    const width =
      Math.max(1, ...lines.map((line) => Array.from(line).length * TEXT_CELL_WIDTH)) +
      HALF * LABEL_INSET;
    const height = lines.length * TEXT_LINE_HEIGHT + HALF * LABEL_INSET;
    const segments = route.points
      .slice(1)
      .map((end, index) => ({ start: route.points[index]!, end }))
      .sort((a, b) => distance(b.start, b.end) - distance(a.start, a.end));
    let placed: ConnectionLayout['label'] = null;
    for (const segment of segments) {
      for (const fraction of LABEL_FRACTIONS) {
        const x = segment.start.x + (segment.end.x - segment.start.x) * fraction;
        const y = segment.start.y + (segment.end.y - segment.start.y) * fraction;
        const horizontal = segment.start.y === segment.end.y;
        const offset = (horizontal ? height : width) / HALF + LABEL_INSET;
        for (const side of [0, -offset, offset, -HALF * offset, HALF * offset]) {
          const rect = {
            x: x - width / HALF + (horizontal ? 0 : side),
            y: y - height / HALF + (horizontal ? side : 0),
            width,
            height,
          };
          if (occupied.some((obstacle) => rectanglesOverlap(rect, obstacle))) continue;
          placed = { rect, lines };
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (placed) occupied.push(expanded(placed.rect, LABEL_INSET));
    routes.set(edge.id, { ...route, label: placed });
  }
  return routes;
}

export function connectionPath(points: readonly Point[]): string {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}
