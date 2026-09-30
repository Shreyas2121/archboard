import { MAX_RECT_DIMENSION, type Boundary, type Rect } from '@archboard/contracts';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';

const MIN_BOUNDARY_DIMENSION = 32;
const COLOR_CLASSES: Readonly<Record<Boundary['color'], string>> = {
  gray: 'border-graph-gray/50 bg-graph-gray/5',
  blue: 'border-graph-blue/50 bg-graph-blue/5',
  teal: 'border-graph-teal/50 bg-graph-teal/5',
  green: 'border-graph-green/50 bg-graph-green/5',
  amber: 'border-graph-amber/50 bg-graph-amber/5',
  red: 'border-graph-red/50 bg-graph-red/5',
  violet: 'border-graph-violet/50 bg-graph-violet/5',
};

export interface BoundaryCanvasData extends Record<string, unknown> {
  readonly boundary: Boundary;
  readonly editable: boolean;
  readonly onResizeStart: (id: string) => void;
  readonly onResizeEnd: (id: string, rect: Rect) => void;
}

export type BoundaryCanvasNode = Node<BoundaryCanvasData, 'graph-boundary'>;

export function BoundaryNode({ data, selected }: NodeProps<BoundaryCanvasNode>) {
  return (
    <section
      className={cn(
        'pointer-events-none size-full rounded-lg border border-dashed p-2 text-muted-foreground',
        COLOR_CLASSES[data.boundary.color],
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-surface-canvas',
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
        onResizeStart={() => data.onResizeStart(data.boundary.id)}
        onResizeEnd={(_event, rect) => data.onResizeEnd(data.boundary.id, rect)}
      />
      <header className="boundary-drag-handle pointer-events-auto inline-flex max-w-full cursor-move rounded-md border bg-surface-panel px-2 py-1">
        <h2
          className="min-w-0 max-w-72 truncate text-xs font-medium leading-4"
          title={data.boundary.title || 'Untitled boundary'}
        >
          {data.boundary.title || 'Untitled boundary'}
        </h2>
      </header>
    </section>
  );
}
