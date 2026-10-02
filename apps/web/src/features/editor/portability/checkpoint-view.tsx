import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  checkpointDetailResponseSchema,
  restoreCheckpointResponseSchema,
  restoreCheckpointSchema,
  MAX_BOARD_TITLE_CHARACTERS,
} from '@archboard/contracts';
import { ReactFlowProvider } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/platform/api';
import { GraphCanvas } from '../canvas';
import { readInBoardScope } from '@/features/boards/board-request-lifecycle';
import { boardListQueryKey } from '@/features/boards/board-resource-refresh';
import { usePortabilityScope } from './use-portability-scope';
import { usePortableCreation } from './use-portable-creation';
import { CreationFeedback } from './creation-feedback';
import { inspectVisibleBoards } from './inspect-boards';
import { JSON_PREVIEW_INDENT, isNewPrivateBoard } from './portability-policy';

export function CheckpointView({
  accountId,
  boardId,
  checkpointId,
}: {
  readonly accountId: string;
  readonly boardId: string;
  readonly checkpointId: string;
}) {
  const scope = usePortabilityScope(accountId, boardId);
  const navigate = useNavigate();
  const [title, setTitle] = useState('Restored checkpoint');
  const [results, setResults] = useState<string[]>([]);
  const checkpoint = useQuery({
    queryKey: [...scope.queryKey, 'checkpoints', checkpointId],
    enabled: scope.readable,
    queryFn: ({ signal }) =>
      readInBoardScope(
        signal,
        () => scope.current() && navigator.onLine,
        () =>
          apiRequest(
            `/boards/${boardId}/checkpoints/${checkpointId}`,
            checkpointDetailResponseSchema.refine(
              (result) => result.data.boardId === boardId && result.data.id === checkpointId,
            ),
            { signal },
          ),
      ),
    retry: false,
  });
  const creation = usePortableCreation(
    scope,
    `/boards/${boardId}/checkpoints/${checkpointId}/duplicate`,
    restoreCheckpointResponseSchema.refine((result) =>
      isNewPrivateBoard(result.data, accountId, boardId),
    ),
    (result) => {
      void scope.client.invalidateQueries({ queryKey: boardListQueryKey(scope.origin, accountId) });
      void navigate({ to: '/boards/$boardId', params: { boardId: result.data.id } });
    },
    async () => {
      await checkpoint.refetch({ throwOnError: true });
      setResults(await inspectVisibleBoards(scope));
    },
  );
  const detail =
    scope.readable &&
    checkpoint.isSuccess &&
    !checkpoint.isFetching &&
    !scope.client.getQueryState([...scope.queryKey, 'checkpoints', checkpointId])?.isInvalidated
      ? checkpoint.data.data
      : null;
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <header className="grid gap-2">
        <Link to="/boards/$boardId" params={{ boardId }} className="underline">
          Return to source board
        </Link>
        <h1 className="text-2xl font-semibold">
          Read-only checkpoint{detail ? `: ${detail.name}` : ''}
        </h1>
        <p>Restoring creates a new private board. The source board and checkpoint remain intact.</p>
      </header>
      {!scope.online && (
        <p role="status">
          Checkpoint unavailable offline. Reconnect to authenticate and fetch this snapshot.
        </p>
      )}
      {scope.online && (!scope.readable || checkpoint.isPending) && (
        <p role="status">Authenticating and loading checkpoint…</p>
      )}
      {checkpoint.isError && (
        <p role="alert" className="text-destructive">
          Checkpoint unavailable: {checkpoint.error.message}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!scope.online || checkpoint.isFetching}
        onClick={() =>
          void scope
            .refreshAccess()
            .then(() => checkpoint.refetch())
            .catch(() => undefined)
        }
      >
        Retry checkpoint read
      </Button>
      {detail && (
        <>
          <p className="text-sm">
            {detail.createdBy.name} · {new Date(detail.createdAt).toLocaleString()} · committed
            sequence {detail.throughSeq}
          </p>
          <section
            className="grid gap-2 rounded-lg border p-4"
            aria-label="Restore checkpoint as new board"
          >
            <Label htmlFor="restore-title">New private board title</Label>
            <Input
              id="restore-title"
              maxLength={MAX_BOARD_TITLE_CHARACTERS}
              value={title}
              disabled={creation.busy || creation.intent !== null}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button
              type="button"
              disabled={
                !scope.readable ||
                creation.busy ||
                (!!creation.intent && !creation.intent.retryable(Date.now()))
              }
              onClick={() => void creation.submit(() => restoreCheckpointSchema.parse({ title }))}
            >
              {creation.busy
                ? 'Restoring…'
                : creation.intent
                  ? 'Retry identical restore request'
                  : 'Restore as new private board'}
            </Button>
            <CreationFeedback {...creation} />
            {!!results.length && (
              <details>
                <summary>Reviewed current boards; title matches are not receipt proof</summary>
                {results.map((result) => (
                  <p key={result}>{result}</p>
                ))}
              </details>
            )}
          </section>
          <div
            className="h-[60vh] min-h-80 overflow-hidden rounded-lg border"
            aria-label="Read-only checkpoint canvas"
          >
            <ReactFlowProvider>
              <GraphCanvas
                projection={detail.graph}
                editable={false}
                minimapVisible
                gridSnapEnabled={false}
                onConnect={() => undefined}
                onReconnect={() => undefined}
                onGeometryCommit={() => null}
                onViewportChange={() => undefined}
              />
            </ReactFlowProvider>
          </div>
          <details>
            <summary>Complete checkpoint content as text</summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(detail.graph, null, JSON_PREVIEW_INDENT)}
            </pre>
          </details>
        </>
      )}
    </main>
  );
}
