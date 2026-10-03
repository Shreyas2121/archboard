import { describe, expect, it } from 'vitest';

import { createEditorUiStore, SELECTION_KINDS } from '@/features/editor/state/editor-ui-store';

describe('initial editor palette preference', () => {
  it.each([true, false])('initializes to %s only once', (open) => {
    const store = createEditorUiStore();
    const actions = store.getState().actions;
    actions.initializePalette(open);
    expect(store.getState().paletteOpen).toBe(open);
    actions.initializePalette(!open);
    expect(store.getState().paletteOpen).toBe(open);
  });

  it('retains a user expansion after compact initial entry and subsequent initialization', () => {
    const store = createEditorUiStore();
    const actions = store.getState().actions;
    actions.initializePalette(false);
    actions.togglePalette();
    actions.initializePalette(false);
    expect(store.getState().paletteOpen).toBe(true);
  });

  it('retains a user toggle made before initial entry defaults are applied', () => {
    const store = createEditorUiStore();
    const actions = store.getState().actions;
    actions.togglePalette();
    actions.initializePalette(true);
    expect(store.getState().paletteOpen).toBe(false);
  });

  it('does not change inspector, view preferences, selection, or open dialogs when initializing', () => {
    const store = createEditorUiStore();
    const actions = store.getState().actions;
    actions.toggleInspector();
    actions.toggleMinimap();
    actions.toggleGridSnap();
    actions.setSelection([{ id: 'selected-card', kind: SELECTION_KINDS.NODE }]);
    actions.openDialog('help');
    const before = store.getState();
    actions.initializePalette(false);
    expect(store.getState()).toMatchObject({
      inspectorOpen: before.inspectorOpen,
      minimapVisible: before.minimapVisible,
      gridSnapEnabled: before.gridSnapEnabled,
      selection: before.selection,
      activeDialog: before.activeDialog,
      actions,
    });
  });
});
