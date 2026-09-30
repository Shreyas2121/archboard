import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Workflow } from 'lucide-react';
import type { BoardRole } from '@archboard/contracts';

interface BoardEntryProps {
  readonly boardId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly role: BoardRole;
  readonly available?: boolean;
  readonly actions: ReactNode;
  readonly metadata: ReactNode;
  readonly children?: ReactNode;
}

export function BoardEntry({
  boardId,
  title,
  description,
  role,
  available = true,
  actions,
  metadata,
  children,
}: BoardEntryProps) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <Workflow className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-base leading-6 font-semibold">
          {available ? (
            <Link
              to="/boards/$boardId"
              params={{ boardId }}
              title={title}
              className="line-clamp-2 break-words rounded-sm hover:underline hover:underline-offset-4"
            >
              {title}
            </Link>
          ) : (
            <span className="line-clamp-2 break-words" title={title}>
              {title}
            </span>
          )}
        </h2>
        {actions}
      </div>
      <p className="line-clamp-2 min-h-10 break-words text-sm leading-5 text-muted-foreground">
        {description || 'No description'}
      </p>
      {children}
      <footer className="mt-auto flex flex-wrap items-start justify-between gap-2 border-t pt-3 text-xs leading-4 text-muted-foreground">
        <span className="capitalize">{role}</span>
        <div className="min-w-0 space-y-1">{metadata}</div>
      </footer>
    </article>
  );
}
