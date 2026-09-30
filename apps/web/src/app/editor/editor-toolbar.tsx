import {
  CircleHelp,
  Download,
  HardDrive,
  Monitor,
  Moon,
  Redo2,
  RotateCcw,
  Sun,
  Undo2,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { BrandMark } from '@/app/components/brand-mark';
import { IconButton } from '@/app/components/icon-button';
import { THEME_PREFERENCES, useTheme } from '@/app/theme/theme-provider';

import type { EditorToolbarProps } from './editor-composition-types';
export function EditorToolbar({
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
  const { preference, cyclePreference } = useTheme();
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
    <>
      <header className="relative z-20 flex items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
        <Link
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
          to={boardMode ? '/boards' : '/'}
          aria-label={boardMode ? 'Back to your boards' : 'Archboard home'}
        >
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <span className="max-w-48 truncate rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          {boardMode ? boardTitle : 'Local demo'}
        </span>

        <div
          className="group absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium shadow-sm md:flex"
          data-tone={viewState.tone}
          role="status"
        >
          <span
            className="size-1.5 rounded-full bg-primary group-data-[tone=danger]:bg-destructive group-data-[tone=success]:bg-status-success group-data-[tone=warning]:bg-status-warning"
            aria-hidden="true"
          />
          <span>{viewState.label}</span>
        </div>

        <span
          className="ml-auto max-w-32 truncate text-xs text-muted-foreground md:hidden"
          role="status"
          aria-live="polite"
        >
          {viewState.label}
        </span>

        <div className="ml-auto flex items-center gap-0.5" aria-label="Board actions">
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
          <IconButton
            label={`Theme: ${preference}. Switch to ${nextTheme}.`}
            variant="ghost"
            onClick={cyclePreference}
          >
            <ThemeIcon />
          </IconButton>
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
