export function shortcutModifierLabel(): 'Cmd' | 'Ctrl' {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
}
