import { MAX_RECT_DIMENSION, type Boundary, type Rect } from '@archboard/contracts';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';

const MIN_BOUNDARY_DIMENSION = 32;
const COLOR_CLASSES: Readonly<Record<Boundary['color'], string>> = {
  gray: 'border-graph-gray/70 bg-graph-gray/10',
  blue: 'border-graph-blue/70 bg-graph-blue/10',
  teal: 'border-graph-teal/70 bg-graph-teal/10',
  green: 'border-graph-green/70 bg-graph-green/10',
  amber: 'border-graph-amber/70 bg-graph-amber/10',
  red: 'border-graph-red/70 bg-graph-red/10',
  violet: 'border-graph-violet/70 bg-graph-violet/10',
};

export interface BoundaryCanvasData extends Record<string, unknown> {
  readonly boundary: Boundary;
  readonly editable: boolean;
  readonly onResizeEnd: (id: string, rect: Rect) => void;
}

export type BoundaryCanvasNode = Node<BoundaryCanvasData, 'graph-boundary'>;

export function BoundaryNode({ data, selected }: NodeProps<BoundaryCanvasNode>) {
  return (
    <section
      className={cn(
        'pointer-events-none size-full rounded-2xl border-2 border-dashed p-3 text-muted-foreground',
        COLOR_CLASSES[data.boundary.color],
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
      data-boundary-id={data.boundary.id}
    >
      <NodeResizer
        isVisible={selected && data.editable}
        minWidth={MIN_BOUNDARY_DIMENSION}
        minHeight={MIN_BOUNDARY_DIMENSION}
        maxWidth={MAX_RECT_DIMENSION}
        maxHeight={MAX_RECT_DIMENSION}
        handleClassName="!pointer-events-auto !size-3 !border-2 !border-background !bg-primary"
        lineClassName="!pointer-events-auto !border-primary"
        onResizeEnd={(_event, rect) => data.onResizeEnd(data.boundary.id, rect)}
      />
      <header className="boundary-drag-handle pointer-events-auto inline-flex cursor-move rounded-md bg-background/85 px-2 py-1 shadow-sm">
        <h2 className="max-w-72 truncate text-xs font-semibold uppercase tracking-[0.14em]">
          {data.boundary.title || 'Untitled boundary'}
        </h2>
      </header>
    </section>
  );
}
