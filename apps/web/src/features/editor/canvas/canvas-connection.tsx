import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { connectionPath } from '@archboard/export';
import type { CanvasEdge } from './projection-adapter';
import { CANVAS_EDGE_ENDPOINT_TOLERANCE, CANVAS_GEOMETRY_DIVISOR } from './canvas-config';

/** Derived routes stay outside the graph; React Flow retains selection, markers and reconnection. */
export function CanvasConnection(props: EdgeProps<CanvasEdge>) {
  const {
    id,
    data,
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerStart,
    markerEnd,
    style,
    interactionWidth,
  } = props;
  const route = data?.layout;
  const first = route?.points[0];
  const last = route?.points.at(-1);
  const current =
    first &&
    last &&
    Math.abs(first.x - sourceX) + Math.abs(first.y - sourceY) <= CANVAS_EDGE_ENDPOINT_TOLERANCE &&
    Math.abs(last.x - targetX) + Math.abs(last.y - targetY) <= CANVAS_EDGE_ENDPOINT_TOLERANCE;
  let [path] = getSmoothStepPath(props);
  if (current && route && route.points.length >= CANVAS_GEOMETRY_DIVISOR) {
    const points = route.points.map((point) => ({ ...point }));
    // Handle centers can be slightly offset by the source/target pair. Attach
    // actual measured endpoints without changing the routed interior corridors.
    if (points.length > CANVAS_GEOMETRY_DIVISOR) {
      const next = points[1]!;
      if (first.x === next.x) next.x = sourceX;
      else next.y = sourceY;
      const previous = points[points.length - CANVAS_GEOMETRY_DIVISOR]!;
      if (last.x === previous.x) previous.x = targetX;
      else previous.y = targetY;
    }
    points[0] = { x: sourceX, y: sourceY };
    points[points.length - 1] = { x: targetX, y: targetY };
    path = connectionPath(points);
  }
  const label = current ? route?.label : null;
  const edge = data?.edge;
  return (
    <>
      <g>
        <title>{edge ? [edge.label, edge.protocol].filter(Boolean).join(' / ') : ''}</title>
        <BaseEdge
          id={id}
          path={path}
          {...(markerStart ? { markerStart } : {})}
          {...(markerEnd ? { markerEnd } : {})}
          {...(style ? { style } : {})}
          {...(interactionWidth === undefined ? {} : { interactionWidth })}
        />
      </g>
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-md border border-border bg-surface-canvas px-2 py-1.5 text-xs leading-[18px] text-foreground shadow-sm"
            // The label occupies an obstacle-free world-coordinate rectangle.
            style={{
              width: label.rect.width,
              transform: `translate(-50%, -50%) translate(${label.rect.x + label.rect.width / CANVAS_GEOMETRY_DIVISOR}px, ${label.rect.y + label.rect.height / CANVAS_GEOMETRY_DIVISOR}px)`,
            }}
          >
            {label.lines.map((line, index) => (
              <span key={index} className="block truncate">
                {line}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
