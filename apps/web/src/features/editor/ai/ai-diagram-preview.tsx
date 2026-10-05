import { useMemo } from 'react';
import { ReactFlow } from '@xyflow/react';
import type { GraphProjection } from '@archboard/contracts';
import { CardNode } from '@/features/editor/cards';
import { BoundaryNode, type BoundaryCanvasNode } from '@/features/editor/boundaries';
import { CanvasProjectionAdapter } from '@/features/editor/canvas/projection-adapter';

const NODE_TYPES = { 'graph-card': CardNode, 'graph-boundary': BoundaryNode };
const noResize = () => {};

/** Dedicated Flow instance; no editor selection, awareness, presenter or document binding. */
export function AiDiagramPreview({ graph }: { readonly graph: GraphProjection }) {
  const projection = useMemo(() => new CanvasProjectionAdapter().adapt(graph), [graph]);
  const boundaries: BoundaryCanvasNode[] = graph.boundaries.map((boundary) => ({
    id: boundary.id,
    type: 'graph-boundary',
    position: { x: boundary.rect.x, y: boundary.rect.y },
    // Measured graph geometry belongs to React Flow's style API.
    style: { width: boundary.rect.width, height: boundary.rect.height },
    zIndex: -1,
    data: { boundary, editable: false, onResizeStart: noResize, onResizeEnd: noResize },
  }));
  return (
    <div
      className="h-96 rounded-lg border bg-surface-canvas"
      aria-label="Isolated generated diagram preview"
    >
      <ReactFlow
        nodes={[...boundaries, ...projection.nodes]}
        edges={[...projection.edges]}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        minZoom={0.05}
        maxZoom={2}
      />
    </div>
  );
}
