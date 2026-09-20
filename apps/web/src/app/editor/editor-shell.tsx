import { useCallback, useRef, useState } from 'react';
import {
  MAX_GRAPH_COORDINATE,
  NODE_KINDS,
  handleSchema,
  type NodeKind,
} from '@archboard/contracts';
import { LOCAL_PERSISTENCE_PHASES, WRITER_SESSION_PHASES } from '@archboard/sync-client';
import {
  Box,
  Braces,
  CircleHelp,
  Code2,
  Database,
  Grid3X3,
  Maximize,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RotateCcw,
  Scan,
  StickyNote,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useReactFlow, type Connection, type Viewport } from '@xyflow/react';

import { BrandMark } from '@/app/components/brand-mark';
import { IconButton } from '@/app/components/icon-button';
import { THEME_PREFERENCES, useTheme } from '@/app/theme/theme-provider';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type EditorSession, type EditorSessionSnapshot } from '@/features/editor/application';
import {
  BoundaryInspector,
  DEFAULT_BOUNDARY_SIZE,
  createBoundaryObject,
} from '@/features/editor/boundaries';
import { CARD_SIZES, createCardNode } from '@/features/editor/cards';
import {
  CANVAS_FIT_PADDING,
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_ZOOM_STEP,
  DEFAULT_CANVAS_VIEWPORT,
  getProjectionBounds,
  GraphCanvas,
} from '@/features/editor/canvas';
import { CardInspector } from '@/features/editor/inspector';
import { SelectionGeometryPanel } from '@/features/editor/selection';
import {
  createConnectionEdge,
  createReplacementEdge,
  EdgeInspector,
  KeyboardConnectionFlow,
  type ConnectionEndpoints,
} from '@/features/editor/connections';
import {
  SELECTION_KINDS,
  useActiveEditorDialog,
  useEditorSelection,
  useEditorUiActions,
  useGridSnapEnabled,
  useInspectorOpen,
  useMinimapVisible,
  usePaletteOpen,
} from '@/features/editor/state';
import { cn } from '@/lib/utils';

import { EDITOR_VIEW_PHASES, editorViewState } from './editor-view-state';

interface PaletteItem {
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly kind: NodeKind | 'boundary';
}

const PALETTE_ITEMS: readonly PaletteItem[] = [
  {
    label: 'Component',
    description: 'Service or application',
    icon: Box,
    kind: NODE_KINDS.COMPONENT,
  },
  { label: 'Code', description: 'Module or repository', icon: Code2, kind: NODE_KINDS.CODE },
  {
    label: 'Schema',
    description: 'Data contract or store',
    icon: Database,
    kind: NODE_KINDS.SCHEMA,
  },
  { label: 'Note', description: 'Context for the team', icon: StickyNote, kind: NODE_KINDS.NOTE },
  { label: 'Boundary', description: 'Visual grouping region', icon: Braces, kind: 'boundary' },
];
const PERCENT_SCALE = 100;
const HALF = 2;
const CREATION_OFFSET = 32;
const CREATION_OFFSET_STEPS = 6;

interface EditorShellProps {
  readonly narrowScreen: boolean;
  readonly session: EditorSession | null;
  readonly sessionSnapshot: EditorSessionSnapshot | null;
}

function phaseForSession(
  snapshot: EditorSessionSnapshot | null,
  narrowScreen: boolean,
): (typeof EDITOR_VIEW_PHASES)[keyof typeof EDITOR_VIEW_PHASES] {
  if (snapshot?.initializationError) return EDITOR_VIEW_PHASES.RECOVERY_REQUIRED;
  if (snapshot?.projection === null || snapshot === null) return EDITOR_VIEW_PHASES.LOADING;

  const persistence = snapshot.writer.persistence;
  if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR) {
    return EDITOR_VIEW_PHASES.STORAGE_ERROR;
  }
  if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED) {
    return EDITOR_VIEW_PHASES.RECOVERY_REQUIRED;
  }
  if (narrowScreen) return EDITOR_VIEW_PHASES.NARROW_SCREEN;
  if (snapshot.writer.phase === WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE) {
    return EDITOR_VIEW_PHASES.READ_ONLY;
  }
  if (snapshot.writer.phase === WRITER_SESSION_PHASES.UNSUPPORTED) {
    return EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED;
  }
  if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.SAVING) {
    return EDITOR_VIEW_PHASES.SAVING;
  }
  if (persistence?.savedOnDevice) return EDITOR_VIEW_PHASES.SAVED;
  return snapshot.writer.writable ? EDITOR_VIEW_PHASES.WRITABLE : EDITOR_VIEW_PHASES.LOADING;
}

function connectionEndpoints(connection: Connection): ConnectionEndpoints {
  if (connection.source === null || connection.target === null) {
    throw new Error('Choose both a source card and a target card.');
  }
  return {
    sourceId: connection.source,
    sourceHandle: handleSchema.parse(connection.sourceHandle),
    targetId: connection.target,
    targetHandle: handleSchema.parse(connection.targetHandle),
  };
}

export function EditorShell({ narrowScreen, session, sessionSnapshot }: EditorShellProps) {
  const paletteOpen = usePaletteOpen();
  const inspectorOpen = useInspectorOpen();
  const selection = useEditorSelection();
  const minimapVisible = useMinimapVisible();
  const gridSnapEnabled = useGridSnapEnabled();
  const activeDialog = useActiveEditorDialog();
  const actions = useEditorUiActions();
  const reactFlow = useReactFlow();
  const canvasContainer = useRef<HTMLElement>(null);
  const creationSequence = useRef(0);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_CANVAS_VIEWPORT);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const { preference, cyclePreference } = useTheme();
  const viewState = editorViewState(phaseForSession(sessionSnapshot, narrowScreen));
  const projection = sessionSnapshot?.projection ?? null;
  const canvasReady = projection !== null;
  const selectedNode =
    selection.length === 1 && selection[0]?.kind === SELECTION_KINDS.NODE
      ? (projection?.nodes.find(({ id }) => id === selection[0]?.id) ?? null)
      : null;
  const selectedEdge =
    selection.length === 1 && selection[0]?.kind === SELECTION_KINDS.EDGE
      ? (projection?.edges.find(({ id }) => id === selection[0]?.id) ?? null)
      : null;
  const selectedBoundary =
    selection.length === 1 && selection[0]?.kind === SELECTION_KINDS.BOUNDARY
      ? (projection?.boundaries.find(({ id }) => id === selection[0]?.id) ?? null)
      : null;

  const createConnection = useCallback(
    (endpoints: ConnectionEndpoints): string | null => {
      if (session === null || !viewState.editable) return 'Editing is not available in this view.';
      try {
        const edge = createConnectionEdge(crypto.randomUUID(), endpoints);
        session.createConnection(edge);
        actions.setSelection([{ id: edge.id, kind: SELECTION_KINDS.EDGE }]);
        setConnectionNotice('Connection created.');
        return null;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The connection could not be created.';
        setConnectionNotice(message);
        return message;
      }
    },
    [actions, session, viewState.editable],
  );
  const connectWithPointer = useCallback(
    (connection: Connection): void => {
      try {
        createConnection(connectionEndpoints(connection));
      } catch {
        setConnectionNotice('Use one of the four fixed handles to connect two different cards.');
      }
    },
    [createConnection],
  );
  const reconnectWithPointer = useCallback(
    (edgeId: string, connection: Connection): void => {
      if (session === null || !viewState.editable || projection === null) return;
      const original = projection.edges.find(({ id }) => id === edgeId);
      if (original === undefined) return;
      try {
        const replacement = createReplacementEdge(
          crypto.randomUUID(),
          original,
          connectionEndpoints(connection),
        );
        session.replaceConnection(edgeId, replacement);
        actions.setSelection([{ id: replacement.id, kind: SELECTION_KINDS.EDGE }]);
        setConnectionNotice('Connection reconnected with a fresh ID.');
      } catch (error) {
        setConnectionNotice(
          error instanceof Error ? error.message : 'The connection could not be reconnected.',
        );
      }
    },
    [actions, projection, session, viewState.editable],
  );

  const createCard = useCallback(
    (kind: NodeKind): void => {
      if (session === null || !viewState.editable) return;
      const container = canvasContainer.current;
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      const size = CARD_SIZES[kind];
      const offset = (creationSequence.current % CREATION_OFFSET_STEPS) * CREATION_OFFSET;
      const rawPosition = {
        x: (rect.width / HALF - viewport.x) / viewport.zoom - size.width / HALF + offset,
        y: (rect.height / HALF - viewport.y) / viewport.zoom - size.height / HALF + offset,
      };
      const snap = (coordinate: number): number =>
        gridSnapEnabled ? Math.round(coordinate / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE : coordinate;
      const position = {
        x: Math.max(-MAX_GRAPH_COORDINATE, Math.min(MAX_GRAPH_COORDINATE, snap(rawPosition.x))),
        y: Math.max(-MAX_GRAPH_COORDINATE, Math.min(MAX_GRAPH_COORDINATE, snap(rawPosition.y))),
      };
      try {
        const card = createCardNode(kind, crypto.randomUUID(), position);
        session.createCard(card);
        creationSequence.current += 1;
        setCreationError(null);
        actions.setSelection([{ id: card.id, kind: SELECTION_KINDS.NODE }]);
      } catch {
        setCreationError('The card could not be created. Check the board limits and try again.');
      }
    },
    [actions, gridSnapEnabled, session, viewState.editable, viewport],
  );

  const createBoundary = useCallback((): void => {
    if (session === null || !viewState.editable) return;
    const container = canvasContainer.current;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    const offset = (creationSequence.current % CREATION_OFFSET_STEPS) * CREATION_OFFSET;
    const rawPosition = {
      x:
        (rect.width / HALF - viewport.x) / viewport.zoom -
        DEFAULT_BOUNDARY_SIZE.width / HALF +
        offset,
      y:
        (rect.height / HALF - viewport.y) / viewport.zoom -
        DEFAULT_BOUNDARY_SIZE.height / HALF +
        offset,
    };
    const snap = (coordinate: number): number =>
      gridSnapEnabled ? Math.round(coordinate / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE : coordinate;
    const position = {
      x: Math.max(-MAX_GRAPH_COORDINATE, Math.min(MAX_GRAPH_COORDINATE, snap(rawPosition.x))),
      y: Math.max(-MAX_GRAPH_COORDINATE, Math.min(MAX_GRAPH_COORDINATE, snap(rawPosition.y))),
    };
    try {
      const boundary = createBoundaryObject(crypto.randomUUID(), position);
      session.createBoundary(boundary);
      creationSequence.current += 1;
      setCreationError(null);
      actions.setSelection([{ id: boundary.id, kind: SELECTION_KINDS.BOUNDARY }]);
    } catch {
      setCreationError('The boundary could not be created. Check the board limits and try again.');
    }
  }, [actions, gridSnapEnabled, session, viewState.editable, viewport]);

  const commitGeometry = useCallback(
    (batch: Parameters<EditorSession['setGeometry']>[0]): void => {
      if (session === null || !viewState.editable) return;
      try {
        session.setGeometry(batch);
        setConnectionNotice('Geometry updated.');
      } catch {
        setConnectionNotice('The geometry exceeds the shared coordinate or size limits.');
      }
    },
    [session, viewState.editable],
  );

  const zoomTo = useCallback(
    (zoom: number): void => {
      void reactFlow.zoomTo(Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom)));
    },
    [reactFlow],
  );
  const fitContent = useCallback((): void => {
    if (projection === null) return;
    const bounds = getProjectionBounds(projection);
    if (bounds === null) {
      void reactFlow.setViewport(DEFAULT_CANVAS_VIEWPORT);
      return;
    }
    void reactFlow.fitBounds(bounds, { padding: CANVAS_FIT_PADDING });
  }, [projection, reactFlow]);
  const resetViewport = useCallback((): void => {
    void reactFlow.setViewport(DEFAULT_CANVAS_VIEWPORT);
  }, [reactFlow]);

  const ThemeIcon =
    preference === THEME_PREFERENCES.LIGHT
      ? Sun
      : preference === THEME_PREFERENCES.DARK
        ? Moon
        : Monitor;
  const nextTheme =
    preference === THEME_PREFERENCES.LIGHT
      ? 'dark'
      : preference === THEME_PREFERENCES.DARK
        ? 'system'
        : 'light';

  return (
    <div
      className="grid h-dvh min-h-[36rem] grid-rows-[3.5rem_minmax(0,1fr)_2.75rem] overflow-hidden bg-background"
      data-phase={viewState.phase}
    >
      <header className="relative z-20 flex items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
        <Link
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
          to="/"
          aria-label="Archboard home"
        >
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <span className="rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          Local demo
        </span>

        <div
          className="group absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium shadow-sm sm:flex"
          data-tone={viewState.tone}
          role="status"
        >
          <span
            className="size-1.5 rounded-full bg-primary group-data-[tone=danger]:bg-destructive group-data-[tone=success]:bg-status-success group-data-[tone=warning]:bg-status-warning"
            aria-hidden="true"
          />
          <span>{viewState.label}</span>
        </div>

        <div className="ml-auto flex items-center gap-0.5" aria-label="Board actions">
          <IconButton
            className="max-sm:hidden"
            label="Undo — unavailable while loading"
            variant="ghost"
            disabled
          >
            <Undo2 />
          </IconButton>
          <IconButton
            className="max-sm:hidden"
            label="Redo — unavailable while loading"
            variant="ghost"
            disabled
          >
            <Redo2 />
          </IconButton>
          <IconButton
            className="max-sm:hidden"
            label="Reset demo — unavailable while loading"
            variant="ghost"
            disabled
          >
            <RotateCcw />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-border max-sm:hidden" aria-hidden="true" />
          <IconButton
            label={`Theme: ${preference}. Switch to ${nextTheme}.`}
            variant="ghost"
            onClick={cyclePreference}
          >
            <ThemeIcon />
          </IconButton>
          <IconButton
            label="Open keyboard help"
            variant="ghost"
            onClick={() => actions.openDialog('help')}
          >
            <CircleHelp />
          </IconButton>
        </div>
      </header>

      <div
        className={cn(
          'grid min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[17rem_minmax(0,1fr)_20rem]',
          !paletteOpen && 'md:grid-cols-[3.5rem_minmax(0,1fr)_20rem]',
          !inspectorOpen && 'md:grid-cols-[17rem_minmax(0,1fr)_3.5rem]',
          !paletteOpen && !inspectorOpen && 'md:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem]',
        )}
        data-palette={paletteOpen ? 'open' : 'closed'}
        data-inspector={inspectorOpen ? 'open' : 'closed'}
      >
        <Collapsible
          className="min-h-0 overflow-hidden border-r bg-card max-md:hidden"
          open={paletteOpen}
        >
          <div
            className={cn(
              'flex h-14 items-center border-b px-3',
              paletteOpen ? 'justify-between' : 'justify-center',
            )}
          >
            {paletteOpen && (
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Create
                </p>
                <h2 className="text-sm font-semibold">Palette</h2>
              </div>
            )}
            <IconButton
              label={paletteOpen ? 'Collapse palette' : 'Expand palette'}
              variant="ghost"
              onClick={actions.togglePalette}
            >
              {paletteOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </IconButton>
          </div>
          <CollapsibleContent className="p-3">
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              Choose a card or boundary to create it in the visible canvas.
            </p>
            <div className="grid gap-2">
              {PALETTE_ITEMS.map((item) => (
                <Button
                  type="button"
                  className="h-auto justify-start gap-3 px-3 py-3 text-left"
                  variant="outline"
                  disabled={!viewState.editable}
                  key={item.label}
                  onClick={() =>
                    item.kind === 'boundary' ? createBoundary() : createCard(item.kind)
                  }
                >
                  <item.icon aria-hidden="true" />
                  <span className="grid gap-0.5">
                    <strong className="text-xs font-medium">{item.label}</strong>
                    <small className="text-[0.7rem] font-normal text-muted-foreground">
                      {item.description}
                    </small>
                  </span>
                </Button>
              ))}
            </div>
            {creationError !== null && (
              <p className="mt-3 text-xs text-destructive" role="alert">
                {creationError}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <main
          ref={canvasContainer}
          className="relative min-w-0 overflow-hidden bg-muted/25"
          aria-labelledby="canvas-heading"
        >
          <h1 id="canvas-heading" className="sr-only">
            Local demo architecture canvas
          </h1>
          <div
            className="relative grid size-full place-items-center overflow-hidden"
            aria-describedby="canvas-status-detail"
          >
            {projection !== null && (
              <GraphCanvas
                editable={viewState.editable}
                gridSnapEnabled={gridSnapEnabled}
                minimapVisible={minimapVisible}
                onConnect={connectWithPointer}
                onGeometryCommit={commitGeometry}
                onReconnect={reconnectWithPointer}
                onViewportChange={setViewport}
                projection={projection}
              />
            )}
            {viewState.showStableSkeleton && (
              <div
                className="absolute inset-0 animate-pulse bg-[radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)] bg-[size:20px_20px] opacity-50 motion-reduce:animate-none"
                aria-hidden="true"
              >
                <span className="absolute left-[18%] top-[23%] h-28 w-44 rounded-xl border bg-card shadow-sm" />
                <span className="absolute left-[calc(18%+11rem)] top-[calc(23%+3.5rem)] h-px w-[25%] bg-border" />
                <span className="absolute right-[17%] top-[45%] h-28 w-44 rounded-xl border bg-card shadow-sm" />
              </div>
            )}
            {(viewState.showStableSkeleton ||
              viewState.phase === EDITOR_VIEW_PHASES.STORAGE_ERROR ||
              viewState.phase === EDITOR_VIEW_PHASES.RECOVERY_REQUIRED) && (
              <section
                className="absolute z-10 mx-5 grid max-w-md justify-items-center rounded-2xl border bg-card/95 px-8 py-9 text-center shadow-xl shadow-foreground/5 backdrop-blur"
                aria-label="Editor state"
              >
                <span
                  className="mb-5 grid size-12 place-items-center rounded-xl bg-primary/10"
                  aria-hidden="true"
                >
                  <BrandMark />
                </span>
                <h2 className="text-lg font-semibold tracking-tight">{viewState.label}</h2>
                <p
                  className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground"
                  id="canvas-status-detail"
                >
                  {viewState.detail}
                </p>
              </section>
            )}
            {canvasReady && projection.nodes.length === 0 && projection.boundaries.length === 0 && (
              <section className="pointer-events-none absolute z-10 rounded-xl border bg-card/90 px-6 py-5 text-center shadow-sm backdrop-blur">
                <h2 className="text-sm font-semibold">Local board is empty</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  No cards or boundaries are stored on this device yet.
                </p>
              </section>
            )}
            {viewState.phase === EDITOR_VIEW_PHASES.READ_ONLY && (
              <aside className="absolute inset-x-3 top-3 z-20 flex items-center justify-center gap-3 rounded-lg border border-status-warning/30 bg-background/90 px-3 py-2 text-xs font-medium text-status-warning-foreground backdrop-blur">
                Another tab owns editing access.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void session?.retry()}
                >
                  Retry
                </Button>
              </aside>
            )}
            {narrowScreen && (
              <aside className="absolute inset-x-3 top-3 z-20 rounded-lg border border-status-warning/30 bg-background/90 px-3 py-2 text-center text-xs font-medium text-status-warning-foreground backdrop-blur">
                This view stays read-only on narrow screens. Use a wider window to edit.
              </aside>
            )}
            {connectionNotice !== null && (
              <aside
                className="absolute bottom-3 left-1/2 z-20 max-w-md -translate-x-1/2 rounded-lg border bg-background/95 px-3 py-2 text-center text-xs font-medium shadow-sm"
                role="status"
              >
                {connectionNotice}
              </aside>
            )}
          </div>
        </main>

        <Collapsible
          className="min-h-0 overflow-hidden border-l bg-card max-md:hidden"
          open={inspectorOpen}
        >
          <div
            className={cn(
              'flex h-14 items-center gap-3 border-b px-3',
              !inspectorOpen && 'justify-center',
            )}
          >
            <IconButton
              label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
              variant="ghost"
              onClick={actions.toggleInspector}
            >
              {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </IconButton>
            {inspectorOpen && (
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Details
                </p>
                <h2 className="text-sm font-semibold">Inspector</h2>
              </div>
            )}
          </div>
          <CollapsibleContent className="h-[calc(100%-3.5rem)] overflow-y-auto">
            {selectedNode !== null && session !== null && projection !== null ? (
              <div>
                <CardInspector
                  node={selectedNode}
                  session={session}
                  disabled={!viewState.editable}
                />
                <SelectionGeometryPanel
                  projection={projection}
                  selection={selection}
                  session={session}
                  disabled={!viewState.editable}
                  onNotice={setConnectionNotice}
                />
                <div className="border-t p-4">
                  <KeyboardConnectionFlow
                    nodes={projection.nodes}
                    initialSourceId={selectedNode.id}
                    disabled={!viewState.editable}
                    onCreate={createConnection}
                  />
                </div>
              </div>
            ) : selectedEdge !== null && session !== null && projection !== null ? (
              <EdgeInspector
                edge={selectedEdge}
                nodes={projection.nodes}
                session={session}
                disabled={!viewState.editable}
                onNotice={setConnectionNotice}
              />
            ) : selectedBoundary !== null && session !== null && projection !== null ? (
              <div>
                <BoundaryInspector
                  boundary={selectedBoundary}
                  session={session}
                  disabled={!viewState.editable}
                  onNotice={setConnectionNotice}
                />
                <SelectionGeometryPanel
                  projection={projection}
                  selection={selection}
                  session={session}
                  disabled={!viewState.editable}
                  onNotice={setConnectionNotice}
                />
              </div>
            ) : session !== null &&
              projection !== null &&
              selection.some(
                ({ kind }) => kind === SELECTION_KINDS.NODE || kind === SELECTION_KINDS.BOUNDARY,
              ) ? (
              <SelectionGeometryPanel
                projection={projection}
                selection={selection}
                session={session}
                disabled={!viewState.editable}
                onNotice={setConnectionNotice}
              />
            ) : (
              <div className="grid h-full place-items-center p-5">
                <div className="grid max-w-52 justify-items-center text-center">
                  <Scan className="mb-4 size-7 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">
                    {selection.length === 0 ? 'Nothing selected' : `${selection.length} selected`}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {selection.length === 1
                      ? 'Editing for this element arrives with its dedicated tool.'
                      : 'Select one card on the canvas to inspect its properties.'}
                  </p>
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      <footer className="relative z-20 flex items-center justify-between border-t bg-background px-2 sm:px-3">
        <div className="flex items-center gap-0.5" aria-label="Canvas view controls">
          <IconButton
            label={canvasReady ? 'Zoom out' : 'Zoom out — unavailable while loading'}
            variant="ghost"
            disabled={!canvasReady}
            onClick={() => zoomTo(viewport.zoom / CANVAS_ZOOM_STEP)}
          >
            <ZoomOut />
          </IconButton>
          <span
            className="min-w-12 text-center font-mono text-[0.7rem] text-muted-foreground"
            aria-label="Current zoom"
          >
            {Math.round(viewport.zoom * PERCENT_SCALE)}%
          </span>
          <IconButton
            label={canvasReady ? 'Zoom in' : 'Zoom in — unavailable while loading'}
            variant="ghost"
            disabled={!canvasReady}
            onClick={() => zoomTo(viewport.zoom * CANVAS_ZOOM_STEP)}
          >
            <ZoomIn />
          </IconButton>
          <IconButton
            label={canvasReady ? 'Fit content' : 'Fit content — unavailable while loading'}
            variant="ghost"
            disabled={!canvasReady}
            onClick={fitContent}
          >
            <Maximize />
          </IconButton>
          <IconButton
            label={canvasReady ? 'Reset zoom' : 'Reset zoom — unavailable while loading'}
            variant="ghost"
            disabled={!canvasReady}
            onClick={resetViewport}
          >
            <RotateCcw />
          </IconButton>
        </div>
        <div className="flex items-center gap-0.5 max-[460px]:hidden" aria-label="View preferences">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={gridSnapEnabled}
            onClick={actions.toggleGridSnap}
          >
            <Grid3X3 /> Grid snap
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={minimapVisible}
            onClick={actions.toggleMinimap}
          >
            <Scan /> Minimap
          </Button>
        </div>
      </footer>

      <Dialog
        open={activeDialog === 'help'}
        onOpenChange={(open) => (open ? actions.openDialog('help') : actions.closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard help</DialogTitle>
            <DialogDescription>
              Editing shortcuts become available after the local board finishes loading.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2">
            <div className="flex items-center justify-between gap-8 border-b py-2">
              <dt>Pan canvas</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs">Space + drag</dd>
            </div>
            <div className="flex items-center justify-between gap-8 border-b py-2">
              <dt>Zoom</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs">Ctrl + scroll</dd>
            </div>
            <div className="flex items-center justify-between gap-8 py-2">
              <dt>Clear selection</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs">Escape</dd>
            </div>
          </dl>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {viewState.label}
      </p>
    </div>
  );
}
