import type { ExtractedGraphNode } from './types';
import { Code2 } from 'lucide-react';

import { CardFrame, CardTitle } from './card-frame';
import { HighlightedCode } from './highlighted-code';

interface CodeCardProps {
  readonly node: ExtractedGraphNode<'code'>;
  readonly selected: boolean;
}

export function CodeCard({ node, selected }: CodeCardProps) {
  return (
    <CardFrame node={node} selected={selected}>
      <header className="flex min-w-0 items-center gap-2">
        <Code2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <CardTitle>{node.title}</CardTitle>
        <span
          className="ml-auto max-w-20 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs leading-4 text-muted-foreground"
          title={node.content.language}
        >
          {node.content.language}
        </span>
      </header>
      <pre
        className="nodrag nowheel min-h-0 min-w-0 overflow-auto rounded-md border bg-code-surface px-2 py-1 font-mono text-xs leading-[18px] focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        aria-label={`${node.title || 'Code'} source`}
        tabIndex={0}
      >
        <code>
          <HighlightedCode code={node.content.body} language={node.content.language} />
        </code>
      </pre>
    </CardFrame>
  );
}
