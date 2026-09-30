import {
  ClipboardCopy,
  ClipboardPaste,
  CopyPlus,
  RotateCcw,
  StickyNote,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { EditorActionsPanelProps } from './history-types';

export function EditorActionsPanel({ actions, disabled }: EditorActionsPanelProps) {
  return (
    <section className="grid gap-3 border-t p-4" aria-label="Selection and clipboard actions">
      <div>
        <p className="text-xs font-medium capitalize text-muted-foreground">Object actions</p>
        <p className="mt-1 text-xs leading-4 text-muted-foreground">
          Structural commands are excluded from Undo. Deleted objects can be restored until reload.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={disabled || !actions.canCopySelection}
          onClick={actions.duplicateSelection}
        >
          <CopyPlus /> Duplicate
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={!actions.canCopySelection}
          onClick={() => void actions.copySelection()}
        >
          <ClipboardCopy /> Copy
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={disabled}
          onClick={() => void actions.pasteSelection()}
        >
          <ClipboardPaste /> Paste
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={disabled}
          onClick={() => void actions.pasteAsNote()}
        >
          <StickyNote /> Paste as note
        </Button>
        <Button
          type="button"
          size="compact"
          variant="destructive"
          disabled={disabled || !actions.canCopySelection}
          onClick={actions.requestDelete}
        >
          <Trash2 /> Delete
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={disabled || !actions.canRestoreDeletion}
          onClick={actions.restoreDeletion}
        >
          <RotateCcw /> Restore deleted
        </Button>
      </div>
    </section>
  );
}
