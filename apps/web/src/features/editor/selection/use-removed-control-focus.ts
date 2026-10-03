import { useLayoutEffect, useRef, type FocusEvent } from 'react';
import { shouldRecoverObjectFocus } from './object-navigation';

/** A remote deletion must not strand focus on body or steal focus from another panel/modal. */
export function useRemovedControlFocus(fallbackId: string) {
  const root = useRef<HTMLDivElement>(null);
  const lastControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const modal = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (
      shouldRecoverObjectFocus(
        lastControl.current !== null &&
          (!lastControl.current.isConnected || lastControl.current.matches(':disabled')),
        document.activeElement === document.body,
        modal !== null && !modal.contains(root.current),
      )
    ) {
      const fallback = document.getElementById(fallbackId);
      const target = fallback?.getClientRects().length
        ? fallback
        : root.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      target?.focus();
    }
  });
  return {
    ref: root,
    onFocusCapture: (event: FocusEvent<HTMLDivElement>) => {
      lastControl.current = event.target;
    },
  };
}
