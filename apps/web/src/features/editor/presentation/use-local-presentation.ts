import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getViewportForBounds, useReactFlow } from '@xyflow/react';
import type { PresentationStep } from '@archboard/contracts';
import type { EditorSession, EditorSessionSnapshot } from '@/features/editor/application';
import { shouldIgnoreEditorShortcut } from '@/features/editor/history/editor-shortcuts';
import {
  adjacentStep,
  presentationShortcut,
  sortedSteps,
  PRESENTATION_MIN_ZOOM,
} from './presentation-model';
import { CANVAS_MAX_ZOOM } from '@/features/editor/canvas/canvas-config';
import { usePresenterFollowing } from './use-presenter-following';
import { resolveFollowedStep } from './presenter-follow-model';

export function useLocalPresentation(
  session: EditorSession | null,
  steps: readonly PresentationStep[],
  blocked: boolean,
  canvas: RefObject<HTMLDivElement | null>,
  snapshot: EditorSessionSnapshot | null = null,
  liveEditable = true,
) {
  const live = usePresenterFollowing(session, snapshot);
  const { model } = live;
  const [local, setLocal] = useState<{
    model: typeof model;
    activeId: string | null;
    presenting: boolean;
  }>({ model, activeId: null, presenting: false });
  const [notice, setNotice] = useState<{ model: typeof model; message: string } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusFrame = useRef<number | null>(null);
  const preserveViewport = useRef(false);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const flow = useReactFlow();
  const activeId = live.following
    ? live.state.lease.stepId
    : local.model === model
      ? local.activeId
      : null;
  const presenting = live.following || (local.model === model && local.presenting);
  const step = live.following
    ? resolveFollowedStep(live.state, steps, Date.now())
    : (steps.find(({ id }) => id === activeId) ?? null);
  const eligible = live.eligible && liveEditable;
  const canBroadcast = live.canBroadcast && liveEditable;

  useEffect(() => {
    let previous = model.getSnapshot();
    return model.subscribe(() => {
      const next = model.getSnapshot();
      if (previous.following && !next.following) {
        // Keep the last valid followed step as local navigation, without moving the viewport.
        preserveViewport.current = true;
        const retainedId = previous.lease.stepId;
        setLocal((current) => ({
          model,
          presenting: true,
          activeId: stepsRef.current.some(({ id }) => id === retainedId)
            ? retainedId
            : current.model === model
              ? current.activeId
              : null,
        }));
      }
      previous = next;
    });
  }, [model]);
  useEffect(() => {
    returnFocus.current = null;
    return () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, [model]);
  const rememberFocus = () => {
    if (focusFrame.current !== null) {
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    }
    if (!presenting)
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const broadcast = useCallback(
    (id: string | null) => {
      if (!live.ownsLease || id === null) return;
      if (!canBroadcast) {
        setNotice({ model, message: 'Wait for local steps to sync before broadcasting.' });
        return;
      }
      if (!live.transport?.select(id))
        setNotice({ model, message: 'The live step could not be sent. Check your connection.' });
      else setNotice(null);
    },
    [live.ownsLease, live.transport, canBroadcast, model],
  );
  const choose = useCallback(
    (id: string) => {
      if (!stepsRef.current.some((candidate) => candidate.id === id)) return;
      model.unfollow();
      preserveViewport.current = false;
      setLocal({ model, activeId: id, presenting: true });
      broadcast(id);
    },
    [model, broadcast],
  );
  const start = (id: string) => {
    rememberFocus();
    choose(id);
  };
  const follow = () => {
    rememberFocus();
    preserveViewport.current = false;
    if (model.follow(Date.now()))
      setLocal((current) => ({
        model,
        activeId: current.model === model ? current.activeId : null,
        presenting: true,
      }));
  };
  const exit = useCallback(() => {
    model.unfollow();
    if (live.ownsLease) live.transport?.release();
    setLocal({ model, activeId: null, presenting: false });
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : document.getElementById('present-local');
      if (target instanceof HTMLButtonElement && target.disabled)
        document.getElementById('architecture-canvas')?.focus();
      else target?.focus();
    });
  }, [model, live.ownsLease, live.transport]);
  const navigate = useCallback(
    (direction: -1 | 1) => {
      if (activeId === null || live.following) return;
      const next = adjacentStep(stepsRef.current, activeId, direction);
      if (next !== null) choose(next);
    },
    [activeId, live.following, choose],
  );
  const acquire = () => {
    if (!eligible || !live.transport?.acquire())
      setNotice({ model, message: 'Live presenting is unavailable in this view.' });
    else setNotice(null);
  };
  const release = () => {
    if (live.ownsLease) live.transport?.release();
  };
  const waiting =
    live.following && step === null
      ? live.state.lease.stepId === null
        ? 'Waiting for the presenter to choose a step.'
        : 'The presenter step is unavailable. Waiting for it to synchronize.'
      : null;

  // Geometry, step identity and explicit opt-in drive fitting; heartbeat/projection identity do not.
  const { x, y, width, height } = step?.rect ?? {};
  useEffect(() => {
    const element = canvas.current;
    if (
      !presenting ||
      element === null ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    )
      return;
    const fit = () => {
      // Local camera ownership persists through resize/remote edits until an explicit step choice.
      if (preserveViewport.current) return;
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
    if (!preserveViewport.current) fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas, flow, model, presenting, activeId, live.following, x, y, width, height]);
  useEffect(() => {
    if (!presenting) return;
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
  }, [presenting, blocked, exit, navigate]);
  const pan = useCallback(() => {
    preserveViewport.current = true;
    model.unfollow();
  }, [model]);
  return {
    activeId,
    step,
    ordered: sortedSteps(steps),
    start,
    exit,
    navigate,
    choose,
    presenting,
    following: live.following,
    follow,
    unfollow: () => model.unfollow(),
    pan,
    live: live.live,
    holder: live.holder,
    ownsLease: live.ownsLease,
    eligible,
    canBroadcast,
    acquire,
    release,
    broadcast: () => broadcast(activeId),
    waiting,
    notice: live.denied
      ? 'Presenter request denied. Another connection may hold the lease, or the step is not committed.'
      : notice?.model === model
        ? notice.message
        : null,
  };
}
