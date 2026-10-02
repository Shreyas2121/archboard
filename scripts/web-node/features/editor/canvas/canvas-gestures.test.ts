import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';

import { CanvasGestures, reconcileCanvasNodes } from '@/features/editor/canvas/canvas-gestures';

const INITIAL_WIDTH = 240;
const RESIZED_WIDTH = 320;
const PEER_WIDTH = 480;
const DRAG_X = 100;
const PEER_Y = 50;
const node = (id: string, x = 0, width = INITIAL_WIDTH): Node => ({
  id,
  position: { x, y: 0 },
  data: { title: id },
  style: { width },
});

describe('canvas gesture reconciliation', () => {
  it('retains only the active geometry while merging remote changes and deletion', () => {
    const gestures = new CanvasGestures();
    gestures.begin(['a']);
    const current = [node('a', DRAG_X), node('b')];
    const projection = [node('a'), { ...node('b', 0, PEER_WIDTH), position: { x: 0, y: PEER_Y } }];
    const merged = reconcileCanvasNodes(current, projection, gestures.activeIds);
    expect(merged[0]?.position.x).toBe(DRAG_X);
    expect(merged[1]).toBe(projection[1]);
    const deleted = reconcileCanvasNodes(merged, [projection[1]!], gestures.activeIds);
    gestures.retain(new Set(deleted.map(({ id }) => id)));
    expect(deleted.map(({ id }) => id)).toEqual(['b']);
    expect(gestures.finish(['a'])).toBe(false);
  });

  it('protects a resize and restores rejected geometry at completion', () => {
    const gestures = new CanvasGestures();
    gestures.begin(['a']);
    const current = [node('a', 0, RESIZED_WIDTH), node('b')];
    const canonical = [node('a'), node('b', 0, PEER_WIDTH)];
    const during = reconcileCanvasNodes(current, canonical, gestures.activeIds);
    expect(during[0]?.style?.width).toBe(RESIZED_WIDTH);
    expect(during[1]?.style?.width).toBe(PEER_WIDTH);
    expect(gestures.finish(['a'])).toBe(true);
    expect(reconcileCanvasNodes(during, canonical, gestures.activeIds)).toEqual(canonical);
  });

  it('cancels gestures on permission loss and ignores their late completion', () => {
    const gestures = new CanvasGestures();
    gestures.begin(['a', 'b']);
    gestures.cancel();
    const canonical = [node('a'), node('b')];
    expect(
      reconcileCanvasNodes([node('a', DRAG_X), node('b')], canonical, gestures.activeIds),
    ).toEqual(canonical);
    expect(gestures.finish(['a', 'b'])).toBe(false);
  });
});
