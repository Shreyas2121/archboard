export const EDITOR_VIEW_PHASES = {
  LOADING: 'loading',
  SEEDING: 'seeding',
  WRITABLE: 'writable',
  READ_ONLY: 'read-only',
  READ_ONLY_UNSUPPORTED: 'read-only-unsupported',
  SAVING: 'saving',
  SAVED: 'saved',
  STORAGE_ERROR: 'storage-error',
  RECOVERY_REQUIRED: 'recovery-required',
  NARROW_SCREEN: 'narrow-screen',
} as const;

export type EditorViewPhase = (typeof EDITOR_VIEW_PHASES)[keyof typeof EDITOR_VIEW_PHASES];
export type EditorStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface EditorViewState {
  readonly phase: EditorViewPhase;
  readonly label: string;
  readonly detail: string;
  readonly tone: EditorStatusTone;
  readonly editable: boolean;
  readonly showStableSkeleton: boolean;
}

const EDITOR_VIEW_STATES: Readonly<Record<EditorViewPhase, EditorViewState>> = {
  [EDITOR_VIEW_PHASES.LOADING]: {
    phase: EDITOR_VIEW_PHASES.LOADING,
    label: 'Loading local board…',
    detail: 'Checking local ownership and opening saved device data.',
    tone: 'neutral',
    editable: false,
    showStableSkeleton: true,
  },
  [EDITOR_VIEW_PHASES.SEEDING]: {
    phase: EDITOR_VIEW_PHASES.SEEDING,
    label: 'Preparing local demo…',
    detail: 'Creating the starter architecture and saving it on this device.',
    tone: 'neutral',
    editable: false,
    showStableSkeleton: true,
  },
  [EDITOR_VIEW_PHASES.WRITABLE]: {
    phase: EDITOR_VIEW_PHASES.WRITABLE,
    label: 'Ready to edit',
    detail: 'This tab owns the local board writer lock.',
    tone: 'success',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.READ_ONLY]: {
    phase: EDITOR_VIEW_PHASES.READ_ONLY,
    label: 'Read-only · open in another tab',
    detail: 'Close the editing tab, then retry here.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED]: {
    phase: EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED,
    label: 'Read-only · browser lock unavailable',
    detail: 'This browser cannot safely claim single-writer access to the local board.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SAVING]: {
    phase: EDITOR_VIEW_PHASES.SAVING,
    label: 'Saving on this device…',
    detail: 'Local changes are waiting for their IndexedDB commit.',
    tone: 'neutral',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SAVED]: {
    phase: EDITOR_VIEW_PHASES.SAVED,
    label: 'Saved on this device',
    detail: 'All local persistence work has committed.',
    tone: 'success',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.STORAGE_ERROR]: {
    phase: EDITOR_VIEW_PHASES.STORAGE_ERROR,
    label: 'Storage error · export your changes',
    detail: 'Editing is paused. The current in-memory board remains available for recovery.',
    tone: 'danger',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.RECOVERY_REQUIRED]: {
    phase: EDITOR_VIEW_PHASES.RECOVERY_REQUIRED,
    label: 'Recovery required',
    detail: 'Stored local data could not be opened safely and was left unchanged.',
    tone: 'danger',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.NARROW_SCREEN]: {
    phase: EDITOR_VIEW_PHASES.NARROW_SCREEN,
    label: 'Read-only · desktop width required',
    detail: 'Inspect the board here, or use a wider window for full editing controls.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
};

export function editorViewState(phase: EditorViewPhase): EditorViewState {
  return EDITOR_VIEW_STATES[phase];
}
