export const COMPACT_EDITOR_QUERY = '(min-width: 768px) and (max-width: 1023px)';

// Canvas content stays below reserved notices; toolbar/footer are above canvas overlays.
// Radix dialogs/menus retain the shared z-50 layer. No notice uses an independent overlay layer.
// Application updates reserve a row above routes; dialogs portal above that row and canvas controls.
