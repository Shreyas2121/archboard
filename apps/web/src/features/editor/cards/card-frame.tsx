import type { ReactNode } from 'react';
import type { GraphNode } from '@archboard/contracts';

import { cn } from '@/lib/utils';

import { CardHandles } from './card-handles';
import { CARD_COLOR_RULES } from './card-colors';

interface CardFrameProps {
  readonly node: GraphNode;
  readonly selected: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function CardFrame({ node, selected, children, className }: CardFrameProps) {
  return (
    <article
      className={cn(
        'group relative grid size-full grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-sm',
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-surface-canvas',
        className,
      )}
      data-color={node.color}
      data-kind={node.kind}
      data-selected={selected}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-x-2 top-0 h-0.5 rounded-full', CARD_COLOR_RULES[node.color])}
      />
      <CardHandles />
      {children}
    </article>
  );
}

export function CardTitle({ children }: { readonly children: string }) {
  return (
    <h2
      className="min-w-0 truncate text-sm font-semibold leading-5"
      title={children || 'Untitled card'}
    >
      {children || 'Untitled card'}
    </h2>
  );
}
