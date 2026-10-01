import { useEffect, useRef, useState } from 'react';
import type { Comment } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { BoardQueryScope } from '@/features/boards/board-resource-refresh';
import { inspectCreation } from './discussion-api';
import {
  canRetryDiscussion,
  canRestartInspectedCreation,
  type DiscussionRequest,
} from './discussion-model';

export function CreationRecoveryDialog({
  request,
  scope,
  readable,
  onNewSubmission,
  onFailure,
}: {
  readonly request: DiscussionRequest;
  readonly scope: BoardQueryScope;
  readonly readable: boolean;
  readonly onNewSubmission: () => void;
  readonly onFailure: (cause: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<Comment[] | null>(null);
  const [inspectedAt, setInspectedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const allowed = useRef(readable);
  allowed.current = readable;
  const flight = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      flight.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!readable) {
      flight.current?.abort();
    }
  }, [readable]);
  async function inspect() {
    if (!allowed.current || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError('');
    setMatches(null);
    setInspectedAt(null);
    try {
      const result = await inspectCreation(
        scope.boardId,
        request,
        scope.accountId,
        controller.signal,
      );
      if (active.current && allowed.current && !controller.signal.aborted) {
        setMatches(result);
        setInspectedAt(Date.now());
      }
    } catch (cause) {
      if (active.current && allowed.current) {
        onFailure(cause);
        setError(
          'Visible results could not be inspected. Keep the original request and reconnect or refresh access.',
        );
      }
    } finally {
      flight.current = null;
      if (active.current) setBusy(false);
    }
  }
  const retryValid = canRetryDiscussion(request, Date.now());
  const restartAllowed =
    matches !== null && canRestartInspectedCreation(request, Date.now(), request.key, inspectedAt);
  return (
    <Dialog open={open && readable} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={!readable || busy}>
          Review unconfirmed creation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review unconfirmed creation</DialogTitle>
          <DialogDescription>
            The exact unsent body and original key are retained. Similar visible messages do not
            prove which request created them; edits or deletion may also hide a match.
          </DialogDescription>
        </DialogHeader>
        <p>
          {retryValid
            ? 'The retry window is valid. Close this review and retry the identical keyed request to confirm its outcome before changing its text.'
            : 'The retry window ended. Inspect visible results before deliberately starting a new creation, which may duplicate an earlier committed message.'}
        </p>
        <p className="break-words whitespace-pre-wrap">{request.operation.input.body}</p>
        <Button
          type="button"
          variant="outline"
          disabled={!readable || busy}
          onClick={() => void inspect()}
        >
          Inspect visible results
        </Button>
        {busy && <p role="status">Inspecting all relevant pages…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {matches !== null && (
          <section aria-label="Matching visible messages" className="grid gap-2">
            <p>
              {matches.length} matching visible messages. Review their authors and times before
              deciding.
            </p>
            {matches.map((comment) => (
              <article key={comment.id} className="rounded-lg border p-2">
                <p>
                  {comment.author.name} ·{' '}
                  <time dateTime={comment.createdAt}>
                    {new Date(comment.createdAt).toLocaleString()}
                  </time>
                </p>
                <p className="break-words whitespace-pre-wrap">{comment.body}</p>
              </article>
            ))}
          </section>
        )}
        <DialogFooter className="flex-wrap [&>button]:h-auto [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:whitespace-normal">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep original unsent request
          </Button>
          {!retryValid && (
            <Button
              type="button"
              disabled={!readable || busy || !restartAllowed}
              onClick={() => {
                if (
                  matches !== null &&
                  canRestartInspectedCreation(request, Date.now(), request.key, inspectedAt)
                ) {
                  setOpen(false);
                  onNewSubmission();
                }
              }}
            >
              I reviewed results; allow a new submission
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
