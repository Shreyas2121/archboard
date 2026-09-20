import type { ReactNode } from 'react';
import type { GraphNode } from '@archboard/contracts';

import { cn } from '@/lib/utils';

import { CardHandles } from './card-handles';

const COLOR_CLASSES: Readonly<Record<GraphNode['color'], string>> = {
  gray: 'border-graph-gray/70',
  blue: 'border-graph-blue/70',
  teal: 'border-graph-teal/70',
  green: 'border-graph-green/70',
  amber: 'border-graph-amber/70',
  red: 'border-graph-red/70',
  violet: 'border-graph-violet/70',
};

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
        'relative grid size-full content-start overflow-hidden rounded-xl border-2 bg-card p-4 text-card-foreground shadow-sm',
        COLOR_CLASSES[node.color],
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        className,
      )}
      data-color={node.color}
      data-kind={node.kind}
    >
      <CardHandles />
      {children}
    </article>
  );
}

export function CardTitle({ children }: { readonly children: string }) {
  return (
    <h2 className="truncate text-sm font-semibold leading-5">{children || 'Untitled card'}</h2>
  );
}
