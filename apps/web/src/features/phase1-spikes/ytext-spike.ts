import type * as Y from 'yjs';

import { bindYText, type YTextBinding } from './ytext-binding.js';

export interface YTextSpike extends YTextBinding {
  readonly container: HTMLElement;
}

/** Test-only mountable harness; this is not the Archboard card editor. */
export function mountYTextSpike(container: HTMLElement, text: Y.Text): YTextSpike {
  const label = document.createElement('label');
  label.textContent = 'Phase 1 Y.Text binding spike';
  const control = document.createElement('textarea');
  control.setAttribute('aria-label', 'Phase 1 Y.Text binding spike');
  control.rows = 3;
  label.append(control);
  container.append(label);

  const binding = bindYText(control, text);
  return {
    ...binding,
    container,
    dispose: () => {
      binding.dispose();
      label.remove();
    },
  };
}
