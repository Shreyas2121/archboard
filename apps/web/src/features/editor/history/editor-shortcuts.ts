export const EDITOR_CANCEL_GESTURES = 'archboard:editor-cancel-gestures';

export function editorViewShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): 'fit' | 'zoom-in' | 'zoom-out' | 'help' | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key.toLowerCase() === 'f') return 'fit';
  if (event.key === '+' || event.key === '=') return 'zoom-in';
  if (event.key === '-') return 'zoom-out';
  return event.key === '?' ? 'help' : null;
}

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
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}
