import type { ExtractedGraphNode } from './types';
import { StickyNote } from 'lucide-react';

import { CardFrame, CardTitle } from './card-frame';

interface NoteCardProps {
  readonly node: ExtractedGraphNode<'note'>;
  readonly selected: boolean;
}

export function NoteCard({ node, selected }: NoteCardProps) {
  return (
    <CardFrame node={node} selected={selected} className="shadow-none">
      <header className="flex min-w-0 items-center gap-2">
        <StickyNote className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <CardTitle>{node.title}</CardTitle>
      </header>
      <p
        className="nodrag nowheel min-h-0 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-sm text-sm leading-5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        aria-label={`${node.title || 'Note'} body`}
        tabIndex={0}
      >
        {node.content.body || 'No note yet'}
      </p>
    </CardFrame>
  );
}
