import {
  MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
} from '@archboard/contracts';
import { NodeResizer, type NodeProps } from '@xyflow/react';

import type { CanvasNode } from '@/features/editor/canvas/projection-adapter';

import { CodeCard } from './code-card';
import { ComponentCard } from './component-card';
import { NoteCard } from './note-card';
import { SchemaCard } from './schema-card';

export function CardNode({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.node;
  const card =
    node.kind === 'component' ? (
      <ComponentCard node={node} selected={selected} />
    ) : node.kind === 'code' ? (
      <CodeCard node={node} selected={selected} />
    ) : node.kind === 'schema' ? (
      <SchemaCard node={node} selected={selected} />
    ) : (
      <NoteCard node={node} selected={selected} />
    );
  return (
    <>
      <NodeResizer
        isVisible={selected && data.editable === true}
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        maxWidth={MAX_NODE_WIDTH}
        maxHeight={MAX_NODE_HEIGHT}
        handleClassName="!z-20 !size-3 !border-2 !border-background !bg-primary"
        lineClassName="!border-primary"
        onResizeEnd={(_event, rect) => data.onResizeEnd?.(node.id, rect)}
      />
      {card}
    </>
  );
}
