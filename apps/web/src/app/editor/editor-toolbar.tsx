import { CircleHelp, Download, HardDrive, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { BrandMark } from '@/app/components/brand-mark';
import { IconButton } from '@/app/components/icon-button';
import { ThemeControl } from '@/app/components/theme-control';

import type { EditorToolbarProps } from './editor-composition-types';
export function EditorToolbar({
  portability,
  presentation,
  sharing,
  boardMode,
  boardTitle,
  viewState,
  editorCommands,
  shortcutModifier,
  canReset,
  resetButtonRef,
  storageButtonRef,
  helpButtonRef,
  actions,
  session,
  projection,
  setStorageOpen,
  downloadRecovery,
  serverReloadPending,
  setServerReloadOpen,
}: EditorToolbarProps) {
  return (
    <>
      <header className="relative z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b bg-surface-panel px-3 sm:px-4">
        <div className="flex min-w-0 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              className="flex shrink-0 items-center gap-2 text-sm font-semibold max-lg:[&>span:first-child]:size-5"
              to={boardMode ? '/boards' : '/'}
              aria-label={boardMode ? 'Back to your boards' : 'Archboard home'}
            >
              <BrandMark />
              <span className="max-sm:hidden">Archboard</span>
            </Link>
            <span className="text-muted-foreground" aria-hidden="true">
              /
            </span>
            <span
              className="min-w-0 truncate text-sm font-medium lg:max-w-64"
              title={boardMode ? boardTitle : 'Local demo'}
            >
              {boardMode ? boardTitle : 'Local demo'}
            </span>
          </div>
          <div
            className="group flex min-w-0 items-start gap-2 text-xs leading-4 text-muted-foreground"
            data-tone={viewState.tone}
            role="status"
          >
            <span
              className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground group-data-[tone=danger]:bg-destructive group-data-[tone=success]:bg-status-success group-data-[tone=warning]:bg-status-warning"
              aria-hidden="true"
            />
            <span className="min-w-0 line-clamp-2 break-words" title={viewState.label}>
              {viewState.label}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5" aria-label="Board actions">
          {presentation}
          {sharing}
          {portability}
          <IconButton
            className="max-sm:hidden"
            label={`Undo (${shortcutModifier}+Z)`}
            variant="ghost"
            disabled={!viewState.editable || !editorCommands.canUndo}
            onClick={editorCommands.undo}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            className="max-sm:hidden"
            label={`Redo (${shortcutModifier}+Shift+Z)`}
            variant="ghost"
            disabled={!viewState.editable || !editorCommands.canRedo}
            onClick={editorCommands.redo}
          >
            <Redo2 />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-border max-sm:hidden" aria-hidden="true" />
          {!boardMode && (
            <IconButton
              ref={resetButtonRef}
              className="max-sm:hidden"
              label={canReset ? 'Reset local demo' : 'Reset demo unavailable in this view'}
              variant="ghost"
              disabled={!canReset}
              onClick={() => actions.openDialog('reset')}
            >
              <RotateCcw />
            </IconButton>
          )}
          <IconButton
            ref={storageButtonRef}
            label="Local storage status"
            variant="ghost"
            disabled={session === null}
            onClick={() => setStorageOpen(true)}
          >
            <HardDrive />
          </IconButton>
          <IconButton
            className="max-sm:hidden"
            label={
              projection === null
                ? 'Download recovery unavailable while loading'
                : 'Download local recovery'
            }
            variant="ghost"
            disabled={projection === null}
            onClick={downloadRecovery}
          >
            <Download />
          </IconButton>
          {boardMode && (
            <IconButton
              className="max-sm:hidden"
              label={
                session?.canReloadServerVersion()
                  ? 'Reload server version'
                  : 'Reconnect before reloading the server version'
              }
              variant="ghost"
              disabled={!session?.canReloadServerVersion() || serverReloadPending}
              onClick={() => setServerReloadOpen(true)}
            >
              <RotateCcw />
            </IconButton>
          )}
          <span className="mx-1 h-5 w-px bg-border max-sm:hidden" aria-hidden="true" />
          <ThemeControl compact />
          <IconButton
            ref={helpButtonRef}
            label="Open keyboard help"
            variant="ghost"
            onClick={() => actions.openDialog('help')}
          >
            <CircleHelp />
          </IconButton>
        </div>
      </header>
    </>
  );
}
