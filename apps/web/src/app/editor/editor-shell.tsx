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

import { BrandMark } from '@/app/components/brand-mark';
import { IconButton } from '@/app/components/icon-button';
import { useNarrowScreen } from '@/app/hooks/use-narrow-screen';
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
import {
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
}

const PALETTE_ITEMS: readonly PaletteItem[] = [
  { label: 'Component', description: 'Service or application', icon: Box },
  { label: 'Code', description: 'Module or repository', icon: Code2 },
  { label: 'Schema', description: 'Data contract or store', icon: Database },
  { label: 'Note', description: 'Context for the team', icon: StickyNote },
  { label: 'Boundary', description: 'Group related systems', icon: Braces },
];

export function EditorShell() {
  const narrowScreen = useNarrowScreen();
  const paletteOpen = usePaletteOpen();
  const inspectorOpen = useInspectorOpen();
  const selection = useEditorSelection();
  const minimapVisible = useMinimapVisible();
  const gridSnapEnabled = useGridSnapEnabled();
  const activeDialog = useActiveEditorDialog();
  const actions = useEditorUiActions();
  const { preference, cyclePreference } = useTheme();
  const viewState = editorViewState(
    narrowScreen ? EDITOR_VIEW_PHASES.NARROW_SCREEN : EDITOR_VIEW_PHASES.LOADING,
  );

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
              Drag an element onto the canvas to begin.
            </p>
            <div className="grid gap-2">
              {PALETTE_ITEMS.map((item) => (
                <Button
                  type="button"
                  className="h-auto justify-start gap-3 px-3 py-3 text-left"
                  variant="outline"
                  disabled={!viewState.editable}
                  key={item.label}
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
          </CollapsibleContent>
        </Collapsible>

        <main
          className="relative min-w-0 overflow-hidden bg-muted/25"
          aria-labelledby="canvas-heading"
        >
          <h1 id="canvas-heading" className="sr-only">
            Local demo architecture canvas
          </h1>
          <div
            className="relative grid size-full place-items-center overflow-hidden bg-[radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)] bg-[size:20px_20px]"
            aria-describedby="canvas-status-detail"
          >
            <div
              className="absolute left-3 top-3 rounded-md border bg-background/85 px-2 py-1 font-mono text-[0.65rem] text-muted-foreground backdrop-blur max-md:hidden"
              aria-hidden="true"
            >
              <span>0, 0</span>
            </div>
            {viewState.showStableSkeleton && (
              <div
                className="absolute inset-0 animate-pulse opacity-50 motion-reduce:animate-none"
                aria-hidden="true"
              >
                <span className="absolute left-[18%] top-[23%] h-28 w-44 rounded-xl border bg-card shadow-sm" />
                <span className="absolute left-[calc(18%+11rem)] top-[calc(23%+3.5rem)] h-px w-[25%] bg-border" />
                <span className="absolute right-[17%] top-[45%] h-28 w-44 rounded-xl border bg-card shadow-sm" />
              </div>
            )}
            <section
              className="relative z-10 mx-5 grid max-w-md justify-items-center rounded-2xl border bg-card/95 px-8 py-9 text-center shadow-xl shadow-foreground/5 backdrop-blur"
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
            {narrowScreen && (
              <aside className="absolute inset-x-3 top-3 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-center text-xs font-medium text-status-warning-foreground">
                This view stays read-only on narrow screens. Use a wider window to edit.
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
          <CollapsibleContent className="grid h-[calc(100%-3.5rem)] place-items-center p-5">
            <div className="grid max-w-52 justify-items-center text-center">
              <Scan className="mb-4 size-7 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold">
                {selection.length === 0 ? 'Nothing selected' : `${selection.length} selected`}
              </h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Select an element on the canvas to inspect its properties.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <footer className="relative z-20 flex items-center justify-between border-t bg-background px-2 sm:px-3">
        <div className="flex items-center gap-0.5" aria-label="Canvas view controls">
          <IconButton label="Zoom out — unavailable while loading" variant="ghost" disabled>
            <ZoomOut />
          </IconButton>
          <span
            className="min-w-12 text-center font-mono text-[0.7rem] text-muted-foreground"
            aria-label="Current zoom"
          >
            100%
          </span>
          <IconButton label="Zoom in — unavailable while loading" variant="ghost" disabled>
            <ZoomIn />
          </IconButton>
          <IconButton label="Fit view — unavailable while loading" variant="ghost" disabled>
            <Maximize />
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
