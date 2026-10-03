import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphProjection, Rect, PresenceState, PresentationStep } from '@archboard/contracts';
import type { TransientPresence } from '@archboard/sync-client';
import type { GeometryBatch } from '@archboard/document-model';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  MarkerType,
  ReactFlow,
  SelectionMode,
  type Connection,
  type NodeChange,
  type Viewport,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { PresenceOverlay } from '@/features/collaboration/presence-overlay';
import { EDITOR_CANCEL_GESTURES } from '@/features/editor/history/editor-shortcuts';
import {
  SELECTION_KINDS,
  type SelectionReference,
  useEditorSelection,
  useEditorUiActions,
} from '@/features/editor/state';
import { CardNode } from '@/features/editor/cards';
import { BoundaryNode, type BoundaryCanvasNode } from '@/features/editor/boundaries';
import { normalizeBoundaryRect, normalizeNodeRect } from '@/features/editor/selection';

import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  DEFAULT_CANVAS_VIEWPORT,
} from './canvas-config';
import {
  CanvasProjectionAdapter,
  type CanvasProjection,
  type CanvasEdge,
  type CanvasNode,
} from './projection-adapter';
import { CanvasGestures, reconcileCanvasNodes } from './canvas-gestures';
import { CanvasRenderCache } from './canvas-render-cache';
import { PRESENTATION_MIN_ZOOM } from '@/features/editor/presentation/presentation-model';

const NODE_TYPES = { 'graph-card': CardNode, 'graph-boundary': BoundaryNode } as const;
const SNAP_GRID: [number, number] = [CANVAS_GRID_SIZE, CANVAS_GRID_SIZE];
type EditorCanvasNode = CanvasNode | BoundaryCanvasNode;

interface GraphCanvasProps {
  readonly presenting?: boolean;
  readonly presentationStep?: PresentationStep | null;
  readonly presence?: TransientPresence | null;
  readonly projection: GraphProjection;
  readonly minimapVisible: boolean;
  readonly gridSnapEnabled: boolean;
  readonly onViewportChange: (viewport: Viewport) => void;
  readonly onUserViewportChange?: () => void;
  readonly editable: boolean;
  readonly onConnect: (connection: Connection) => void;
  readonly onReconnect: (edgeId: string, connection: Connection) => void;
  readonly onGeometryCommit: (batch: GeometryBatch) => GraphProjection | null;
}

// Camera updates in the shell need not rebuild the canvas subtree. Own store
// subscriptions and changed graph/permission/presentation props still render.
export const GraphCanvas = memo(function GraphCanvas({
  presenting = false,
  presentationStep = null,
  presence = null,
  projection,
  minimapVisible,
  gridSnapEnabled,
  onViewportChange,
  onUserViewportChange,
  editable,
  onConnect,
  onReconnect,
  onGeometryCommit,
}: GraphCanvasProps) {
  const adapter = useRef(new CanvasProjectionAdapter());
  const renderCache = useRef(new CanvasRenderCache<CanvasNode>());
  const boundaryRenderCache = useRef(new CanvasRenderCache<BoundaryCanvasNode>());
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const canvasProjection = useMemo(() => adapter.current.adapt(projection), [projection]);
  const selection = useEditorSelection();
  const flow = useRef<ReactFlowInstance<EditorCanvasNode, CanvasEdge> | null>(null);
  const localPresence = useRef<PresenceState>({ cursor: null, selectedIds: [], dragPreview: null });
  const publishPresence = useCallback(
    (patch: Partial<PresenceState>) => {
      localPresence.current = { ...localPresence.current, ...patch };
      presence?.publish(localPresence.current);
    },
    [presence],
  );
  useEffect(() => {
    publishPresence({ selectedIds: selection.map(({ id }) => id) });
  }, [selection, publishPresence]);
  useEffect(() => {
    if (!editable) publishPresence({ dragPreview: null });
  }, [editable, publishPresence]);
  const actions = useEditorUiActions();
  const altPressed = useRef(false);
  const [altBypass, setAltBypass] = useState(false);
  const gestures = useRef(new CanvasGestures());
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const completeGesture = useRef<(ids: readonly string[], batch: GeometryBatch) => void>(() => {});
  const beginResize = useCallback((id: string) => {
    if (editableRef.current) gestures.current.begin([id]);
  }, []);
  const selectedNodeIds = useMemo(
    () =>
      new Set(
        presenting
          ? (presentationStep?.nodeIds ?? [])
          : selection.filter(({ kind }) => kind === SELECTION_KINDS.NODE).map(({ id }) => id),
      ),
    [selection, presenting, presentationStep],
  );
  const selectedEdgeIds = useMemo(
    () =>
      new Set(
        presenting
          ? (presentationStep?.edgeIds ?? [])
          : selection.filter(({ kind }) => kind === SELECTION_KINDS.EDGE).map(({ id }) => id),
      ),
    [selection, presenting, presentationStep],
  );
  const selectedBoundaryIds = useMemo(
    () =>
      new Set(
        presenting
          ? []
          : selection.filter(({ kind }) => kind === SELECTION_KINDS.BOUNDARY).map(({ id }) => id),
      ),
    [selection, presenting],
  );
  const finishCardResize = useCallback(
    (id: string, rect: Rect): void => {
      const node = projectionRef.current.nodes.find((candidate) => candidate.id === id);
      completeGesture.current([id], {
        nodes:
          node === undefined
            ? []
            : [
                normalizeNodeRect(
                  node,
                  rect,
                  CANVAS_GRID_SIZE,
                  gridSnapEnabled && !altPressed.current,
                ),
              ],
      });
    },
    [gridSnapEnabled],
  );
  const finishBoundaryResize = useCallback(
    (id: string, rect: Rect): void => {
      completeGesture.current([id], {
        boundaries: [
          normalizeBoundaryRect(id, rect, CANVAS_GRID_SIZE, gridSnapEnabled && !altPressed.current),
        ],
      });
    },
    [gridSnapEnabled],
  );
  const renderNodes = useCallback(
    (canvasProjection: CanvasProjection): EditorCanvasNode[] => [
      ...canvasProjection.boundaries.map<BoundaryCanvasNode>((boundary) =>
        boundaryRenderCache.current.get(
          boundary.id,
          [
            boundary,
            editable,
            selectedBoundaryIds.has(boundary.id),
            beginResize,
            finishBoundaryResize,
          ],
          () => ({
            id: boundary.id,
            type: 'graph-boundary',
            position: { x: boundary.rect.x, y: boundary.rect.y },
            data: {
              boundary,
              editable,
              onResizeStart: beginResize,
              onResizeEnd: finishBoundaryResize,
            },
            style: { width: boundary.rect.width, height: boundary.rect.height },
            selected: selectedBoundaryIds.has(boundary.id),
            draggable: editable,
            dragHandle: '.boundary-drag-handle',
            className: '!pointer-events-none',
            deletable: false,
            selectable: true,
            zIndex: -10,
            ariaLabel: `Boundary: ${boundary.title || 'Untitled boundary'}`,
          }),
        ),
      ),
      ...canvasProjection.nodes.map((node) => {
        const selected = selectedNodeIds.has(node.id);
        return renderCache.current.get(
          node.id,
          [node, selected, editable, beginResize, finishCardResize],
          () => ({
            ...node,
            selected,
            draggable: editable,
            data: {
              ...node.data,
              editable,
              onResizeStart: beginResize,
              onResizeEnd: finishCardResize,
            },
          }),
        );
      }),
    ],
    [
      beginResize,
      editable,
      finishBoundaryResize,
      finishCardResize,
      selectedBoundaryIds,
      selectedNodeIds,
    ],
  );
  const projectedNodes = useMemo(
    () => renderNodes(canvasProjection),
    [canvasProjection, renderNodes],
  );
  const [nodes, setNodes] = useState<EditorCanvasNode[]>(projectedNodes);
  const nodesRef = useRef(nodes);
  const projectedRef = useRef(projectedNodes);
  projectedRef.current = projectedNodes;
  const reconcile = useCallback((canonical = projectedRef.current): void => {
    const next = reconcileCanvasNodes(nodesRef.current, canonical, gestures.current.activeIds);
    nodesRef.current = next;
    setNodes(next);
  }, []);
  const cancelGestures = useCallback(() => {
    gestures.current.cancel();
    reconcile();
    publishPresence({ dragPreview: null });
  }, [reconcile, publishPresence]);
  completeGesture.current = (ids, batch) => {
    const active = gestures.current.finish(ids);
    let committed: GraphProjection | null = null;
    try {
      if (active && editableRef.current) committed = onGeometryCommit(batch);
    } finally {
      const canonical =
        committed === null ? projectedRef.current : renderNodes(adapter.current.adapt(committed));
      reconcile(canonical);
      publishPresence({ dragPreview: null });
    }
  };
  const edges = useMemo(
    () =>
      canvasProjection.edges.map((edge) => {
        const selected = selectedEdgeIds.has(edge.id);
        return !selected
          ? edge
          : {
              ...edge,
              selected,
              markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--primary)' },
              ...(edge.markerStart === undefined
                ? {}
                : {
                    markerStart: { type: MarkerType.ArrowClosed, color: 'var(--primary)' },
                  }),
            };
      }),
    [canvasProjection.edges, selectedEdgeIds],
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
    const liveBoundaryIds = new Set(canvasProjection.boundaries.map(({ id }) => id));
    const retained = selection.filter(({ id, kind }) =>
      kind === SELECTION_KINDS.NODE
        ? liveNodeIds.has(id)
        : kind === SELECTION_KINDS.EDGE
          ? liveEdgeIds.has(id)
          : liveBoundaryIds.has(id),
    );
    if (retained.length !== selection.length) actions.setSelection(retained);
  }, [
    actions,
    canvasProjection.boundaries,
    canvasProjection.edges,
    canvasProjection.nodes,
    selection,
  ]);

  useEffect(() => {
    if (!editable) gestures.current.cancel();
    const liveIds = new Set(projectedNodes.map(({ id }) => id));
    renderCache.current.retain(liveIds);
    boundaryRenderCache.current.retain(liveIds);
    gestures.current.retain(liveIds);
    reconcile(projectedNodes);
  }, [editable, projectedNodes, reconcile]);

  useEffect(() => {
    const updateAlt = (pressed: boolean): void => {
      altPressed.current = pressed;
      setAltBypass(pressed);
    };
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') updateAlt(true);
    };
    const keyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') updateAlt(false);
    };
    const blur = (): void => {
      updateAlt(false);
      cancelGestures();
    };
    const cancel = (): void => cancelGestures();
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchcancel', cancel);
    window.addEventListener(EDITOR_CANCEL_GESTURES, cancel);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchcancel', cancel);
      window.removeEventListener(EDITOR_CANCEL_GESTURES, cancel);
    };
  }, [cancelGestures]);

  const handleNodesChange = useCallback((changes: NodeChange<EditorCanvasNode>[]): void => {
    setNodes((current) => {
      const allowed = changes.filter((change) => {
        const gestureChange =
          (change.type === 'position' && change.dragging !== undefined) ||
          (change.type === 'dimensions' && change.resizing !== undefined);
        return !gestureChange || (editableRef.current && gestures.current.activeIds.has(change.id));
      });
      const next = applyNodeChanges(allowed, current);
      nodesRef.current = next;
      return next;
    });
  }, []);
  const finishDrag = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      _node: EditorCanvasNode,
      draggedNodes: EditorCanvasNode[],
    ) => {
      const batch: GeometryBatch = {
        nodes: draggedNodes
          .filter((node): node is CanvasNode => node.type === 'graph-card')
          .map((node) =>
            normalizeNodeRect(
              node.data.node,
              { ...node.position, ...node.data.node.size },
              CANVAS_GRID_SIZE,
              gridSnapEnabled && !altPressed.current,
            ),
          ),
        boundaries: draggedNodes
          .filter((node): node is BoundaryCanvasNode => node.type === 'graph-boundary')
          .map((node) =>
            normalizeBoundaryRect(
              node.id,
              { ...node.data.boundary.rect, ...node.position },
              CANVAS_GRID_SIZE,
              gridSnapEnabled && !altPressed.current,
            ),
          ),
      };
      completeGesture.current(
        draggedNodes.map(({ id }) => id),
        batch,
      );
    },
    [gridSnapEnabled],
  );

  // React Flow owns the SVG paths and marquee; use its installed CSS variable hooks.
  return (
    <ReactFlow<EditorCanvasNode, CanvasEdge>
      className="[--xy-background-color:transparent] [--xy-edge-stroke:var(--edge)] [--xy-edge-stroke-width:1.5] [--xy-edge-stroke-selected:var(--primary)] [--xy-connectionline-stroke:var(--primary)] [--xy-connectionline-stroke-width:1.5] [--xy-selection-background-color:color-mix(in_oklch,var(--primary)_8%,transparent)] [--xy-selection-border:1px_dashed_var(--primary)] [--xy-attribution-background-color:var(--surface-panel)] [&_.react-flow__attribution_a]:text-muted-foreground [&_.react-flow__node:focus-visible]:outline-2 [&_.react-flow__node:focus-visible]:outline-ring [&_.react-flow__node:focus-visible]:outline-offset-2"
      defaultViewport={DEFAULT_CANVAS_VIEWPORT}
      edges={edges}
      edgesReconnectable={editable}
      elevateEdgesOnSelect
      elementsSelectable={!presenting}
      maxZoom={CANVAS_MAX_ZOOM}
      minZoom={presenting ? PRESENTATION_MIN_ZOOM : CANVAS_MIN_ZOOM}
      multiSelectionKeyCode="Shift"
      nodes={nodes}
      nodesFocusable={false}
      edgesFocusable={false}
      nodesConnectable={editable}
      nodesDraggable={editable}
      nodeTypes={NODE_TYPES}
      onConnect={onConnect}
      onInit={(instance) => {
        flow.current = instance;
      }}
      onMouseMove={(event) => {
        const cursor = flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        if (cursor !== undefined) publishPresence({ cursor });
      }}
      onMouseLeave={() => publishPresence({ cursor: null })}
      onPaneClick={() => {
        if (!presenting) actions.clearSelection();
      }}
      onNodeClick={(event, node) => {
        if (!presenting)
          selectObject(
            {
              id: node.id,
              kind:
                node.type === 'graph-boundary' ? SELECTION_KINDS.BOUNDARY : SELECTION_KINDS.NODE,
            },
            event.shiftKey,
          );
      }}
      onEdgeClick={(event, edge) => {
        if (!presenting) selectObject({ id: edge.id, kind: SELECTION_KINDS.EDGE }, event.shiftKey);
      }}
      onNodeDragStart={(_event, _node, draggedNodes) => {
        if (editableRef.current) gestures.current.begin(draggedNodes.map(({ id }) => id));
      }}
      onNodeDragStop={finishDrag}
      onNodeDrag={(_event, _node, draggedNodes) => {
        if (
          editableRef.current &&
          draggedNodes.some(({ id }) => gestures.current.activeIds.has(id))
        )
          publishPresence({
            dragPreview: {
              positions: draggedNodes.map(({ id, position }) => ({ id, position })),
            },
          });
      }}
      onNodesChange={handleNodesChange}
      onReconnect={(edge, connection) => onReconnect(edge.id, connection)}
      onSelectionEnd={() => {
        if (!presenting)
          actions.setSelection(
            nodesRef.current
              .filter(({ selected }) => selected)
              .map(({ id, type }) => ({
                id,
                kind: type === 'graph-boundary' ? SELECTION_KINDS.BOUNDARY : SELECTION_KINDS.NODE,
              })),
          );
      }}
      onViewportChange={onViewportChange}
      onMoveStart={(event) => {
        // Programmatic fits have no user event; only user movement releases follow.
        if (event) onUserViewportChange?.();
      }}
      panActivationKeyCode="Space"
      panOnDrag={presenting ? true : [1]}
      selectionMode={SelectionMode.Partial}
      selectionOnDrag={!presenting}
      snapGrid={SNAP_GRID}
      snapToGrid={gridSnapEnabled && !altBypass}
      zoomActivationKeyCode="Control"
      zoomOnDoubleClick={false}
      zoomOnPinch
      zoomOnScroll={false}
    >
      {presence !== null && <PresenceOverlay presence={presence} projection={projection} />}
      <Background
        color="var(--canvas-dot)"
        gap={CANVAS_GRID_SIZE}
        size={1}
        variant={BackgroundVariant.Dots}
      />
      {minimapVisible && (
        <MiniMap
          ariaLabel="Architecture canvas minimap"
          className="overflow-hidden rounded-lg !border !border-border !bg-surface-panel shadow-sm"
          bgColor="var(--surface-panel)"
          maskColor="color-mix(in oklch, var(--surface-canvas) 72%, transparent)"
          maskStrokeColor="var(--edge)"
          maskStrokeWidth={1}
          nodeColor="var(--edge)"
          nodeBorderRadius={4}
          pannable
          zoomable
        />
      )}
    </ReactFlow>
  );
});
