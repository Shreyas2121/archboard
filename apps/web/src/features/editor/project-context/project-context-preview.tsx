import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { GraphProjection } from '@archboard/contracts';
import type { BoundaryCanvasNode } from '@/features/editor/boundaries';
import { CanvasProjectionAdapter } from '@/features/editor/canvas/projection-adapter';
import { CANVAS_EDGE_TYPES } from '@/features/editor/canvas/canvas-edge-types';

import {
  PROJECT_CONTEXT_NODE_TYPES,
  projectContextNoResize,
} from './project-context-preview-config';

/** Dedicated Flow instance; no editor selection, awareness, presenter or document binding. */
export function ProjectContextPreview({ graph }: { readonly graph: GraphProjection }) {
  const projection = useMemo(() => new CanvasProjectionAdapter().adapt(graph), [graph]);
  const boundaries: BoundaryCanvasNode[] = graph.boundaries.map((boundary) => ({
    id: boundary.id,
    type: 'graph-boundary',
    position: { x: boundary.rect.x, y: boundary.rect.y },
    // Measured graph geometry belongs to React Flow's style API.
    style: { width: boundary.rect.width, height: boundary.rect.height },
    zIndex: -1,
    data: {
      boundary,
      editable: false,
      onResizeStart: projectContextNoResize,
      onResizeEnd: projectContextNoResize,
    },
  }));
  return (
    <div className="h-96 rounded-lg border bg-surface-canvas" aria-label="Project diagram preview">
      {/* A nested Flow otherwise reuses the editor's provider and viewport store. */}
      <ReactFlowProvider>
        <ReactFlow
          nodes={[...boundaries, ...projection.nodes]}
          edges={[...projection.edges]}
          nodeTypes={PROJECT_CONTEXT_NODE_TYPES}
          edgeTypes={CANVAS_EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          fitView
          minZoom={0.05}
          maxZoom={2}
        />
      </ReactFlowProvider>
    </div>
  );
}
