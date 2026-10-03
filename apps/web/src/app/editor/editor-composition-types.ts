import type { ReactNode, RefObject } from 'react';
import type { GraphProjection } from '@archboard/contracts';
import type { EditorSession, EditorSessionSnapshot } from '@/features/editor/application';
import type { EditorCommandActions } from '@/features/editor/history/history-types';
import type { useEditorUiActions, SelectionReference, EditorDialog } from '@/features/editor/state';
import type { ConnectionEndpoints } from '@/features/editor/connections';
import type { EditorViewState } from './editor-view-state';
type Actions = ReturnType<typeof useEditorUiActions>;
type ButtonRef = RefObject<HTMLButtonElement | null>;
export interface EditorToolbarProps {
  readonly boardPanels?: ReactNode;
  readonly imageExport?: ReactNode;
  readonly portability?: ReactNode;
  readonly presentation?: ReactNode;
  readonly sharing?: ReactNode;
  readonly boardMode: boolean;
  readonly boardTitle: string | undefined;
  readonly viewState: EditorViewState;
  readonly editorCommands: EditorCommandActions;
  readonly shortcutModifier: string;
  readonly canReset: boolean;
  readonly resetButtonRef: ButtonRef;
  readonly storageButtonRef: ButtonRef;
  readonly helpButtonRef: ButtonRef;
  readonly actions: Actions;
  readonly session: EditorSession | null;
  readonly projection: GraphProjection | null;
  readonly setStorageOpen: (open: boolean) => void;
  readonly downloadRecovery: () => void;
  readonly serverReloadPending: boolean;
  readonly setServerReloadOpen: (open: boolean) => void;
}
export interface EditorInspectorProps {
  readonly narrowScreen: boolean;
  readonly compactOpen: boolean;
  readonly setCompactOpen: (open: boolean) => void;
  readonly presentation?: ReactNode;
  readonly discussion?: ReactNode;
  readonly inspectorOpen: boolean;
  readonly actions: Actions;
  readonly editorCommands: EditorCommandActions;
  readonly viewState: EditorViewState;
  readonly session: EditorSession | null;
  readonly projection: GraphProjection | null;
  readonly selection: readonly SelectionReference[];
  readonly setConnectionNotice: (notice: string) => void;
  readonly createConnection: (endpoints: ConnectionEndpoints) => string | null;
}
export interface EditorDialogsProps {
  readonly storageOpen: boolean;
  readonly setStorageOpen: (open: boolean) => void;
  readonly session: EditorSession | null;
  readonly sessionSnapshot: EditorSessionSnapshot | null;
  readonly storageButtonRef: ButtonRef;
  readonly editorCommands: EditorCommandActions;
  readonly boardMode: boolean;
  readonly activeDialog: EditorDialog;
  readonly resetPending: boolean;
  readonly setResetError: (error: string | null) => void;
  readonly actions: Actions;
  readonly resetButtonRef: ButtonRef;
  readonly resetError: string | null;
  readonly projection: GraphProjection | null;
  readonly downloadRecovery: () => void;
  readonly canReset: boolean;
  readonly confirmReset: () => Promise<void>;
  readonly serverReloadOpen: boolean;
  readonly serverReloadPending: boolean;
  readonly setServerReloadOpen: (open: boolean) => void;
  readonly setServerReloadError: (error: string | null) => void;
  readonly serverReloadError: string | null;
  readonly confirmServerReload: () => Promise<void>;
  readonly helpButtonRef: ButtonRef;
  readonly shortcutModifier: string;
}

export interface EditorShellProps {
  readonly boardDescription?: string;
  readonly portability?: ReactNode;
  readonly portabilityOpen?: boolean;
  readonly sharing?: ReactNode;
  readonly sharingOpen?: boolean;
  readonly narrowScreen: boolean;
  readonly session: EditorSession | null;
  readonly sessionSnapshot: EditorSessionSnapshot | null;
  readonly boardTitle?: string;
}
