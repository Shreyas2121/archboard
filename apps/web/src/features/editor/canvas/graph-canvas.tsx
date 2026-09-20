import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { GraphProjection } from '@archboard/contracts';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type OnSelectionChangeFunc,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  SELECTION_KINDS,
  type SelectionReference,
  useEditorSelection,
  useEditorUiActions,
} from '@/features/editor/state';

import { BoundaryLayer } from './boundary-layer';
import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  DEFAULT_CANVAS_VIEWPORT,
} from './canvas-config';
import { CanvasProjectionAdapter, type CanvasEdge, type CanvasNode } from './projection-adapter';
import { ProjectionNode } from './projection-node';

const NODE_TYPES = { 'graph-card': ProjectionNode } as const;
const SNAP_GRID: [number, number] = [CANVAS_GRID_SIZE, CANVAS_GRID_SIZE];

interface GraphCanvasProps {
  readonly projection: GraphProjection;
  readonly minimapVisible: boolean;
  readonly gridSnapEnabled: boolean;
  readonly onViewportChange: (viewport: Viewport) => void;
}

export function GraphCanvas({
  projection,
  minimapVisible,
  gridSnapEnabled,
  onViewportChange,
}: GraphCanvasProps) {
  const adapter = useRef(new CanvasProjectionAdapter());
  const canvasProjection = useMemo(() => adapter.current.adapt(projection), [projection]);
  const selection = useEditorSelection();
  const actions = useEditorUiActions();
  const selectedNodeIds = useMemo(
    () =>
      new Set(selection.filter(({ kind }) => kind === SELECTION_KINDS.NODE).map(({ id }) => id)),
    [selection],
  );
  const selectedEdgeIds = useMemo(
    () =>
      new Set(selection.filter(({ kind }) => kind === SELECTION_KINDS.EDGE).map(({ id }) => id)),
    [selection],
  );
  const nodes = useMemo(
    () =>
      canvasProjection.nodes.map((node) => {
        const selected = selectedNodeIds.has(node.id);
        return node.selected === selected ? node : { ...node, selected };
      }),
    [canvasProjection.nodes, selectedNodeIds],
  );
  const edges = useMemo(
    () =>
      canvasProjection.edges.map((edge) => {
        const selected = selectedEdgeIds.has(edge.id);
        return edge.selected === selected ? edge : { ...edge, selected };
      }),
    [canvasProjection.edges, selectedEdgeIds],
  );

  const handleSelectionChange = useCallback<OnSelectionChangeFunc<CanvasNode, CanvasEdge>>(
    ({ nodes, edges }) => {
      const selection: SelectionReference[] = [
        ...nodes.map(({ id }) => ({ id, kind: SELECTION_KINDS.NODE })),
        ...edges.map(({ id }) => ({ id, kind: SELECTION_KINDS.EDGE })),
      ];
      actions.setSelection(selection);
    },
    [actions],
  );
  const selectObject = useCallback(
    (reference: SelectionReference, additive: boolean): void => {
      if (!additive) {
        actions.setSelection([reference]);
        return;
      }
      const alreadySelected = selection.some(
        ({ id, kind }) => id === reference.id && kind === reference.kind,
      );
      actions.setSelection(
        alreadySelected
          ? selection.filter(({ id, kind }) => id !== reference.id || kind !== reference.kind)
          : [...selection, reference],
      );
    },
    [actions, selection],
  );

  useEffect(() => {
    const liveNodeIds = new Set(canvasProjection.nodes.map(({ id }) => id));
    const liveEdgeIds = new Set(canvasProjection.edges.map(({ id }) => id));
    const retained = selection.filter(({ id, kind }) =>
      kind === SELECTION_KINDS.NODE
        ? liveNodeIds.has(id)
        : kind === SELECTION_KINDS.EDGE
          ? liveEdgeIds.has(id)
          : true,
    );
    if (retained.length !== selection.length) actions.setSelection(retained);
  }, [actions, canvasProjection.edges, canvasProjection.nodes, selection]);

  return (
    <ReactFlow<CanvasNode, CanvasEdge>
      className="bg-muted/25"
      defaultViewport={DEFAULT_CANVAS_VIEWPORT}
      edges={edges}
      edgesReconnectable={false}
      elementsSelectable
      maxZoom={CANVAS_MAX_ZOOM}
      minZoom={CANVAS_MIN_ZOOM}
      multiSelectionKeyCode="Shift"
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={NODE_TYPES}
      onPaneClick={actions.clearSelection}
      onNodeClick={(event: ReactMouseEvent, node) =>
        selectObject({ id: node.id, kind: SELECTION_KINDS.NODE }, event.shiftKey)
      }
      onEdgeClick={(event: ReactMouseEvent, edge) =>
        selectObject({ id: edge.id, kind: SELECTION_KINDS.EDGE }, event.shiftKey)
      }
      onSelectionChange={handleSelectionChange}
      onViewportChange={onViewportChange}
      panActivationKeyCode="Space"
      panOnDrag={[1]}
      selectionOnDrag={false}
      snapGrid={SNAP_GRID}
      snapToGrid={gridSnapEnabled}
      zoomActivationKeyCode="Control"
      zoomOnDoubleClick={false}
      zoomOnPinch
      zoomOnScroll={false}
    >
      <Background
        color="var(--canvas-dot)"
        gap={CANVAS_GRID_SIZE}
        size={1}
        variant={BackgroundVariant.Dots}
      />
      <BoundaryLayer boundaries={canvasProjection.boundaries} />
      {minimapVisible && (
        <MiniMap
          ariaLabel="Architecture canvas minimap"
          className="!border !border-border !bg-card"
          maskColor="color-mix(in oklch, var(--background) 72%, transparent)"
          nodeColor="var(--muted-foreground)"
          pannable
          zoomable
        />
      )}
    </ReactFlow>
  );
}
