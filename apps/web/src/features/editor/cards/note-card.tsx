import type { ExtractedGraphNode } from './types';
import { StickyNote } from 'lucide-react';

import { CardFrame, CardTitle } from './card-frame';

interface NoteCardProps {
  readonly node: ExtractedGraphNode<'note'>;
  readonly selected: boolean;
}

export function NoteCard({ node, selected }: NoteCardProps) {
  return (
    <CardFrame node={node} selected={selected}>
      <header className="flex min-w-0 items-center gap-2">
        <StickyNote className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <CardTitle>{node.title}</CardTitle>
      </header>
      <p
        className="nodrag nowheel mt-3 min-h-0 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground"
        tabIndex={0}
      >
        {node.content.body || 'No note yet'}
      </p>
    </CardFrame>
  );
}
