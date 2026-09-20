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
        className="nodrag nowheel mt-3 min-h-0 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-[0.65rem] leading-4"
        aria-label={`${node.title || 'Schema'} body`}
        tabIndex={0}
      >
        {node.content.body || 'No schema yet'}
      </pre>
    </CardFrame>
  );
}
