import type { ExtractedGraphNode } from './types';
import {
  Archive,
  Box,
  Cloud,
  Database,
  ExternalLink,
  Monitor,
  Server,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

import { CardFrame, CardTitle } from './card-frame';

const CATEGORY_ICONS: Readonly<
  Record<ExtractedGraphNode<'component'>['content']['category'], LucideIcon>
> = {
  client: Monitor,
  service: Server,
  database: Database,
  queue: Waypoints,
  cache: Archive,
  external: Cloud,
  generic: Box,
};

interface ComponentCardProps {
  readonly node: ExtractedGraphNode<'component'>;
  readonly selected: boolean;
}

export function ComponentCard({ node, selected }: ComponentCardProps) {
  const CategoryIcon = CATEGORY_ICONS[node.content.category];
  return (
    <CardFrame node={node} selected={selected}>
      <header className="flex min-w-0 items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md bg-muted"
          aria-hidden="true"
        >
          <CategoryIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {node.content.category}
          </p>
          <CardTitle>{node.title}</CardTitle>
        </div>
        {node.content.externalUrl !== null && (
          <a
            className="nodrag ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            href={node.content.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${node.title || 'component'} link in a new tab`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </header>
      <p className="mt-3 line-clamp-2 text-xs leading-4 text-muted-foreground">
        {node.content.description || 'No description'}
      </p>
      {node.content.technology.length > 0 && (
        <p className="mt-auto truncate pt-2 text-[0.65rem] font-medium text-muted-foreground">
          {node.content.technology}
        </p>
      )}
    </CardFrame>
  );
}
