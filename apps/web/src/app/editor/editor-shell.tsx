import { useCallback, useRef, useState } from 'react';
import {
  MAX_GRAPH_COORDINATE,
  NODE_KINDS,
  handleSchema,
  type NodeKind,
} from '@archboard/contracts';
import {
  Download,
  Grid3X3,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Scan,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useReactFlow, type Connection, type Viewport } from '@xyflow/react';
import { BrandMark } from '@/app/components/brand-mark';
import { IconButton } from '@/app/components/icon-button';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import type { EditorSession } from '@/features/editor/application';
import { DEFAULT_BOUNDARY_SIZE, createBoundaryObject } from '@/features/editor/boundaries';
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
import { downloadRecoveryArtifact } from '@/features/editor/demo';
import {
  createClipboardNote,
  shortcutModifierLabel,
  useEditorCommands,
} from '@/features/editor/history';
import {
  createConnectionEdge,
  createReplacementEdge,
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
import { EDITOR_VIEW_PHASES } from './editor-view-state';
import { EditorDialogs } from './editor-dialogs';
import { EditorInspector } from './editor-inspector';
import { EditorToolbar } from './editor-toolbar';
import { editorSessionViewState } from './editor-status-policy';
import { PALETTE_ITEMS } from './editor-palette-definitions';
import type { EditorShellProps } from './editor-composition-types';

const PERCENT_SCALE = 100;
const HALF = 2;
const CREATION_OFFSET = 32;
const CREATION_OFFSET_STEPS = 6;

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

export function EditorShell({
  narrowScreen,
  session,
  sessionSnapshot,
  boardTitle,
}: EditorShellProps) {
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
  const [resetPending, setResetPending] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [serverReloadOpen, setServerReloadOpen] = useState(false);
  const [serverReloadPending, setServerReloadPending] = useState(false);
  const [serverReloadError, setServerReloadError] = useState<string | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const storageButtonRef = useRef<HTMLButtonElement>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const boardMode = boardTitle !== undefined;
  const viewState = editorSessionViewState(
    sessionSnapshot,
    narrowScreen,
    boardMode,
    session?.canEdit() ?? false,
  );
  const projection = sessionSnapshot?.projection ?? null;
  const canvasReady = projection !== null;
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
    (batch: Parameters<EditorSession['setGeometry']>[0]) => {
      if (session === null || !viewState.editable || !session.canEdit()) return null;
      try {
        session.setGeometry(batch);
        setConnectionNotice('Geometry updated.');
        return session.getSnapshot().projection;
      } catch {
        setConnectionNotice('The geometry exceeds the shared coordinate or size limits.');
        return null;
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

  const createNoteFromClipboard = useCallback(
    (text: string): void => {
      if (session === null || !viewState.editable) return;
      const container = canvasContainer.current;
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      const size = CARD_SIZES[NODE_KINDS.NOTE];
      const position = {
        x: Math.max(
          -MAX_GRAPH_COORDINATE,
          Math.min(
            MAX_GRAPH_COORDINATE,
            (rect.width / HALF - viewport.x) / viewport.zoom - size.width / HALF,
          ),
        ),
        y: Math.max(
          -MAX_GRAPH_COORDINATE,
          Math.min(
            MAX_GRAPH_COORDINATE,
            (rect.height / HALF - viewport.y) / viewport.zoom - size.height / HALF,
          ),
        ),
      };
      const note = createClipboardNote(crypto.randomUUID(), position, text);
      session.createCard(note);
      actions.setSelection([{ id: note.id, kind: SELECTION_KINDS.NODE }]);
    },
    [actions, session, viewState.editable, viewport],
  );
  const editorCommands = useEditorCommands({
    shortcutsBlocked: activeDialog !== null || storageOpen || serverReloadOpen,
    editable: viewState.editable,
    projection,
    selection,
    session,
    sessionSnapshot,
    onCreateNote: createNoteFromClipboard,
    onFitContent: fitContent,
    onNotice: setConnectionNotice,
    onOpenHelp: () => actions.openDialog('help'),
    onZoomIn: () => zoomTo(viewport.zoom * CANVAS_ZOOM_STEP),
    onZoomOut: () => zoomTo(viewport.zoom / CANVAS_ZOOM_STEP),
    setSelection: actions.setSelection,
    clearSelection: actions.clearSelection,
  });
  const shortcutModifier = shortcutModifierLabel();
  const canReset =
    !boardMode &&
    projection !== null &&
    session !== null &&
    sessionSnapshot?.writer.writable === true;
  const downloadRecovery = useCallback((): void => {
    if (projection === null) return;
    setRecoveryError(null);
    try {
      downloadRecoveryArtifact(projection);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Recovery export failed.');
    }
  }, [projection]);
  const confirmReset = useCallback(async (): Promise<void> => {
    if (session === null || !canReset) return;
    setResetPending(true);
    setResetError(null);
    try {
      await session.resetDemo();
      actions.clearSelection();
      actions.closeDialog();
      setConnectionNotice('Local demo reset with fresh entity IDs.');
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'The local demo could not be reset.');
    } finally {
      setResetPending(false);
    }
  }, [actions, canReset, session]);
  const confirmServerReload = useCallback(async (): Promise<void> => {
    if (session === null || !session.canReloadServerVersion()) return;
    setServerReloadPending(true);
    setServerReloadError(null);
    try {
      await session.clearLocalBoardForServerReload();
      window.location.reload();
    } catch {
      setServerReloadError(
        'The local board could not be cleared. Your local data was left in place.',
      );
      setServerReloadPending(false);
    }
  }, [session]);

  return (
    <div
      className="grid h-dvh min-h-[36rem] grid-rows-[3.5rem_minmax(0,1fr)_2.75rem] overflow-hidden bg-background"
      data-phase={viewState.phase}
    >
      <EditorToolbar
        boardMode={boardMode}
        boardTitle={boardTitle}
        viewState={viewState}
        editorCommands={editorCommands}
        shortcutModifier={shortcutModifier}
        canReset={canReset}
        resetButtonRef={resetButtonRef}
        storageButtonRef={storageButtonRef}
        helpButtonRef={helpButtonRef}
        actions={actions}
        session={session}
        projection={projection}
        setStorageOpen={setStorageOpen}
        downloadRecovery={downloadRecovery}
        serverReloadPending={serverReloadPending}
        setServerReloadOpen={setServerReloadOpen}
      />

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
            {boardMode ? `${boardTitle} architecture canvas` : 'Local demo architecture canvas'}
          </h1>
          <div
            className="relative grid size-full place-items-center overflow-hidden"
            aria-describedby="canvas-status-detail"
          >
            {projection !== null && (
              <GraphCanvas
                presence={session?.presence ?? null}
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
              viewState.phase === EDITOR_VIEW_PHASES.UNAVAILABLE ||
              (viewState.phase === EDITOR_VIEW_PHASES.CONNECTING &&
                boardMode &&
                !sessionSnapshot?.hasLocalCopy) ||
              viewState.phase === EDITOR_VIEW_PHASES.STORAGE_ERROR ||
              viewState.phase === EDITOR_VIEW_PHASES.RECOVERY_REQUIRED ||
              viewState.phase === EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED ||
              viewState.phase === EDITOR_VIEW_PHASES.SCHEMA_UNSUPPORTED ||
              viewState.phase === EDITOR_VIEW_PHASES.VALIDATION_REJECTED) && (
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
                {viewState.phase === EDITOR_VIEW_PHASES.STORAGE_ERROR &&
                  sessionSnapshot?.writer.persistence?.diagnostic && (
                    <p className="mt-2 max-w-sm text-sm text-destructive">
                      {sessionSnapshot.writer.persistence.diagnostic}
                    </p>
                  )}
                {projection !== null &&
                  (viewState.phase === EDITOR_VIEW_PHASES.STORAGE_ERROR ||
                    viewState.phase === EDITOR_VIEW_PHASES.RECOVERY_REQUIRED ||
                    viewState.phase === EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED ||
                    viewState.phase === EDITOR_VIEW_PHASES.SCHEMA_UNSUPPORTED) && (
                    <Button type="button" className="mt-5" onClick={downloadRecovery}>
                      <Download /> Download in-memory recovery
                    </Button>
                  )}
                {recoveryError && (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    {recoveryError}
                  </p>
                )}
              </section>
            )}
            {canvasReady &&
              (!boardMode || sessionSnapshot?.hasLocalCopy) &&
              projection.nodes.length === 0 &&
              projection.boundaries.length === 0 && (
                <section className="pointer-events-none absolute z-10 rounded-xl border bg-card/90 px-6 py-5 text-center shadow-sm backdrop-blur">
                  <h2 className="text-sm font-semibold">
                    {boardMode ? 'Board is empty' : 'Local board is empty'}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {boardMode
                      ? 'Create a card to begin mapping this architecture.'
                      : 'No cards or boundaries are stored on this device yet.'}
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
            {boardMode &&
              (viewState.phase === EDITOR_VIEW_PHASES.VIEWER ||
                viewState.phase === EDITOR_VIEW_PHASES.ARCHIVED ||
                viewState.phase === EDITOR_VIEW_PHASES.ACCESS_CHANGED ||
                viewState.phase === EDITOR_VIEW_PHASES.SESSION_EXPIRED) && (
                <aside
                  className="absolute inset-x-3 top-3 z-20 rounded-lg border border-status-warning/30 bg-background/90 px-3 py-2 text-center text-xs font-medium text-status-warning-foreground backdrop-blur"
                  role="status"
                >
                  {viewState.detail}
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
            {recoveryError !== null &&
              viewState.phase !== EDITOR_VIEW_PHASES.STORAGE_ERROR &&
              viewState.phase !== EDITOR_VIEW_PHASES.RECOVERY_REQUIRED &&
              viewState.phase !== EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED &&
              viewState.phase !== EDITOR_VIEW_PHASES.SCHEMA_UNSUPPORTED && (
                <aside
                  className="absolute inset-x-3 bottom-3 z-20 rounded-lg border bg-background px-3 py-2 text-center text-sm text-destructive"
                  role="alert"
                >
                  {recoveryError}
                </aside>
              )}
          </div>
        </main>

        <EditorInspector
          inspectorOpen={inspectorOpen}
          actions={actions}
          editorCommands={editorCommands}
          viewState={viewState}
          session={session}
          projection={projection}
          selection={selection}
          setConnectionNotice={setConnectionNotice}
          createConnection={createConnection}
        />
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

      <EditorDialogs
        storageOpen={storageOpen}
        setStorageOpen={setStorageOpen}
        session={session}
        sessionSnapshot={sessionSnapshot}
        storageButtonRef={storageButtonRef}
        editorCommands={editorCommands}
        boardMode={boardMode}
        activeDialog={activeDialog}
        resetPending={resetPending}
        setResetError={setResetError}
        actions={actions}
        resetButtonRef={resetButtonRef}
        resetError={resetError}
        projection={projection}
        downloadRecovery={downloadRecovery}
        canReset={canReset}
        confirmReset={confirmReset}
        serverReloadOpen={serverReloadOpen}
        serverReloadPending={serverReloadPending}
        setServerReloadOpen={setServerReloadOpen}
        setServerReloadError={setServerReloadError}
        serverReloadError={serverReloadError}
        confirmServerReload={confirmServerReload}
        helpButtonRef={helpButtonRef}
        shortcutModifier={shortcutModifier}
      />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {viewState.label}
      </p>
    </div>
  );
}
