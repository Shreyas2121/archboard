import { HANDLES, type Handle as GraphHandle } from '@archboard/contracts';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';

import type { CanvasNode } from './projection-adapter';

const HANDLE_POSITIONS: Readonly<Record<GraphHandle, Position>> = {
  [HANDLES.TOP]: Position.Top,
  [HANDLES.RIGHT]: Position.Right,
  [HANDLES.BOTTOM]: Position.Bottom,
  [HANDLES.LEFT]: Position.Left,
};

const TARGET_HANDLE_CLASSES: Readonly<Record<GraphHandle, string>> = {
  [HANDLES.TOP]: '!left-[calc(50%-0.3rem)]',
  [HANDLES.RIGHT]: '!top-[calc(50%-0.3rem)]',
  [HANDLES.BOTTOM]: '!left-[calc(50%+0.3rem)]',
  [HANDLES.LEFT]: '!top-[calc(50%+0.3rem)]',
};

const SOURCE_HANDLE_CLASSES: Readonly<Record<GraphHandle, string>> = {
  [HANDLES.TOP]: '!left-[calc(50%+0.3rem)]',
  [HANDLES.RIGHT]: '!top-[calc(50%+0.3rem)]',
  [HANDLES.BOTTOM]: '!left-[calc(50%-0.3rem)]',
  [HANDLES.LEFT]: '!top-[calc(50%-0.3rem)]',
};

const HANDLE_CLASS = '!size-2.5 !border-2 !border-background !bg-primary';

export function ProjectionNode({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <article
      className={cn(
        'grid size-full content-start overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-sm',
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
      data-color={data.color}
      data-kind={data.kind}
    >
      {Object.values(HANDLES).flatMap((handle) => [
        <Handle
          className={cn(HANDLE_CLASS, TARGET_HANDLE_CLASSES[handle])}
          id={handle}
          isConnectable={false}
          key={`target-${handle}`}
          position={HANDLE_POSITIONS[handle]}
          type="target"
        />,
        <Handle
          className={cn(HANDLE_CLASS, SOURCE_HANDLE_CLASSES[handle])}
          id={handle}
          isConnectable={false}
          key={`source-${handle}`}
          position={HANDLE_POSITIONS[handle]}
          type="source"
        />,
      ])}
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {data.kind}
      </p>
      <h2 className="mt-1 text-sm font-semibold leading-5">{data.title || 'Untitled card'}</h2>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
        Card details become available in the inspector.
      </p>
    </article>
  );
}
