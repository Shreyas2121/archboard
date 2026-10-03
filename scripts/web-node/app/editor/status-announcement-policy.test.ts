import { expect, it } from 'vitest';
import { editorViewState, EDITOR_VIEW_PHASES } from '@/app/editor/editor-view-state';
import {
  statusAnnouncement,
  StatusAnnouncementGate,
  ROUTINE_ANNOUNCEMENT_INTERVAL_MS,
  STATUS_ANNOUNCEMENT_SETTLE_MS,
} from '@/app/editor/status-announcement-policy';

it('coalesces pending counts and receipts while retaining permission/storage meanings', () => {
  const syncing = editorViewState(EDITOR_VIEW_PHASES.SYNCING);
  expect(statusAnnouncement({ ...syncing, label: 'Syncing 1 change' }).message).toBe(
    statusAnnouncement({ ...syncing, label: 'Syncing 10 changes' }).message,
  );
  for (const phase of [
    EDITOR_VIEW_PHASES.VIEWER,
    EDITOR_VIEW_PHASES.ARCHIVED,
    EDITOR_VIEW_PHASES.STORAGE_ERROR,
    EDITOR_VIEW_PHASES.SAVED_ON_DEVICE_OFFLINE,
  ]) {
    const state = editorViewState(phase);
    expect(statusAnnouncement(state).message).toContain(state.detail);
  }
});
it('deduplicates repeated states and bounds routine announcements without delaying important states by the routine budget', () => {
  const gate = new StatusAnnouncementGate();
  expect(gate.accept('Saved on device', 0)).toBe('Saved on device');
  expect(gate.accept('Saved on device', 1)).toBeNull();
  expect(gate.delay(1, false)).toBe(ROUTINE_ANNOUNCEMENT_INTERVAL_MS - 1);
  expect(gate.delay(1, true)).toBe(STATUS_ANNOUNCEMENT_SETTLE_MS);
  expect(gate.accept('Access changed; retained changes can be exported', 1)).toContain(
    'Access changed',
  );
});
