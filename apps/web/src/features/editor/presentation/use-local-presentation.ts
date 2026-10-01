import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getViewportForBounds, useReactFlow } from '@xyflow/react';
import type { PresentationStep } from '@archboard/contracts';
import type { EditorSession } from '@/features/editor/application';
import { shouldIgnoreEditorShortcut } from '@/features/editor/history/editor-shortcuts';
import { adjacentStep, presentationShortcut, sortedSteps } from './presentation-model';
import { PRESENTATION_MIN_ZOOM } from './presentation-model';
import { CANVAS_MAX_ZOOM } from '@/features/editor/canvas/canvas-config';

export function useLocalPresentation(
  session: EditorSession | null,
  steps: readonly PresentationStep[],
  blocked: boolean,
  canvas: RefObject<HTMLDivElement | null>,
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusFrame = useRef<number | null>(null);
  const flow = useReactFlow();
  const step = steps.find(({ id }) => id === activeId) ?? null;
  const exit = useCallback(() => {
    setActiveId(null);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : document.getElementById('present-local');
      if (target instanceof HTMLButtonElement && target.disabled)
        document.getElementById('architecture-canvas')?.focus();
      else target?.focus();
    });
  }, []);
  useEffect(() => {
    setActiveId(null);
    returnFocus.current = null;
    return () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, [session]);
  const start = useCallback(
    (id: string) => {
      if (!steps.some((candidate) => candidate.id === id)) return;
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setActiveId(id);
    },
    [steps],
  );
  const navigate = useCallback(
    (direction: -1 | 1) => {
      if (activeId === null) return;
      const next = adjacentStep(steps, activeId, direction);
      if (next !== null) setActiveId(next);
    },
    [steps, activeId],
  );
  // Depend on geometry values, not projection identity: unrelated edits must not undo a local pan.
  const { x, y, width, height } = step?.rect ?? {};
  useEffect(() => {
    const element = canvas.current;
    if (
      element === null ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    )
      return;
    const fit = () => {
      const size = element.getBoundingClientRect();
      if (size.width > 0 && size.height > 0)
        void flow.setViewport(
          getViewportForBounds(
            { x, y, width, height },
            size.width,
            size.height,
            PRESENTATION_MIN_ZOOM,
            CANVAS_MAX_ZOOM,
            0,
          ),
          { duration: 0 },
        );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas, flow, activeId, x, y, width, height]);
  useEffect(() => {
    if (activeId === null) return;
    const keydown = (event: KeyboardEvent) => {
      if (shouldIgnoreEditorShortcut(event, document, blocked)) return;
      const command = presentationShortcut(event);
      if (command === null) return;
      event.preventDefault();
      if (command === 'exit') exit();
      else navigate(command === 'next' ? 1 : -1);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeId, blocked, exit, navigate]);
  const ordered = sortedSteps(steps);
  return {
    activeId,
    step,
    ordered,
    start,
    exit,
    navigate,
    choose: setActiveId,
    presenting: activeId !== null,
  };
}
