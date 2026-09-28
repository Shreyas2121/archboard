import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Archive, Copy, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { BOARD_ROLES, MAX_BOARD_TITLE_CHARACTERS, type BoardSummary } from '@archboard/contracts';
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
import { ApiClientError } from '@/platform/api';
import {
  BOARD_QUERY_KEY,
  BOARD_SEARCH_DELAY_MS,
  listBoards,
  readBoard,
  type BoardAction,
} from './board-api';
import { BoardDialog } from './board-dialog';

type Selection = { action: BoardAction; board: BoardSummary | null; intent: string };
const LOADING_ROW_COUNT = 3;

export function BoardDashboard() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), BOARD_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const boards = useInfiniteQuery({
    queryKey: [...BOARD_QUERY_KEY, { search, archived }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listBoards(search, archived, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const rows = boards.data?.pages.flatMap((page) => page.data) ?? [];
  const searchSettling = searchInput.trim() !== search;
  const selectedBoard = selection?.board
    ? (rows.find((board) => board.id === selection.board?.id) ?? selection.board)
    : null;
  function openDialog(action: BoardAction, board: BoardSummary | null = null) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection({ action, board, intent: crypto.randomUUID() });
  }
  function afterSuccess(action: BoardAction, title: string) {
    setSelection(null);
    setAnnouncement(
      `${title}: ${action === 'create' ? 'created' : action === 'edit' ? 'updated' : action === 'duplicate' ? 'duplicated' : action === 'archive' ? 'archived' : 'restored'}.`,
    );
    void queryClient.invalidateQueries({ queryKey: BOARD_QUERY_KEY });
  }
  const failure = boards.error;
  const expired = failure instanceof ApiClientError && failure.kind === 'unauthenticated';
  const networkDown = failure instanceof ApiClientError && failure.kind === 'network';
  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Your boards</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your saved boards here. The local demo stays on this device.
          </p>
        </div>
        <Button type="button" onClick={() => openDialog('create')}>
          <Plus /> New board
        </Button>
      </div>
      <section className="mt-9" aria-label="Board list">
        <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end">
          <div className="grid w-full gap-1.5 sm:max-w-sm">
            <Label htmlFor="board-search">Search titles</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="board-search"
                type="search"
                className="pl-9"
                maxLength={MAX_BOARD_TITLE_CHARACTERS}
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  void queryClient.cancelQueries({ queryKey: BOARD_QUERY_KEY });
                }}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="board-filter">Show</Label>
            <Select
              value={archived ? 'archived' : 'active'}
              onValueChange={(value) => {
                setArchived(value === 'archived');
                void queryClient.cancelQueries({ queryKey: BOARD_QUERY_KEY });
              }}
            >
              <SelectTrigger id="board-filter" className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active boards</SelectItem>
                <SelectItem value="archived">Archived boards</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {boards.isPending || searchSettling ? (
          <div className="grid gap-3 py-7" role="status" aria-label="Loading boards">
            {Array.from({ length: LOADING_ROW_COUNT }, (_, index) => index).map((index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-xl border bg-muted/50 motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : boards.isError && !boards.isFetchNextPageError ? (
          <div className="rounded-xl border bg-card p-8 text-center" role="alert">
            <h2 className="text-lg font-semibold">
              {expired
                ? 'Your session expired'
                : networkDown
                  ? 'Network unavailable'
                  : 'Boards could not load'}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {expired
                ? 'Sign in again to view your boards.'
                : networkDown
                  ? 'Check your connection, then retry.'
                  : 'Please retry the board list.'}
            </p>
            {expired ? (
              <Button asChild className="mt-5">
                <Link to="/" search={{ returnTo: '/boards' }}>
                  Sign in
                </Link>
              </Button>
            ) : (
              <Button type="button" className="mt-5" onClick={() => void boards.refetch()}>
                <RotateCcw /> Retry
              </Button>
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center sm:p-12">
            <h2 className="text-xl font-semibold">
              {search
                ? 'No titles match your search'
                : archived
                  ? 'No archived boards'
                  : 'Start with a blank board'}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {search
                ? 'Try another title or clear the search.'
                : archived
                  ? 'Boards you archive will appear here.'
                  : 'Your first private board is ready when you are.'}
            </p>
            {!search && !archived ? (
              <Button type="button" className="mt-5" onClick={() => openDialog('create')}>
                <Plus /> Create board
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((board) => (
                <BoardCard key={board.id} board={board} onAction={openDialog} />
              ))}
            </div>
            {boards.hasNextPage ? (
              <div className="flex justify-center py-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={boards.isFetchingNextPage}
                  onClick={() => void boards.fetchNextPage()}
                >
                  {boards.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
            {boards.isFetchNextPageError ? (
              <p className="text-center text-destructive" role="alert">
                More boards could not load.{' '}
                <Button type="button" variant="outline" onClick={() => void boards.fetchNextPage()}>
                  Retry
                </Button>
              </p>
            ) : null}
          </>
        )}
      </section>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {selection ? (
        <BoardDialog
          key={selection.intent}
          action={selection.action}
          board={selectedBoard}
          onClose={() => setSelection(null)}
          onSuccess={afterSuccess}
          onConflict={async (id) => {
            const latest = await readBoard(id);
            setSelection((current) => (current ? { ...current, board: latest } : null));
            await queryClient.invalidateQueries({ queryKey: BOARD_QUERY_KEY });
            return latest;
          }}
          returnFocus={returnFocus.current}
        />
      ) : null}
    </main>
  );
}

function BoardCard({
  board,
  onAction,
}: {
  board: BoardSummary;
  onAction: (action: BoardAction, board: BoardSummary) => void;
}) {
  const canEdit = !board.archivedAt && board.effectiveRole !== BOARD_ROLES.VIEWER;
  const owner = board.effectiveRole === BOARD_ROLES.OWNER;
  return (
    <article className="flex min-w-0 flex-col rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-lg font-semibold">{board.title}</h2>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {board.effectiveRole}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 min-h-12 break-words text-sm text-muted-foreground">
        {board.description || 'No description'}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        {board.archivedAt ? 'Archived' : 'Active'} · Updated{' '}
        {new Date(board.contentUpdatedAt).toLocaleDateString()}
      </p>
      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
        <Button asChild size="sm">
          <Link to="/boards/$boardId" params={{ boardId: board.id }}>
            Open board
          </Link>
        </Button>
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onAction('edit', board)}>
            <Pencil /> Edit details
          </Button>
        ) : null}
        {owner ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAction(board.archivedAt ? 'restore' : 'archive', board)}
          >
            {board.archivedAt ? <RotateCcw /> : <Archive />}
            {board.archivedAt ? 'Restore' : 'Archive'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onAction('duplicate', board)}
        >
          <Copy /> Duplicate
        </Button>
      </div>
    </article>
  );
}
