import type { Boundary, GraphEdge, GraphNode, GraphProjection } from '@archboard/contracts';
import type { z } from 'zod';

import type { SelectionReference } from '@/features/editor/state';
import type { EditorSession, EditorSessionSnapshot } from '@/features/editor/application';

import type { selectionClipboardSchema } from './history-schemas';

export type SelectionClipboardPayload = z.infer<typeof selectionClipboardSchema>;

export interface PastedSelection {
  readonly batch: {
    readonly nodes: readonly GraphNode[];
    readonly edges: readonly GraphEdge[];
    readonly boundaries: readonly Boundary[];
  };
  readonly selection: readonly SelectionReference[];
}

export interface EditorCommandActions {
  readonly canCopySelection: boolean;
  readonly canRestoreDeletion: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly deleteConfirmationOpen: boolean;
  readonly duplicateSelection: () => void;
  readonly copySelection: () => Promise<void>;
  readonly pasteSelection: () => Promise<void>;
  readonly pasteAsNote: () => Promise<void>;
  readonly requestDelete: () => void;
  readonly confirmDelete: () => void;
  readonly cancelDelete: () => void;
  readonly restoreDeletion: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

export interface UseEditorCommandsOptions {
  readonly shortcutsBlocked: boolean;
  readonly editable: boolean;
  readonly projection: GraphProjection | null;
  readonly selection: readonly SelectionReference[];
  readonly session: EditorSession | null;
  readonly sessionSnapshot: EditorSessionSnapshot | null;
  readonly onCreateNote: (text: string) => void;
  readonly onFitContent: () => void;
  readonly onNotice: (message: string) => void;
  readonly onObjectsDeleted?: () => void;
  readonly onOpenHelp: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly setSelection: (selection: readonly SelectionReference[]) => void;
  readonly clearSelection: () => void;
}

export interface EditorActionsPanelProps {
  readonly actions: EditorCommandActions;
  readonly disabled: boolean;
}
