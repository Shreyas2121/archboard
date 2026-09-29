import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Archive, Copy, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { listSelectedCachedBoards, type CachedBoardEntry } from '@archboard/sync-client';
import { MAX_BOARD_TITLE_CHARACTERS } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CachedBoardDashboardProps {
  readonly onRetry: () => void;
  readonly sessionUncertain?: boolean;
}

type CacheState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly entries: readonly CachedBoardEntry[] };

export function CachedBoardDashboard({
  onRetry,
  sessionUncertain = false,
}: CachedBoardDashboardProps) {
  const [cache, setCache] = useState<CacheState>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    let active = true;
    void listSelectedCachedBoards(window.location.origin).then(
      (entries) => {
        if (active) setCache({ kind: 'ready', entries });
      },
      () => {
        if (active) setCache({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [retryKey]);

  const query = search.trim().toLocaleLowerCase();
  const visible =
    cache.kind === 'ready'
      ? cache.entries.filter(
          (entry) =>
            entry.archived === archived &&
            (query === '' ||
              entry.summary?.title.toLocaleLowerCase().includes(query) ||
              entry.boardId.toLocaleLowerCase().includes(query)),
        )
      : [];
  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Offline workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Cached boards on this device
          </h1>
          <p className="mt-2 text-muted-foreground">
            This is a partial list saved for the selected account. Board details may be outdated.
          </p>
        </div>
        <Button type="button" disabled title="Reconnect to create a board">
          <Plus /> New board
        </Button>
      </div>
      <div className="mt-6 rounded-xl border bg-muted/50 p-4 text-sm" role="status">
        <p>
          {sessionUncertain
            ? 'Your session could not be checked. These boards are from the last selected account on this device.'
            : 'The server is unavailable. These boards come from this device’s local cache.'}
        </p>
        <p className="mt-1 text-muted-foreground">
          Reconnect to create boards, change details, archive or restore, duplicate, manage access,
          or invite people.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCcw /> Retry connection
        </Button>
      </div>
      <section className="mt-9" aria-label="Cached board list">
        <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end">
          <div className="grid w-full gap-1.5 sm:max-w-sm">
            <Label htmlFor="cached-board-search">Search cached titles or IDs</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="cached-board-search"
                type="search"
                className="pl-9"
                maxLength={MAX_BOARD_TITLE_CHARACTERS}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cached-board-filter">Show cached</Label>
            <Select
              value={archived ? 'archived' : 'active'}
              onValueChange={(value) => setArchived(value === 'archived')}
            >
              <SelectTrigger id="cached-board-filter" className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active boards</SelectItem>
                <SelectItem value="archived">Archived boards</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {cache.kind === 'loading' ? (
          <p className="py-8 text-muted-foreground" role="status">
            Loading cached boards…
          </p>
        ) : cache.kind === 'error' ? (
          <div className="rounded-xl border bg-card p-8 text-center" role="alert">
            <h2 className="text-lg font-semibold">Local boards could not load</h2>
            <p className="mt-2 text-muted-foreground">This device’s board cache is unavailable.</p>
            <Button
              type="button"
              className="mt-5"
              onClick={() => {
                setCache({ kind: 'loading' });
                setRetryKey((value) => value + 1);
              }}
            >
              <RotateCcw /> Retry local cache
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center sm:p-12">
            <h2 className="text-xl font-semibold">
              {query
                ? 'No cached titles match your search'
                : archived
                  ? 'No archived boards cached here'
                  : 'No boards cached on this device'}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {query
                ? 'Try another title or clear the search. This local list is incomplete.'
                : 'Reconnect to load your full board list. Boards opened on another device may not appear here.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((entry) => (
              <CachedBoardCard key={entry.boardId} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function CachedBoardCard({ entry }: { readonly entry: CachedBoardEntry }) {
  const title = entry.summary?.title ?? 'Board details unavailable';
  return (
    <article className="flex min-w-0 flex-col rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {entry.role}
        </span>
      </div>
      {entry.summary?.description ? (
        <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">
          {entry.summary.description}
        </p>
      ) : null}
      <p className="mt-3 break-all text-xs text-muted-foreground">Board ID: {entry.boardId}</p>
      <p className="mt-4 text-sm">
        {entry.archived ? 'Archived' : 'Active'} ·{' '}
        {entry.locallyAvailable ? 'Local document available' : 'Local document unavailable'}
      </p>
      {!entry.locallyAvailable && (
        <p className="mt-2 text-sm text-muted-foreground">
          The local document may have been cleared or evicted. Reconnect and authenticate to open
          this board again. Browser storage is not a backup.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Cached <time dateTime={entry.fetchedAt}>{new Date(entry.fetchedAt).toLocaleString()}</time>{' '}
        · Details may be outdated
      </p>
      {entry.lastLocalCommitAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Local document saved{' '}
          <time dateTime={entry.lastLocalCommitAt}>
            {new Date(entry.lastLocalCommitAt).toLocaleString()}
          </time>
        </p>
      ) : null}
      <div
        className="mt-5 flex flex-wrap gap-2 border-t pt-4"
        aria-label={`Board actions for ${title}`}
      >
        {entry.locallyAvailable ? (
          <Button asChild size="sm">
            <Link to="/boards/$boardId" params={{ boardId: entry.boardId }}>
              Open board
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled
            title="No local document is available for this board"
          >
            Open board
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Reconnect to edit board details"
        >
          <Pencil /> Edit details
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Reconnect to change archive status"
        >
          {entry.archived ? <RotateCcw /> : <Archive />}
          {entry.archived ? 'Restore' : 'Archive'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Reconnect to duplicate a board"
        >
          <Copy /> Duplicate
        </Button>
      </div>
    </article>
  );
}
