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
  CONNECTING: 'connecting',
  SYNCING: 'syncing',
  SAVED_TO_SERVER: 'saved-to-server',
  SAVED_ON_DEVICE_OFFLINE: 'saved-on-device-offline',
  OFFLINE_CACHED: 'offline-cached',
  VIEWER: 'viewer',
  ARCHIVED: 'archived',
  ACCESS_CHANGED: 'access-changed',
  SESSION_EXPIRED: 'session-expired',
  SCHEMA_UNSUPPORTED: 'schema-unsupported',
  VALIDATION_REJECTED: 'validation-rejected',
  UNAVAILABLE: 'unavailable',
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
  [EDITOR_VIEW_PHASES.CONNECTING]: {
    phase: EDITOR_VIEW_PHASES.CONNECTING,
    label: 'Connecting…',
    detail: 'Checking current board access and merging the server version.',
    tone: 'neutral',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SYNCING]: {
    phase: EDITOR_VIEW_PHASES.SYNCING,
    label: 'Syncing changes…',
    detail: 'Local changes are waiting for durable server receipts.',
    tone: 'neutral',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SAVED_TO_SERVER]: {
    phase: EDITOR_VIEW_PHASES.SAVED_TO_SERVER,
    label: 'Saved to server',
    detail: 'The server acknowledged all locally committed changes.',
    tone: 'success',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SAVED_ON_DEVICE_OFFLINE]: {
    phase: EDITOR_VIEW_PHASES.SAVED_ON_DEVICE_OFFLINE,
    label: 'Saved on this device · offline',
    detail: 'Local changes are queued. Server durability is unknown until reconnection.',
    tone: 'warning',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.OFFLINE_CACHED]: {
    phase: EDITOR_VIEW_PHASES.OFFLINE_CACHED,
    label: 'Offline · cached copy',
    detail: 'This device has a board copy; current server changes are unknown.',
    tone: 'warning',
    editable: true,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.VIEWER]: {
    phase: EDITOR_VIEW_PHASES.VIEWER,
    label: 'Read-only · viewer',
    detail: 'Your current board role permits viewing only.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.ARCHIVED]: {
    phase: EDITOR_VIEW_PHASES.ARCHIVED,
    label: 'Read-only · archived',
    detail: 'This board is archived. Local changes remain available for recovery.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.ACCESS_CHANGED]: {
    phase: EDITOR_VIEW_PHASES.ACCESS_CHANGED,
    label: 'Access changed · local changes preserved',
    detail: 'Editing and sending are paused. Download local recovery if needed.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SESSION_EXPIRED]: {
    phase: EDITOR_VIEW_PHASES.SESSION_EXPIRED,
    label: 'Session expired · local changes preserved',
    detail: 'Sign in online before sending changes. Download local recovery if needed.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.SCHEMA_UNSUPPORTED]: {
    phase: EDITOR_VIEW_PHASES.SCHEMA_UNSUPPORTED,
    label: 'App update required · local changes preserved',
    detail:
      'This board uses a newer graph format. Update the app before editing or sending; local recovery is available.',
    tone: 'danger',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.VALIDATION_REJECTED]: {
    phase: EDITOR_VIEW_PHASES.VALIDATION_REJECTED,
    label: 'Change rejected · local changes preserved',
    detail:
      'Sending is paused at the rejected change. Download local recovery; later changes cannot safely skip it.',
    tone: 'danger',
    editable: false,
    showStableSkeleton: false,
  },
  [EDITOR_VIEW_PHASES.UNAVAILABLE]: {
    phase: EDITOR_VIEW_PHASES.UNAVAILABLE,
    label: 'Board unavailable offline',
    detail: 'No local copy is available. Reconnect to open this board.',
    tone: 'warning',
    editable: false,
    showStableSkeleton: false,
  },
};

export function editorViewState(phase: EditorViewPhase): EditorViewState {
  return EDITOR_VIEW_STATES[phase];
}
