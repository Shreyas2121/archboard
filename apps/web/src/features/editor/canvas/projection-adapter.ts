import {
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
  type Rect as GraphRect,
} from '@archboard/contracts';
import { MarkerType, type Edge, type Node, type Rect } from '@xyflow/react';
import { layoutConnections, type ConnectionLayout } from '@archboard/export';

export interface CanvasNodeData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly editable?: boolean;
  readonly onResizeStart?: (id: string) => void;
  readonly onResizeEnd?: (id: string, rect: GraphRect) => void;
}

export type CanvasNode = Node<CanvasNodeData, 'graph-card'>;
export interface CanvasEdgeData extends Record<string, unknown> {
  readonly edge: GraphEdge;
  readonly layout: ConnectionLayout | undefined;
}

export type CanvasEdge = Edge<CanvasEdgeData, 'graph-connection'>;

export interface CanvasBoundary {
  readonly id: string;
  readonly title: string;
  readonly color: Boundary['color'];
  readonly rect: Boundary['rect'];
}

export interface CanvasProjection {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly boundaries: readonly CanvasBoundary[];
  readonly bounds: Rect | null;
}

interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
}

function retainLiveEntries<T>(
  cache: Map<string, CacheEntry<T>>,
  liveIds: ReadonlySet<string>,
): void {
  for (const id of cache.keys()) {
    if (!liveIds.has(id)) cache.delete(id);
  }
}

function nodeKey(node: GraphNode): string {
  return JSON.stringify(node);
}

function edgeKey(edge: GraphEdge): string {
  return JSON.stringify(edge);
}

function boundaryKey(boundary: Boundary): string {
  return JSON.stringify(boundary);
}

export function getProjectionBounds(
  projection: GraphProjection,
  connections = layoutConnections(projection),
): Rect | null {
  const rectangles = [
    ...projection.nodes.map((node) => ({ ...node.position, ...node.size })),
    ...projection.boundaries.map(({ rect }) => rect),
    ...[...connections.values()].flatMap(({ points, label }) => [
      ...points.map((point) => ({ ...point, width: 0, height: 0 })),
      ...(label ? [label.rect] : []),
    ]),
  ];
  if (rectangles.length === 0) return null;

  const minX = Math.min(...rectangles.map(({ x }) => x));
  const minY = Math.min(...rectangles.map(({ y }) => y));
  const maxX = Math.max(...rectangles.map(({ x, width }) => x + width));
  const maxY = Math.max(...rectangles.map(({ y, height }) => y + height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export class CanvasProjectionAdapter {
  private readonly nodeCache = new Map<string, CacheEntry<CanvasNode>>();
  private readonly edgeCache = new Map<string, CacheEntry<CanvasEdge>>();
  private readonly boundaryCache = new Map<string, CacheEntry<CanvasBoundary>>();
  private connectionKey = '';
  private connections: ReadonlyMap<string, ConnectionLayout> = new Map();

  public adapt(projection: GraphProjection): CanvasProjection {
    // Text edits in cards do not invalidate routes or unrelated edge identities.
    const connectionKey = JSON.stringify({
      nodes: projection.nodes.map(({ id, position, size }) => ({ id, position, size })),
      edges: projection.edges.map(
        ({ id, sourceId, targetId, sourceHandle, targetHandle, label, protocol }) => ({
          id,
          sourceId,
          targetId,
          sourceHandle,
          targetHandle,
          label,
          protocol,
        }),
      ),
      boundaries: projection.boundaries.map(({ rect, title }) => ({ rect, title })),
    });
    if (connectionKey !== this.connectionKey) {
      this.connections = layoutConnections(projection);
      this.connectionKey = connectionKey;
    }
    const nodes = projection.nodes.map((node) => this.adaptNode(node));
    const edges = projection.edges.map((edge) => this.adaptEdge(edge));
    const boundaries = projection.boundaries.map((boundary) => this.adaptBoundary(boundary));

    retainLiveEntries(this.nodeCache, new Set(projection.nodes.map(({ id }) => id)));
    retainLiveEntries(this.edgeCache, new Set(projection.edges.map(({ id }) => id)));
    retainLiveEntries(this.boundaryCache, new Set(projection.boundaries.map(({ id }) => id)));

    return Object.freeze({
      nodes,
      edges,
      boundaries,
      bounds: getProjectionBounds(projection, this.connections),
    });
  }

  private adaptNode(node: GraphNode): CanvasNode {
    const key = nodeKey(node);
    const cached = this.nodeCache.get(node.id);
    if (cached?.key === key) return cached.value;

    const value: CanvasNode = Object.freeze({
      id: node.id,
      type: 'graph-card',
      position: node.position,
      data: Object.freeze({ node }),
      style: { width: node.size.width, height: node.size.height },
      selected: false,
      draggable: false,
      deletable: false,
      selectable: true,
      ariaLabel: `${node.kind} card: ${node.title}`,
    });
    this.nodeCache.set(node.id, { key, value });
    return value;
  }

  private adaptEdge(edge: GraphEdge): CanvasEdge {
    const layout = this.connections.get(edge.id);
    const key = `${edgeKey(edge)}:${JSON.stringify(layout)}`;
    const cached = this.edgeCache.get(edge.id);
    if (cached?.key === key) return cached.value;

    const labelParts = [edge.label, edge.protocol].filter((part) => part.length > 0);
    const value: CanvasEdge = Object.freeze({
      id: edge.id,
      type: 'graph-connection',
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: Object.freeze({ edge, layout }),
      label: labelParts.join(' / '),
      selected: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--edge)' },
      ...(edge.direction === EDGE_DIRECTIONS.BIDIRECTIONAL
        ? { markerStart: { type: MarkerType.ArrowClosed, color: 'var(--edge)' } }
        : {}),
      ...(edge.style === EDGE_STYLES.DASHED ? { style: { strokeDasharray: '6 5' } } : {}),
      selectable: true,
      deletable: false,
      ariaLabel: `Connection: ${edge.sourceHandle} on ${edge.sourceId} to ${edge.targetHandle} on ${edge.targetId}; ${edge.direction}, ${edge.style}; ${labelParts.join(', ') || 'unlabeled'}`,
    });
    this.edgeCache.set(edge.id, { key, value });
    return value;
  }

  private adaptBoundary(boundary: Boundary): CanvasBoundary {
    const key = boundaryKey(boundary);
    const cached = this.boundaryCache.get(boundary.id);
    if (cached?.key === key) return cached.value;

    const value: CanvasBoundary = Object.freeze({
      id: boundary.id,
      title: boundary.title,
      color: boundary.color,
      rect: boundary.rect,
    });
    this.boundaryCache.set(boundary.id, { key, value });
    return value;
  }
}
