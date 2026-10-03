import { expect, it } from 'vitest';
import { BOARD_ROLES } from '@archboard/contracts';
import { minimalGraphFixture } from '@archboard/fixtures';
import { WRITER_SESSION_PHASES } from '@archboard/sync-client';
import type { EditorSessionSnapshot } from '@/features/editor/application';
import { editorSessionViewState, phaseForSession } from '@/app/editor/editor-status-policy';
import { EDITOR_VIEW_PHASES } from '@/app/editor/editor-view-state';

const ready: EditorSessionSnapshot = {
  revision: 0,
  textBindingGeneration: 0,
  writer: {
    documentGeneration: 0,
    phase: WRITER_SESSION_PHASES.WRITER,
    writable: true,
    persistence: null,
    lastHint: null,
  },
  projection: minimalGraphFixture,
  initializationError: false,
  canUndo: false,
  canRedo: false,
  canRestoreDeletion: false,
  preparingDemo: false,
  boardRole: BOARD_ROLES.EDITOR,
  archived: false,
  hasLocalCopy: true,
  sync: null,
  accessDenied: false,
};

it('preserves loading, recovery, access and narrow-screen phase precedence', () => {
  expect(phaseForSession(null, false, true)).toBe(EDITOR_VIEW_PHASES.LOADING);
  expect(phaseForSession({ ...ready, initializationError: true }, true, true)).toBe(
    EDITOR_VIEW_PHASES.RECOVERY_REQUIRED,
  );
  expect(phaseForSession({ ...ready, accessDenied: true }, true, true)).toBe(
    EDITOR_VIEW_PHASES.ACCESS_CHANGED,
  );
  expect(phaseForSession({ ...ready, boardRole: BOARD_ROLES.VIEWER }, true, true)).toBe(
    EDITOR_VIEW_PHASES.VIEWER,
  );
  expect(phaseForSession(ready, true, true)).toBe(EDITOR_VIEW_PHASES.NARROW_SCREEN);
});

it('derives board editability from session authority and narrow-screen policy', () => {
  expect(editorSessionViewState(ready, false, true, true).editable).toBe(true);
  expect(editorSessionViewState(ready, false, true, false).editable).toBe(false);
  expect(editorSessionViewState(ready, true, true, true).editable).toBe(false);
});
