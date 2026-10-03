import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BrowserClipboard } from '@/platform/clipboard';
import {
  EDITOR_CANCEL_GESTURES,
  shouldIgnoreEditorShortcut,
  editorViewShortcut,
} from './editor-shortcuts';
import { SELECTION_KINDS, type SelectionReference } from '@/features/editor/state';

import { DELETE_CONFIRMATION_THRESHOLD, PASTE_OFFSET } from './history-constants';
import type {
  EditorCommandActions,
  SelectionClipboardPayload,
  UseEditorCommandsOptions,
} from './history-types';
import {
  captureSelection,
  parseSelection,
  preparePastedSelection,
  serializeSelection,
} from './selection-clipboard';

function isEmptyPayload(payload: SelectionClipboardPayload): boolean {
  return payload.nodes.length + payload.edges.length + payload.boundaries.length === 0;
}

export function useEditorCommands(options: UseEditorCommandsOptions): EditorCommandActions {
  const {
    shortcutsBlocked,
    editable,
    projection,
    selection,
    session,
    sessionSnapshot,
    onCreateNote,
    onFitContent,
    onNotice,
    onObjectsDeleted,
    onOpenHelp,
    onZoomIn,
    onZoomOut,
    setSelection,
    clearSelection,
  } = options;
  const clipboard = useMemo(() => new BrowserClipboard(), []);
  const pasteSequence = useRef({ text: '', count: 0 });
  const [pendingDeletion, setPendingDeletion] = useState<readonly SelectionReference[] | null>(
    null,
  );

  useEffect(() => {
    clipboard.clear();
    pasteSequence.current = { text: '', count: 0 };
    return () => clipboard.clear();
  }, [clipboard, session]);

  const createFromPayload = useCallback(
    (payload: SelectionClipboardPayload, serialized: string): boolean => {
      if (session === null || !editable || isEmptyPayload(payload)) {
        onNotice('Choose at least one card or boundary to duplicate or paste.');
        return false;
      }
      const count = pasteSequence.current.text === serialized ? pasteSequence.current.count + 1 : 1;
      try {
        const pasted = preparePastedSelection(payload, count, () => crypto.randomUUID());
        session.createObjects(pasted.batch);
        pasteSequence.current = { text: serialized, count };
        setSelection(pasted.selection);
        onNotice(
          `Created ${pasted.selection.length} objects with a ${count * PASTE_OFFSET}-unit offset.`,
        );
        return true;
      } catch (error) {
        onNotice(error instanceof Error ? error.message : 'The selection could not be created.');
        return false;
      }
    },
    [editable, onNotice, session, setSelection],
  );

  const duplicateSelection = useCallback((): void => {
    if (projection === null) return;
    const payload = captureSelection(projection, selection);
    createFromPayload(payload, serializeSelection(payload));
  }, [createFromPayload, projection, selection]);

  const copySelection = useCallback(async (): Promise<void> => {
    if (projection === null) return;
    const payload = captureSelection(projection, selection);
    if (isEmptyPayload(payload)) {
      onNotice('Choose at least one card or boundary to copy.');
      return;
    }
    const serialized = serializeSelection(payload);
    const result = await clipboard.writeText(serialized);
    pasteSequence.current = { text: serialized, count: 0 };
    onNotice(
      result.systemWritten
        ? 'Selection copied to the system clipboard.'
        : 'System clipboard access was denied. A session-local copy is available until reload.',
    );
  }, [clipboard, onNotice, projection, selection]);

  const pasteSelection = useCallback(async (): Promise<void> => {
    const result = await clipboard.readText();
    if (result === null) {
      onNotice('Clipboard access was denied and no session-local copy is available.');
      return;
    }
    const payload = parseSelection(result.text);
    if (payload === null) {
      onNotice(
        'Clipboard content is not a supported Archboard selection. Use Paste as note for text.',
      );
      return;
    }
    const created = createFromPayload(payload, result.text);
    if (created && result.systemDenied) {
      onNotice('Clipboard access was denied; pasted the session-local selection.');
    }
  }, [clipboard, createFromPayload, onNotice]);

  const pasteAsNote = useCallback(async (): Promise<void> => {
    const result = await clipboard.readText();
    if (result === null || result.source !== 'system') {
      onNotice('System clipboard access was denied. Paste as note requires readable plain text.');
      return;
    }
    try {
      onCreateNote(result.text);
      onNotice('Clipboard text pasted as a note.');
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Clipboard text could not be pasted as a note.',
      );
    }
  }, [clipboard, onCreateNote, onNotice]);

  const deleteSelection = useCallback(
    (references: readonly SelectionReference[]): void => {
      if (session === null || !editable) return;
      try {
        session.deleteObjects({
          nodeIds: references
            .filter(({ kind }) => kind === SELECTION_KINDS.NODE)
            .map(({ id }) => id),
          edgeIds: references
            .filter(({ kind }) => kind === SELECTION_KINDS.EDGE)
            .map(({ id }) => id),
          boundaryIds: references
            .filter(({ kind }) => kind === SELECTION_KINDS.BOUNDARY)
            .map(({ id }) => id),
        });
        clearSelection();
        onObjectsDeleted?.();
        onNotice('Objects deleted. Restore deleted objects is available until reload or reset.');
      } catch (error) {
        onNotice(error instanceof Error ? error.message : 'The selection could not be deleted.');
      }
    },
    [clearSelection, editable, onNotice, onObjectsDeleted, session],
  );

  const requestDelete = useCallback((): void => {
    if (selection.length === 0) return;
    if (selection.length > DELETE_CONFIRMATION_THRESHOLD) setPendingDeletion([...selection]);
    else deleteSelection(selection);
  }, [deleteSelection, selection]);
  const confirmDelete = useCallback((): void => {
    if (pendingDeletion !== null) deleteSelection(pendingDeletion);
    setPendingDeletion(null);
  }, [deleteSelection, pendingDeletion]);
  const cancelDelete = useCallback((): void => setPendingDeletion(null), []);

  const restoreDeletion = useCallback((): void => {
    if (session === null || !editable) return;
    try {
      const restored = session.restoreDeletion();
      if (restored === null) return;
      setSelection([
        ...restored.nodes.map(({ id }) => ({ id, kind: SELECTION_KINDS.NODE }) as const),
        ...restored.edges.map(({ id }) => ({ id, kind: SELECTION_KINDS.EDGE }) as const),
        ...restored.boundaries.map(({ id }) => ({ id, kind: SELECTION_KINDS.BOUNDARY }) as const),
      ]);
      onNotice('Deleted objects restored with fresh IDs. Original tombstones were retained.');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Deleted objects could not be restored.');
    }
  }, [editable, onNotice, session, setSelection]);

  const changeHistory = useCallback(
    (direction: 'undo' | 'redo'): void => {
      if (session === null || !editable) return;
      const result = direction === 'undo' ? session.undo() : session.redo();
      onNotice(
        result === 'applied'
          ? `${direction === 'undo' ? 'Undo' : 'Redo'} applied.`
          : result === 'skipped-deleted-target'
            ? `Skipped ${direction}: its target has been deleted.`
            : `Nothing to ${direction}.`,
      );
    },
    [editable, onNotice, session],
  );
  const undo = useCallback(() => changeHistory('undo'), [changeHistory]);
  const redo = useCallback(() => changeHistory('redo'), [changeHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreEditorShortcut(event, document, shortcutsBlocked || pendingDeletion !== null))
        return;
      if (event.altKey) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const viewCommand = editorViewShortcut(event);
      if (event.key === 'Escape') {
        window.dispatchEvent(new Event(EDITOR_CANCEL_GESTURES));
        clearSelection();
      } else if (editable && (event.key === 'Delete' || event.key === 'Backspace')) requestDelete();
      else if (editable && modifier && key === 'd') duplicateSelection();
      else if (modifier && key === 'c') void copySelection();
      else if (editable && modifier && key === 'v') void pasteSelection();
      else if (editable && modifier && key === 'z' && event.shiftKey) redo();
      else if (editable && modifier && key === 'z') undo();
      else if (viewCommand === 'fit') onFitContent();
      else if (viewCommand === 'zoom-in') onZoomIn();
      else if (viewCommand === 'zoom-out') onZoomOut();
      else if (viewCommand === 'help') onOpenHelp();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    shortcutsBlocked,
    pendingDeletion,
    clearSelection,
    copySelection,
    duplicateSelection,
    editable,
    onFitContent,
    onOpenHelp,
    onZoomIn,
    onZoomOut,
    pasteSelection,
    redo,
    requestDelete,
    undo,
  ]);

  return {
    canCopySelection: projection !== null && selection.length > 0,
    canRestoreDeletion: sessionSnapshot?.canRestoreDeletion ?? false,
    canUndo: sessionSnapshot?.canUndo ?? false,
    canRedo: sessionSnapshot?.canRedo ?? false,
    deleteConfirmationOpen: pendingDeletion !== null,
    duplicateSelection,
    copySelection,
    pasteSelection,
    pasteAsNote,
    requestDelete,
    confirmDelete,
    cancelDelete,
    restoreDeletion,
    undo,
    redo,
  };
}
