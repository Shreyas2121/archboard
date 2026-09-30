import type { ExtractedGraphNode } from './types';
import { Database } from 'lucide-react';

import { CardFrame, CardTitle } from './card-frame';

interface SchemaCardProps {
  readonly node: ExtractedGraphNode<'schema'>;
  readonly selected: boolean;
}

export function SchemaCard({ node, selected }: SchemaCardProps) {
  return (
    <CardFrame node={node} selected={selected}>
      <header className="flex min-w-0 items-center gap-2">
        <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <CardTitle>{node.title}</CardTitle>
      </header>
      <pre
        className="nodrag nowheel min-h-0 min-w-0 overflow-auto whitespace-pre-wrap rounded-md border bg-field px-2 py-1 font-mono text-xs leading-[18px] focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        aria-label={`${node.title || 'Schema'} body`}
        tabIndex={0}
      >
        {node.content.body || 'No schema yet'}
      </pre>
    </CardFrame>
  );
}
