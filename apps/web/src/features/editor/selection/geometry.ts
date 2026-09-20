import {
  MAX_GRAPH_COORDINATE,
  MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MAX_RECT_DIMENSION,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  type GraphNode,
  type Rect,
} from '@archboard/contracts';
import type {
  BoundaryGeometryChange,
  GeometryBatch,
  NodeGeometryChange,
} from '@archboard/document-model';

export const MIN_BOUNDARY_DIMENSION = 32;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function snapWorld(value: number, gridSize: number, enabled: boolean): number {
  return enabled ? Math.round(value / gridSize) * gridSize : value;
}

export function normalizeNodeRect(
  node: GraphNode,
  rect: Rect,
  gridSize: number,
  snap: boolean,
): NodeGeometryChange {
  return {
    id: node.id,
    position: {
      x: clamp(snapWorld(rect.x, gridSize, snap), -MAX_GRAPH_COORDINATE, MAX_GRAPH_COORDINATE),
      y: clamp(snapWorld(rect.y, gridSize, snap), -MAX_GRAPH_COORDINATE, MAX_GRAPH_COORDINATE),
    },
    size: {
      width: clamp(snapWorld(rect.width, gridSize, snap), MIN_NODE_WIDTH, MAX_NODE_WIDTH),
      height: clamp(snapWorld(rect.height, gridSize, snap), MIN_NODE_HEIGHT, MAX_NODE_HEIGHT),
    },
  };
}

export function normalizeBoundaryRect(
  id: string,
  rect: Rect,
  gridSize: number,
  snap: boolean,
): BoundaryGeometryChange {
  return {
    id,
    rect: {
      x: clamp(snapWorld(rect.x, gridSize, snap), -MAX_GRAPH_COORDINATE, MAX_GRAPH_COORDINATE),
      y: clamp(snapWorld(rect.y, gridSize, snap), -MAX_GRAPH_COORDINATE, MAX_GRAPH_COORDINATE),
      width: clamp(
        snapWorld(rect.width, gridSize, snap),
        MIN_BOUNDARY_DIMENSION,
        MAX_RECT_DIMENSION,
      ),
      height: clamp(
        snapWorld(rect.height, gridSize, snap),
        MIN_BOUNDARY_DIMENSION,
        MAX_RECT_DIMENSION,
      ),
    },
  };
}

export function geometryChanged(batch: GeometryBatch): boolean {
  return (batch.nodes?.length ?? 0) + (batch.boundaries?.length ?? 0) > 0;
}
