import { ViewportPortal } from '@xyflow/react';

import type { CanvasBoundary } from './projection-adapter';

interface BoundaryLayerProps {
  readonly boundaries: readonly CanvasBoundary[];
}

export function BoundaryLayer({ boundaries }: BoundaryLayerProps) {
  return (
    <ViewportPortal>
      <div className="pointer-events-none absolute inset-0 -z-10" data-canvas-layer="boundaries">
        {boundaries.map((boundary) => (
          <section
            className="absolute rounded-2xl border-2 border-dashed border-border bg-muted/20 p-3 text-muted-foreground"
            data-boundary-id={boundary.id}
            data-color={boundary.color}
            key={boundary.id}
            // World geometry must be supplied to React Flow's transformed viewport at runtime.
            style={{
              transform: `translate(${boundary.rect.x}px, ${boundary.rect.y}px)`,
              width: boundary.rect.width,
              height: boundary.rect.height,
            }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em]">{boundary.title}</h2>
          </section>
        ))}
      </div>
    </ViewportPortal>
  );
}
