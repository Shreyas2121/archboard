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
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-foreground">
          {node.content.language}
        </span>
      </header>
      <pre
        className="nodrag nowheel mt-3 min-h-0 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[0.65rem] leading-4"
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
