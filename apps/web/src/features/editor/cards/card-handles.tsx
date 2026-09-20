import { HANDLES, type Handle as GraphHandle } from '@archboard/contracts';
import { Handle, Position } from '@xyflow/react';

import { cn } from '@/lib/utils';

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

export function CardHandles() {
  return Object.values(HANDLES).flatMap((handle) => [
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
  ]);
}
