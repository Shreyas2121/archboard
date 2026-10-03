import { EDITOR_VIEW_PHASES, type EditorViewState } from './editor-view-state';

export const STATUS_ANNOUNCEMENT_SETTLE_MS = 800;
export const ROUTINE_ANNOUNCEMENT_INTERVAL_MS = 10_000;

export function statusAnnouncement(state: EditorViewState): { message: string; urgent: boolean } {
  const pending =
    state.phase === EDITOR_VIEW_PHASES.SYNCING || state.phase === EDITOR_VIEW_PHASES.SAVING;
  return {
    // Counts, remote edits and individual receipts must not produce separate announcements.
    message: pending
      ? 'Changes are pending. Keep this board open while saving.'
      : `${state.label}. ${state.detail}`,
    urgent: !state.editable && !state.showStableSkeleton,
  };
}

export class StatusAnnouncementGate {
  private lastMessage = '';
  private nextRoutineAt = 0;
  public delay(now: number, urgent: boolean): number {
    return Math.max(STATUS_ANNOUNCEMENT_SETTLE_MS, urgent ? 0 : this.nextRoutineAt - now);
  }
  public accept(message: string, now: number): string | null {
    if (message === this.lastMessage) return null;
    this.lastMessage = message;
    this.nextRoutineAt = now + ROUTINE_ANNOUNCEMENT_INTERVAL_MS;
    return message;
  }
}
