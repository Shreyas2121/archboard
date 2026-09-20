import type { NodeProps } from '@xyflow/react';

import type { CanvasNode } from '@/features/editor/canvas/projection-adapter';

import { CodeCard } from './code-card';
import { ComponentCard } from './component-card';
import { NoteCard } from './note-card';
import { SchemaCard } from './schema-card';

export function CardNode({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.node;
  if (node.kind === 'component') return <ComponentCard node={node} selected={selected} />;
  if (node.kind === 'code') return <CodeCard node={node} selected={selected} />;
  if (node.kind === 'schema') return <SchemaCard node={node} selected={selected} />;
  return <NoteCard node={node} selected={selected} />;
}
