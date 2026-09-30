export const EDITOR_CANCEL_GESTURES = 'archboard:editor-cancel-gestures';

interface ShortcutEvent {
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly target: EventTarget | null;
}

/** Dialog ownership includes buttons and focus temporarily outside its content. */
export function shouldIgnoreEditorShortcut(
  event: ShortcutEvent,
  scope: Document,
  blocked = false,
): boolean {
  if (blocked || event.defaultPrevented || event.isComposing) return true;
  if (scope.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') !== null)
    return true;
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}
