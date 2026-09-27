import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphProjection, Rect, PresenceState } from '@archboard/contracts';
import type { TransientPresence } from '@archboard/sync-client';
import type { GeometryBatch } from '@archboard/document-model';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  SelectionMode,
  type Connection,
  type NodeChange,
  type Viewport,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { PresenceOverlay } from '@/features/collaboration/presence-overlay';
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
import { CanvasProjectionAdapter, type CanvasEdge, type CanvasNode } from './projection-adapter';

const NODE_TYPES = { 'graph-card': CardNode, 'graph-boundary': BoundaryNode } as const;
const SNAP_GRID: [number, number] = [CANVAS_GRID_SIZE, CANVAS_GRID_SIZE];
type EditorCanvasNode = CanvasNode | BoundaryCanvasNode;

interface GraphCanvasProps {
  readonly presence?: TransientPresence | null;
  readonly projection: GraphProjection;
  readonly minimapVisible: boolean;
  readonly gridSnapEnabled: boolean;
  readonly onViewportChange: (viewport: Viewport) => void;
  readonly editable: boolean;
  readonly onConnect: (connection: Connection) => void;
  readonly onReconnect: (edgeId: string, connection: Connection) => void;
  readonly onGeometryCommit: (batch: GeometryBatch) => void;
}

export function GraphCanvas({
  presence = null,
  projection,
  minimapVisible,
  gridSnapEnabled,
  onViewportChange,
  editable,
  onConnect,
  onReconnect,
  onGeometryCommit,
}: GraphCanvasProps) {
  const adapter = useRef(new CanvasProjectionAdapter());
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
  const gestureActive = useRef(false);
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
  const selectedBoundaryIds = useMemo(
    () =>
      new Set(
        selection.filter(({ kind }) => kind === SELECTION_KINDS.BOUNDARY).map(({ id }) => id),
      ),
    [selection],
  );
  const finishCardResize = useCallback(
    (id: string, rect: Rect): void => {
      const node = projection.nodes.find((candidate) => candidate.id === id);
      if (node === undefined) return;
      onGeometryCommit({
        nodes: [
          normalizeNodeRect(node, rect, CANVAS_GRID_SIZE, gridSnapEnabled && !altPressed.current),
        ],
      });
      gestureActive.current = false;
    },
    [gridSnapEnabled, onGeometryCommit, projection.nodes],
  );
  const finishBoundaryResize = useCallback(
    (id: string, rect: Rect): void => {
      onGeometryCommit({
        boundaries: [
          normalizeBoundaryRect(id, rect, CANVAS_GRID_SIZE, gridSnapEnabled && !altPressed.current),
        ],
      });
      gestureActive.current = false;
    },
    [gridSnapEnabled, onGeometryCommit],
  );
  const projectedNodes = useMemo<EditorCanvasNode[]>(
    () => [
      ...canvasProjection.boundaries.map<BoundaryCanvasNode>((boundary) => ({
        id: boundary.id,
        type: 'graph-boundary',
        position: { x: boundary.rect.x, y: boundary.rect.y },
        data: { boundary, editable, onResizeEnd: finishBoundaryResize },
        style: { width: boundary.rect.width, height: boundary.rect.height },
        selected: selectedBoundaryIds.has(boundary.id),
        draggable: editable,
        dragHandle: '.boundary-drag-handle',
        className: '!pointer-events-none',
        deletable: false,
        selectable: true,
        zIndex: -10,
        ariaLabel: `Boundary: ${boundary.title || 'Untitled boundary'}`,
      })),
      ...canvasProjection.nodes.map((node) => {
        const selected = selectedNodeIds.has(node.id);
        return {
          ...node,
          selected,
          draggable: editable,
          data: { ...node.data, editable, onResizeEnd: finishCardResize },
        };
      }),
    ],
    [
      canvasProjection.boundaries,
      canvasProjection.nodes,
      editable,
      finishBoundaryResize,
      finishCardResize,
      selectedBoundaryIds,
      selectedNodeIds,
    ],
  );
  const [nodes, setNodes] = useState<EditorCanvasNode[]>(projectedNodes);
  const nodesRef = useRef(nodes);
  const edges = useMemo(
    () =>
      canvasProjection.edges.map((edge) => {
        const selected = selectedEdgeIds.has(edge.id);
        return edge.selected === selected ? edge : { ...edge, selected };
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
    if (!gestureActive.current) {
      nodesRef.current = projectedNodes;
      setNodes(projectedNodes);
    }
  }, [projectedNodes]);

  useEffect(() => {
    const updateAlt = (pressed: boolean): void => {
      altPressed.current = pressed;
      setAltBypass(pressed);
    };
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') updateAlt(true);
      if (event.key === 'Escape') actions.clearSelection();
    };
    const keyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') updateAlt(false);
    };
    const blur = (): void => updateAlt(false);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  }, [actions]);

  const handleNodesChange = useCallback((changes: NodeChange<EditorCanvasNode>[]): void => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
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
      onGeometryCommit(batch);
      publishPresence({ dragPreview: null });
      gestureActive.current = false;
    },
    [gridSnapEnabled, onGeometryCommit, publishPresence],
  );

  return (
    <ReactFlow<EditorCanvasNode, CanvasEdge>
      className="bg-muted/25"
      defaultViewport={DEFAULT_CANVAS_VIEWPORT}
      edges={edges}
      edgesReconnectable={editable}
      elevateEdgesOnSelect
      elementsSelectable
      maxZoom={CANVAS_MAX_ZOOM}
      minZoom={CANVAS_MIN_ZOOM}
      multiSelectionKeyCode="Shift"
      nodes={nodes}
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
      onPaneClick={actions.clearSelection}
      onNodeClick={(event, node) =>
        selectObject(
          {
            id: node.id,
            kind: node.type === 'graph-boundary' ? SELECTION_KINDS.BOUNDARY : SELECTION_KINDS.NODE,
          },
          event.shiftKey,
        )
      }
      onEdgeClick={(event, edge) =>
        selectObject({ id: edge.id, kind: SELECTION_KINDS.EDGE }, event.shiftKey)
      }
      onNodeDragStart={() => {
        gestureActive.current = true;
      }}
      onNodeDragStop={finishDrag}
      onNodeDrag={(_event, _node, draggedNodes) => {
        if (editable)
          publishPresence({
            dragPreview: {
              positions: draggedNodes.map(({ id, position }) => ({ id, position })),
            },
          });
      }}
      onNodesChange={handleNodesChange}
      onReconnect={(edge, connection) => onReconnect(edge.id, connection)}
      onSelectionEnd={() =>
        actions.setSelection(
          nodesRef.current
            .filter(({ selected }) => selected)
            .map(({ id, type }) => ({
              id,
              kind: type === 'graph-boundary' ? SELECTION_KINDS.BOUNDARY : SELECTION_KINDS.NODE,
            })),
        )
      }
      onViewportChange={onViewportChange}
      panActivationKeyCode="Space"
      panOnDrag={[1]}
      selectionMode={SelectionMode.Partial}
      selectionOnDrag
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
