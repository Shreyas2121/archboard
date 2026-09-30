import { useEffect, useState } from 'react';

import { CloudOff, Plus, RotateCcw, Search } from 'lucide-react';
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
import { BoardEntry } from './board-entry';
import { BoardActionsMenu } from './board-actions-menu';
import { BoardListSkeleton } from './board-list-skeleton';

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
          <h1 className="text-3xl leading-10 font-semibold tracking-tight">
            Cached boards on this device
          </h1>
          <p className="mt-2 text-muted-foreground">
            This is a partial list saved for the selected account. Board details may be outdated.
          </p>
        </div>
        <Button type="button" size="lg" disabled aria-describedby="offline-board-guidance">
          <Plus /> New board
        </Button>
      </div>
      <div className="mt-6 rounded-lg border bg-surface-panel p-4 text-sm" role="status">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <CloudOff className="size-4" aria-hidden="true" /> Working from this device
        </div>
        <p>
          {sessionUncertain
            ? 'Your session could not be checked. These boards are from the last selected account on this device.'
            : 'The server is unavailable. These boards come from this device’s local cache.'}
        </p>
        <p id="offline-board-guidance" className="mt-1 text-muted-foreground">
          Reconnect to create boards, change details, archive or restore, duplicate, manage access,
          or invite people.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCcw /> Retry connection
        </Button>
      </div>
      <section className="mt-9" aria-label="Cached board list">
        <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end">
          <div className="grid w-full gap-2 sm:max-w-sm">
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
          <div className="grid gap-2">
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
          <BoardListSkeleton label="Loading cached boards" />
        ) : cache.kind === 'error' ? (
          <div className="rounded-lg border bg-surface-panel p-6 text-center" role="alert">
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
          <div className="rounded-lg border bg-surface-panel p-6 text-center sm:p-12">
            <h2 className="text-xl font-semibold">
              {query
                ? 'No cached titles match your search'
                : archived
                  ? 'No archived boards cached here'
                  : cache.entries.length > 0
                    ? 'No active boards cached here'
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
    <BoardEntry
      boardId={entry.boardId}
      title={title}
      description={entry.summary?.description ?? null}
      role={entry.role}
      available={entry.locallyAvailable}
      actions={
        <BoardActionsMenu title={title} role={entry.role} archived={entry.archived} offline />
      }
      metadata={
        <>
          <p>
            Cached{' '}
            <time dateTime={entry.fetchedAt}>{new Date(entry.fetchedAt).toLocaleString()}</time> ·
            Details may be outdated
          </p>
          {entry.lastLocalCommitAt ? (
            <p>
              Local document saved{' '}
              <time dateTime={entry.lastLocalCommitAt}>
                {new Date(entry.lastLocalCommitAt).toLocaleString()}
              </time>
            </p>
          ) : null}
        </>
      }
    >
      <p className="break-all text-xs leading-4 text-muted-foreground">Board ID: {entry.boardId}</p>
      <p className="text-xs leading-4">
        {entry.archived ? 'Archived' : 'Active'} ·{' '}
        {entry.locallyAvailable ? 'Local document available' : 'Local document unavailable'}
      </p>
      {!entry.locallyAvailable ? (
        <p className="text-xs leading-5 text-muted-foreground">
          The local document may have been cleared or evicted. Reconnect and authenticate to open
          this board again. Browser storage is not a backup.
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">Reconnect to manage this board.</p>
    </BoardEntry>
  );
}
