import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  boardDetailResponseSchema,
  checkpointListResponseSchema,
  checkpointNameSchema,
  checkpointSummaryResponseSchema,
  createCheckpointSchema,
  duplicateBoardSchema,
} from '@archboard/contracts';
import { capturePortableEnvelope } from '@archboard/export';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/platform/api';
import { downloadPortableEnvelope } from '@/platform/download/portable-download';
import { readBoard } from '@/features/boards/board-api';
import { boardListQueryKey } from '@/features/boards/board-resource-refresh';
import { readInBoardScope } from '@/features/boards/board-request-lifecycle';
import type { EditorSession } from '../application/editor-session';
import { useEditorSession } from '../application/use-editor-session';
import {
  checkpointBlocker,
  localDurability,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  isNewPrivateBoard,
} from './portability-policy';
import { usePortabilityScope } from './use-portability-scope';
import { usePortableCreation } from './use-portable-creation';
import { CreationFeedback } from './creation-feedback';
import { inspectVisibleBoards } from './inspect-boards';
import { ApiClientError } from '@/platform/api';
import {
  MAX_CHECKPOINTS_PER_BOARD,
  MAX_CHECKPOINT_NAME_CHARACTERS,
  MAX_BOARD_TITLE_CHARACTERS,
} from '@archboard/contracts';

export function PortabilityControl({
  session,
  accountId,
  boardId,
  boardTitle,
  boardDescription,
  open,
  onOpenChange,
}: {
  readonly session: EditorSession;
  readonly accountId: string;
  readonly boardId: string;
  readonly boardTitle: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly boardDescription: string;
}) {
  const scope = usePortabilityScope(accountId, boardId);
  const snapshot = useEditorSession(session);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [title, setTitle] = useState(`${boardTitle} copy`);
  const [notice, setNotice] = useState('');
  const [sourceSelected, setSourceSelected] = useState(false);
  const [reviewedBoards, setReviewedBoards] = useState<string[]>([]);
  const readable = scope.readable && !snapshot.accessDenied;
  const metadata = useQuery({
    queryKey: [...scope.queryKey, 'metadata'],
    enabled: open && readable,
    queryFn: ({ signal }) =>
      readInBoardScope(
        signal,
        () => scope.current() && navigator.onLine,
        () => readBoard(boardId, signal),
      ),
    retry: false,
  });
  const checkpoints = useInfiniteQuery({
    queryKey: [...scope.queryKey, 'checkpoints'],
    enabled: open && readable,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      readInBoardScope(
        signal,
        () => scope.current() && navigator.onLine,
        () =>
          apiRequest(
            `/boards/${boardId}/checkpoints?limit=${MAX_CHECKPOINTS_PER_BOARD}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
            checkpointListResponseSchema.refine((result) =>
              result.data.every((row) => row.boardId === boardId),
            ),
            { signal },
          ),
      ),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const rows = checkpoints.data?.pages.flatMap((page) => page.data) ?? [];
  const atCap = rows.length >= MAX_CHECKPOINTS_PER_BOARD;
  const fresh =
    readable &&
    metadata.isSuccess &&
    !metadata.isFetching &&
    !scope.client.getQueryState([...scope.queryKey, 'metadata'])?.isInvalidated;
  const blocker = checkpointBlocker(snapshot, metadata.data, readable, fresh, atCap);
  async function refresh() {
    await Promise.all([
      metadata.refetch({ throwOnError: true }),
      checkpoints.refetch({ throwOnError: true }),
    ]);
  }
  const capture = usePortableCreation(
    scope,
    `/boards/${boardId}/checkpoints`,
    checkpointSummaryResponseSchema.refine(
      (result) => result.data.boardId === boardId && result.data.createdBy.id === accountId,
    ),
    (result) => {
      setNotice(
        `Checkpoint ${result.data.name} captured committed sequence ${result.data.throughSeq}.`,
      );
      setName('');
      void refresh().catch(() => {
        if (scope.current())
          setNotice(
            'Checkpoint creation was confirmed. List refresh failed; reconnect and refresh current access.',
          );
      });
    },
    refresh,
  );
  const duplicate = usePortableCreation(
    scope,
    `/boards/${boardId}/duplicate`,
    boardDetailResponseSchema.refine(
      (result) =>
        isNewPrivateBoard(result.data, accountId, boardId) && result.data.memberCount === 1,
    ),
    (result) => {
      void scope.client.invalidateQueries({ queryKey: boardListQueryKey(scope.origin, accountId) });
      void navigate({ to: '/boards/$boardId', params: { boardId: result.data.id } });
    },
    async () => {
      await refresh();
      setReviewedBoards(await inspectVisibleBoards(scope));
    },
  );
  useEffect(() => {
    const failure = metadata.error ?? checkpoints.error ?? capture.failure ?? duplicate.failure;
    if (
      failure instanceof ApiClientError &&
      (failure.status === HTTP_NOT_FOUND || failure.kind === 'unauthenticated')
    )
      session.denyBoardAccess();
  }, [metadata.error, checkpoints.error, capture.failure, duplicate.failure, session]);
  const capped = atCap || capture.failure?.status === HTTP_PAYLOAD_TOO_LARGE;
  async function submitCheckpoint() {
    await capture.submit(async () => {
      const result = await metadata.refetch({ throwOnError: true });
      const reason = checkpointBlocker(
        session.getSnapshot(),
        result.data,
        navigator.onLine,
        scope.current(),
        capped,
      );
      if (reason) throw new Error(reason);
      return createCheckpointSchema.parse({ name, expectedSeq: result.data?.latestSeq });
    });
  }
  function download() {
    try {
      const current = session.getSnapshot();
      if (!current.projection) throw new Error('No local graph is available.');
      const file = capturePortableEnvelope(
        {
          exportedAt: new Date().toISOString(),
          board: {
            title: metadata.data?.title ?? boardTitle,
            description: metadata.data?.description ?? boardDescription,
          },
          graph: current.projection,
        },
        localDurability(current, navigator.onLine && scope.current()),
      );
      const reimportable = downloadPortableEnvelope(file);
      setNotice(
        `${file.syncStatusAtExport} JSON download requested.${reimportable ? '' : ' Full file exceeds 5 MiB and cannot be reimported unchanged. No content was truncated.'}`,
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Download failed.');
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Checkpoints & JSON
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Checkpoints and JSON</DialogTitle>
          <DialogDescription>
            Checkpoints capture committed server content. Full JSON includes the available local
            graph, including pending edits.
          </DialogDescription>
        </DialogHeader>
        <Button type="button" variant="outline" disabled={!snapshot.projection} onClick={download}>
          Download full local JSON
        </Button>
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {!readable && (
          <p role="status">
            Server actions require current authenticated access online. Local JSON remains
            available.
          </p>
        )}
        {(metadata.error || checkpoints.error) && (
          <p role="alert" className="text-destructive">
            {(metadata.error ?? checkpoints.error)?.message}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!scope.online || snapshot.accessDenied}
          onClick={() =>
            void scope
              .refreshAccess()
              .then(refresh)
              .catch(() => undefined)
          }
        >
          Refresh checkpoints and current access
        </Button>
        <section className="grid gap-3" aria-label="Create checkpoint">
          <Label htmlFor="checkpoint-name">Checkpoint name (1–120 characters)</Label>
          <Input
            id="checkpoint-name"
            maxLength={MAX_CHECKPOINT_NAME_CHARACTERS}
            value={name}
            disabled={capture.busy || capture.intent !== null}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-sm">
            {capped
              ? 'This board has reached its 100 checkpoint limit.'
              : (blocker ?? `Capture committed sequence ${metadata.data?.latestSeq}.`)}
          </p>
          <Button
            type="button"
            disabled={
              !readable ||
              capture.busy ||
              (capture.intent
                ? !capture.intent.retryable(Date.now())
                : capped || blocker !== null || !checkpointNameSchema.safeParse(name).success)
            }
            onClick={() => void submitCheckpoint()}
          >
            {capture.busy
              ? 'Creating…'
              : capture.intent
                ? 'Retry identical checkpoint request'
                : 'Create checkpoint'}
          </Button>
          <CreationFeedback {...capture} />
        </section>
        <section className="grid gap-2" aria-label="Checkpoint list">
          <h2 className="font-semibold">Saved checkpoints</h2>
          {readable && checkpoints.isPending && <p role="status">Loading checkpoints…</p>}
          {readable && checkpoints.isSuccess && !rows.length && <p>No checkpoints yet.</p>}
          {readable &&
            fresh &&
            !checkpoints.isFetching &&
            rows.map((row) => (
              <article key={row.id} className="rounded-lg border p-3">
                <Link
                  to="/boards/$boardId/checkpoints/$checkpointId"
                  params={{ boardId, checkpointId: row.id }}
                  className="font-medium underline"
                >
                  {row.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {row.createdBy.name} · {new Date(row.createdAt).toLocaleString()} · sequence{' '}
                  {row.throughSeq}
                </p>
              </article>
            ))}
          {checkpoints.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              disabled={!readable || checkpoints.isFetchingNextPage}
              onClick={() => void checkpoints.fetchNextPage()}
            >
              Load more checkpoints
            </Button>
          )}
        </section>
        <section className="grid gap-3 border-t pt-4" aria-label="Duplicate content source">
          <h2 className="font-semibold">Duplicate committed server board</h2>
          <p className="text-sm">
            Unsynchronized local edits are excluded. Wait for server acknowledgment to include them,
            or download local JSON and import it from Your boards.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={duplicate.busy || duplicate.intent !== null}
            onClick={() => setSourceSelected(true)}
          >
            Use committed server content, excluding pending edits
          </Button>
          <Label htmlFor="duplicate-portable-title">New private board title</Label>
          <Input
            id="duplicate-portable-title"
            maxLength={MAX_BOARD_TITLE_CHARACTERS}
            value={title}
            disabled={duplicate.busy || duplicate.intent !== null}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            type="button"
            disabled={
              !readable ||
              !fresh ||
              !sourceSelected ||
              duplicate.busy ||
              (!!duplicate.intent && !duplicate.intent.retryable(Date.now()))
            }
            onClick={() => void duplicate.submit(() => duplicateBoardSchema.parse({ title }))}
          >
            {duplicate.intent ? 'Retry identical duplicate request' : 'Create private copy'}
          </Button>
          <CreationFeedback {...duplicate} />
          {!!reviewedBoards.length && (
            <details>
              <summary>Reviewed current boards; title matches are not receipt proof</summary>
              {reviewedBoards.map((row) => (
                <p key={row}>{row}</p>
              ))}
            </details>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
