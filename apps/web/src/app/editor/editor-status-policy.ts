import { BOARD_ROLES, ERROR_CODES } from '@archboard/contracts';
import {
  LOCAL_PERSISTENCE_PHASES,
  SYNC_PHASES,
  WRITER_SESSION_PHASES,
} from '@archboard/sync-client';
import type { EditorSessionSnapshot } from '@/features/editor/application';
import { EDITOR_VIEW_PHASES, editorViewState, type EditorViewState } from './editor-view-state';
export function phaseForSession(
  snapshot: EditorSessionSnapshot | null,
  narrowScreen: boolean,
  boardMode: boolean,
): (typeof EDITOR_VIEW_PHASES)[keyof typeof EDITOR_VIEW_PHASES] {
  if (snapshot?.initializationError) return EDITOR_VIEW_PHASES.RECOVERY_REQUIRED;
  if (snapshot?.preparingDemo) return EDITOR_VIEW_PHASES.SEEDING;
  if (snapshot?.projection === null || snapshot === null) return EDITOR_VIEW_PHASES.LOADING;

  const persistence = snapshot.writer.persistence;
  if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR) {
    return EDITOR_VIEW_PHASES.STORAGE_ERROR;
  }
  if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED) {
    return EDITOR_VIEW_PHASES.RECOVERY_REQUIRED;
  }
  if (boardMode) {
    if (snapshot.sync?.errorCode === ERROR_CODES.UNAUTHENTICATED)
      return EDITOR_VIEW_PHASES.SESSION_EXPIRED;
    if (snapshot.sync?.errorCode === ERROR_CODES.SCHEMA_UNSUPPORTED)
      return EDITOR_VIEW_PHASES.SCHEMA_UNSUPPORTED;
    if (
      snapshot.sync?.errorCode === ERROR_CODES.DOCUMENT_INVALID ||
      snapshot.sync?.errorCode === ERROR_CODES.DOCUMENT_LIMIT ||
      snapshot.sync?.errorCode === ERROR_CODES.VALIDATION_ERROR
    )
      return EDITOR_VIEW_PHASES.VALIDATION_REJECTED;
    if (snapshot.accessDenied || snapshot.sync?.phase === SYNC_PHASES.ACCESS_CHANGED)
      return EDITOR_VIEW_PHASES.ACCESS_CHANGED;
    if (snapshot.sync?.phase === SYNC_PHASES.STORAGE_ERROR) return EDITOR_VIEW_PHASES.STORAGE_ERROR;
    if (snapshot.sync?.phase === SYNC_PHASES.RECOVERY_REQUIRED)
      return EDITOR_VIEW_PHASES.RECOVERY_REQUIRED;
    if (snapshot.archived) return EDITOR_VIEW_PHASES.ARCHIVED;
    if (snapshot.boardRole === BOARD_ROLES.VIEWER) return EDITOR_VIEW_PHASES.VIEWER;
  }
  if (narrowScreen) return EDITOR_VIEW_PHASES.NARROW_SCREEN;
  if (snapshot.writer.phase === WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE) {
    return EDITOR_VIEW_PHASES.READ_ONLY;
  }
  if (snapshot.writer.phase === WRITER_SESSION_PHASES.UNSUPPORTED) {
    return EDITOR_VIEW_PHASES.READ_ONLY_UNSUPPORTED;
  }
  if (boardMode) {
    const sync = snapshot.sync;
    if (
      !snapshot.hasLocalCopy &&
      (sync?.phase === SYNC_PHASES.OFFLINE_CACHED ||
        sync?.phase === SYNC_PHASES.SAVED_ON_DEVICE_OFFLINE)
    ) {
      return EDITOR_VIEW_PHASES.UNAVAILABLE;
    }
    if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.SAVING) return EDITOR_VIEW_PHASES.SAVING;
    if (sync?.phase === SYNC_PHASES.SYNCING) return EDITOR_VIEW_PHASES.SYNCING;
    if (sync?.phase === SYNC_PHASES.SAVED_TO_SERVER) return EDITOR_VIEW_PHASES.SAVED_TO_SERVER;
    if (sync?.phase === SYNC_PHASES.SAVED_ON_DEVICE_OFFLINE)
      return EDITOR_VIEW_PHASES.SAVED_ON_DEVICE_OFFLINE;
    if (sync?.phase === SYNC_PHASES.OFFLINE_CACHED) return EDITOR_VIEW_PHASES.OFFLINE_CACHED;
    return EDITOR_VIEW_PHASES.CONNECTING;
  }
  if (persistence?.phase === LOCAL_PERSISTENCE_PHASES.SAVING) {
    return EDITOR_VIEW_PHASES.SAVING;
  }
  if (persistence?.savedOnDevice) return EDITOR_VIEW_PHASES.SAVED;
  return snapshot.writer.writable ? EDITOR_VIEW_PHASES.WRITABLE : EDITOR_VIEW_PHASES.LOADING;
}

export function editorSessionViewState(
  snapshot: EditorSessionSnapshot | null,
  narrowScreen: boolean,
  boardMode: boolean,
  canEdit: boolean,
): EditorViewState {
  const base = editorViewState(phaseForSession(snapshot, narrowScreen, boardMode));
  return boardMode
    ? {
        ...base,
        editable: base.phase !== EDITOR_VIEW_PHASES.UNAVAILABLE && !narrowScreen && canEdit,
        label:
          base.phase === EDITOR_VIEW_PHASES.SYNCING
            ? `Syncing ${snapshot?.sync?.pendingCount ?? 0} changes…`
            : base.label,
      }
    : base;
}
