import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export const SELECTION_KINDS = {
  NODE: 'node',
  EDGE: 'edge',
  BOUNDARY: 'boundary',
} as const;

export type SelectionKind = (typeof SELECTION_KINDS)[keyof typeof SELECTION_KINDS];

export interface SelectionReference {
  readonly id: string;
  readonly kind: SelectionKind;
}

export type EditorDialog = 'help' | 'reset' | null;

interface EditorUiActions {
  readonly initializePalette: (open: boolean) => void;
  readonly togglePalette: () => void;
  readonly toggleInspector: () => void;
  readonly toggleMinimap: () => void;
  readonly toggleGridSnap: () => void;
  readonly setSelection: (selection: readonly SelectionReference[]) => void;
  readonly clearSelection: () => void;
  readonly openDialog: (dialog: Exclude<EditorDialog, null>) => void;
  readonly closeDialog: () => void;
}

export interface EditorUiState {
  readonly paletteInitialized: boolean;
  readonly paletteOpen: boolean;
  readonly inspectorOpen: boolean;
  readonly minimapVisible: boolean;
  readonly gridSnapEnabled: boolean;
  readonly selection: readonly SelectionReference[];
  readonly activeDialog: EditorDialog;
  readonly actions: EditorUiActions;
}

export function createEditorUiStore() {
  return createStore<EditorUiState>()((set) => ({
    paletteInitialized: false,
    paletteOpen: true,
    inspectorOpen: true,
    minimapVisible: false,
    gridSnapEnabled: true,
    selection: [],
    activeDialog: null,
    actions: {
      initializePalette: (paletteOpen) =>
        set((state) =>
          state.paletteInitialized ? state : { paletteOpen, paletteInitialized: true },
        ),
      togglePalette: () =>
        set((state) => ({ paletteOpen: !state.paletteOpen, paletteInitialized: true })),
      toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
      toggleMinimap: () => set((state) => ({ minimapVisible: !state.minimapVisible })),
      toggleGridSnap: () => set((state) => ({ gridSnapEnabled: !state.gridSnapEnabled })),
      setSelection: (selection) => set({ selection: [...selection] }),
      clearSelection: () => set({ selection: [] }),
      openDialog: (activeDialog) => set({ activeDialog }),
      closeDialog: () => set({ activeDialog: null }),
    },
  }));
}

const editorUiStore = createEditorUiStore();

export const useEditorUiActions = (): EditorUiActions =>
  useStore(editorUiStore, (state) => state.actions);

export const usePaletteOpen = (): boolean => useStore(editorUiStore, (state) => state.paletteOpen);

export const useInspectorOpen = (): boolean =>
  useStore(editorUiStore, (state) => state.inspectorOpen);

export const useMinimapVisible = (): boolean =>
  useStore(editorUiStore, (state) => state.minimapVisible);

export const useGridSnapEnabled = (): boolean =>
  useStore(editorUiStore, (state) => state.gridSnapEnabled);

export const useEditorSelection = (): readonly SelectionReference[] =>
  useStore(editorUiStore, (state) => state.selection);

export const useActiveEditorDialog = (): EditorDialog =>
  useStore(editorUiStore, (state) => state.activeDialog);
