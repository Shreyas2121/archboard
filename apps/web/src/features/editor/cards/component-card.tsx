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
import { cn } from '@/lib/utils';
import { COMPONENT_TWO_LINE_MIN_HEIGHT } from './card-layout';

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
          className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
          aria-hidden="true"
          title={node.content.category}
        >
          <CategoryIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <CardTitle>{node.title}</CardTitle>
        </div>
        {node.content.externalUrl !== null && (
          <a
            className="nodrag ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
      <div className="flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden">
        <p
          className={cn(
            'min-h-0 text-xs leading-4 text-muted-foreground',
            node.size.height < COMPONENT_TWO_LINE_MIN_HEIGHT ? 'line-clamp-1' : 'line-clamp-2',
          )}
        >
          {node.content.description || 'No description'}
        </p>
        {node.content.technology.length > 0 && (
          <p
            className="mt-auto shrink-0 truncate text-xs leading-4 text-muted-foreground"
            title={node.content.technology}
          >
            {node.content.technology}
          </p>
        )}
      </div>
    </CardFrame>
  );
}
