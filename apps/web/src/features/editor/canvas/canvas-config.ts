import type { Viewport } from '@xyflow/react';

export const CANVAS_GRID_SIZE = 16;
export const CANVAS_MIN_ZOOM = 0.25;
export const CANVAS_MAX_ZOOM = 2;
export const CANVAS_FIT_PADDING = 0.12;
export const CANVAS_ZOOM_STEP = 1.2;
const EDGE_LABEL_PADDING_HORIZONTAL = 6;
const EDGE_LABEL_PADDING_VERTICAL = 4;
export const CANVAS_EDGE_LABEL_PADDING: [number, number] = [
  EDGE_LABEL_PADDING_HORIZONTAL,
  EDGE_LABEL_PADDING_VERTICAL,
];

export const DEFAULT_CANVAS_VIEWPORT: Readonly<Viewport> = Object.freeze({
  x: 0,
  y: 0,
  zoom: 1,
});
