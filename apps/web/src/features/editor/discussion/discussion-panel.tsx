import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useReactFlow } from '@xyflow/react';
import {
  ERROR_CODES,
  MAX_COMMENT_BODY_CHARACTERS,
  commentBodySchema,
  countCommentBodyCharacters,
  threadAnchorSchema,
  type ThreadAnchor,
} from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBoardSharing } from '@/features/boards/use-board-sharing';
import { readInBoardScope } from '@/features/boards/board-request-lifecycle';
import {
  BoardResourceRefresh,
  boardResourceQueryKey,
  type BoardQueryScope,
} from '@/features/boards/board-resource-refresh';
import { useEditorUiActions } from '@/features/editor/state';
import { ApiClientError } from '@/platform/api';
import { readThreads, readComments, sendDiscussion } from './discussion-api';
import {
  anchorLabel,
  selectedAnchor,
  localAnchor,
  discussionWriteAllowed,
  canRetryDiscussion,
  anchorDraftKey,
  creationFailureUncertain,
  canModerateComment,
  definitiveCreationRejection,
  type DiscussionRequest,
} from './discussion-model';
import type { DiscussionPanelProps } from './discussion-types';
import { useDiscussionModeration } from './use-discussion-moderation';
import { DiscussionModerationDialog } from './discussion-moderation-dialog';
import { CreationRecoveryDialog } from './creation-recovery-dialog';

const HALF = 2;

export function DiscussionPanel(props: DiscussionPanelProps) {
  const scope = props.session.resourceScope;
  return scope ? <ScopedDiscussion key={JSON.stringify(scope)} {...props} scope={scope} /> : null;
}

function ScopedDiscussion({
  session,
  scope,
  projection,
  selection,
  canvas,
  viewport,
  readOnly,
}: DiscussionPanelProps & { readonly scope: BoardQueryScope }) {
  const access = useBoardSharing(session, scope, true);
  const latestAccess = useRef(access);
  latestAccess.current = access;
  const latestReadOnly = useRef(readOnly);
  latestReadOnly.current = readOnly;
  const client = useQueryClient();
  const flow = useReactFlow();
  const actions = useEditorUiActions();
  const [resolved, setResolved] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<ThreadAnchor | null>(null);
  const [pointX, setPointX] = useState('0');
  const [pointY, setPointY] = useState('0');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<Record<string, DiscussionRequest>>({});
  const [uncertain, setUncertain] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const flight = useRef<AbortController | null>(null);
  const enabled = access.authenticated && access.online && !session.getSnapshot().accessDenied;
  const writable = !readOnly && discussionWriteAllowed(access.authority);
  const moderation = useDiscussionModeration(scope, access, readOnly);
  const prefix = boardResourceQueryKey(scope, 'comments');
  const threads = useInfiniteQuery({
    queryKey: [...prefix, 'threads', resolved],
    queryFn: ({ pageParam, signal }) =>
      readInBoardScope(
        signal,
        () => latestAccess.current.canRead(),
        () => readThreads(scope.boardId, resolved, pageParam, signal),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    retry: false,
    staleTime: Infinity,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const comments = useInfiniteQuery({
    queryKey: [...prefix, 'messages', threadId],
    queryFn: ({ pageParam, signal }) => {
      if (!threadId) throw new Error('Choose a discussion.');
      return readInBoardScope(
        signal,
        () => latestAccess.current.canRead(),
        () => readComments(scope.boardId, threadId, pageParam, signal),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: enabled && threadId !== null,
    retry: false,
    staleTime: Infinity,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const summaries = threads.data?.pages.flatMap((page) => page.data) ?? [];
  const selected = summaries.find(({ id }) => id === threadId);
  const candidate = selectedAnchor(selection, projection);
  const context = threadId ?? (anchor ? anchorDraftKey(anchor) : 'none');
  const request = requests[context] ?? null;
  const controlsLocked = sending || uncertain || moderation.snapshot.action !== null;
  const body = drafts[context] ?? '';
  const valid = commentBodySchema.safeParse(body);
  const validation = valid.success ? '' : (valid.error.issues[0]?.message ?? 'Check your message.');

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      flight.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!access.accountMatches || !access.online || access.authority.denied)
      flight.current?.abort();
  }, [access.accountMatches, access.online, access.authority.denied]);
  useEffect(() => {
    // A messages 404 can mean the thread disappeared; verify board authority via
    // authoritative metadata/membership reads rather than revoking it on that alone.
    const cause = threads.error ?? comments.error;
    if (!cause) return;
    if (cause instanceof ApiClientError && cause.kind === 'unauthenticated')
      latestAccess.current.handleFailure(cause);
    else if (enabled) void latestAccess.current.refresh().catch(latestAccess.current.handleFailure);
  }, [threads.error, comments.error, enabled]);

  function choosePoint(x: number, y: number) {
    const parsed = threadAnchorSchema.safeParse({ type: 'point', position: { x, y } });
    if (!parsed.success) {
      setError('Enter finite world coordinates within the graph limits.');
      return;
    }
    setPointX(String(x));
    setPointY(String(y));
    setAnchor(parsed.data);
    setThreadId(null);
    setError('');
    setNotice('');
  }
  function focus(target: ThreadAnchor) {
    const available = localAnchor(target, projection);
    if (available && available.type !== 'point')
      actions.setSelection([{ id: available.id, kind: available.type }]);
    // Deleted anchors navigate to their saved position without inventing a selection.
    const position = available?.position ?? target.position;
    void flow.setCenter(position.x, position.y, { zoom: viewport.zoom });
  }
  async function send() {
    if (flight.current || !writable || moderation.snapshot.action !== null) return;
    if (!request && (!valid.success || (!threadId && !anchor))) {
      setError(validation || 'Choose an anchor.');
      return;
    }
    const checkedAnchor = threadAnchorSchema.safeParse(anchor);
    if (!request && !threadId && !checkedAnchor.success) {
      setError(
        'The anchor position is outside the supported world coordinates. Choose a valid point or target. Your draft is retained.',
      );
      return;
    }
    const logical = request ?? {
      key: crypto.randomUUID(),
      startedAt: Date.now(),
      operation: threadId
        ? { kind: 'reply' as const, threadId, input: { body } }
        : { kind: 'thread' as const, input: { anchor: threadAnchorSchema.parse(anchor), body } },
    };
    if (!canRetryDiscussion(logical, Date.now())) {
      setError(
        'The retry window ended. Check visible results before starting another creation. The unsent draft is retained.',
      );
      return;
    }
    const controller = new AbortController();
    flight.current = controller;
    setRequests((previous) => ({ ...previous, [context]: logical }));
    setSending(true);
    setError('');
    setNotice('');
    let writeStarted = false;
    try {
      await latestAccess.current.refresh();
      if (
        !active.current ||
        latestReadOnly.current ||
        controller.signal.aborted ||
        !discussionWriteAllowed(latestAccess.current.readAuthority())
      )
        throw new Error('Reconnect and refresh your editing access before sending.');
      writeStarted = true;
      const result = await sendDiscussion(scope.boardId, logical, controller.signal);
      if (!active.current || !latestAccess.current.isCurrent()) return;
      setRequests((previous) => {
        const next = { ...previous };
        delete next[context];
        return next;
      });
      setUncertain(false);
      setDrafts((previous) => ({ ...previous, [context]: '' }));
      setThreadId(result.threadId);
      setAnchor(null);
      setNotice('Message sent. Refreshing discussion…');
      const refresh = new BoardResourceRefresh(client, scope);
      refresh.mutationCommitted(['comments']);
      await refresh.whenIdle();
      if (active.current && latestAccess.current.isCurrent()) setNotice('Message sent.');
    } catch (cause) {
      if (!active.current || !latestAccess.current.isCurrent()) return;
      const definiteRejection =
        cause instanceof ApiClientError &&
        cause.kind === 'http' &&
        definitiveCreationRejection(cause.status, cause.code);
      setUncertain((previous) =>
        creationFailureUncertain(previous, writeStarted, definiteRejection),
      );
      const missing =
        logical.operation.kind === 'thread' &&
        logical.operation.input.anchor.type !== 'point' &&
        cause instanceof ApiClientError &&
        cause.code === ERROR_CODES.VALIDATION_ERROR;
      setError(
        missing
          ? 'Unsent: this object is not in the committed graph yet, or was deleted. Wait for this target to sync and retry. Your draft is retained.'
          : `Unsent: ${cause instanceof Error ? cause.message : 'The response could not be confirmed.'} Retry sends the identical request.`,
      );
      if (cause instanceof ApiClientError && cause.kind === 'unauthenticated')
        latestAccess.current.handleFailure(cause);
      else if (navigator.onLine)
        void latestAccess.current.refresh().catch(latestAccess.current.handleFailure);
    } finally {
      flight.current = null;
      if (active.current) setSending(false);
    }
  }

  if (!access.accountMatches || session.getSnapshot().accessDenied)
    return (
      <p className="p-4 text-sm" role="status">
        Discussion is unavailable for this account. Your local graph is retained.
      </p>
    );
  const stale = !enabled || threads.isStale || threads.isError || threads.isFetching;
  return (
    <section className="grid gap-3 p-3" aria-label="Board discussion">
      <p className="text-xs text-muted-foreground">
        Discussion and unsent drafts stay in memory. Reloading or leaving this board loses drafts.
      </p>
      {!writable && (
        <p className="text-xs" role="status">
          {!access.online
            ? 'Offline: cached discussion is stale. Reconnect to send.'
            : access.authority.archived
              ? 'Archived board: discussion is read-only.'
              : 'Discussion is read-only until current editing access is verified.'}
        </p>
      )}
      <Tabs
        value={resolved ? 'resolved' : 'unresolved'}
        onValueChange={(value) => {
          if (!controlsLocked) {
            setResolved(value === 'resolved');
            setThreadId(null);
          }
        }}
      >
        <TabsList aria-label="Discussion filter">
          <TabsTrigger value="unresolved" disabled={controlsLocked}>
            Unresolved
          </TabsTrigger>
          <TabsTrigger value="resolved" disabled={controlsLocked}>
            Resolved
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void threads.refetch();
          if (threadId) void comments.refetch();
          void access.refresh().catch(access.handleFailure);
        }}
        disabled={!enabled}
      >
        Refresh discussion
      </Button>
      {stale && threads.data && (
        <p className="text-xs" role="status">
          Stale discussion. Last fetched{' '}
          <time dateTime={new Date(threads.dataUpdatedAt).toISOString()}>
            {new Date(threads.dataUpdatedAt).toLocaleString()}
          </time>
          .
        </p>
      )}
      {threads.isError && (
        <p role="alert">Discussion could not load. Use Refresh discussion to retry.</p>
      )}
      {!threads.data && (
        <p role="status">
          {enabled && threads.isFetching
            ? 'Loading discussion…'
            : 'Discussion unavailable. Reconnect and refresh.'}
        </p>
      )}
      {threads.isSuccess && summaries.length === 0 && (
        <p>No {resolved ? 'resolved' : 'unresolved'} discussions.</p>
      )}
      {summaries.map((thread) => (
        <article
          key={thread.id}
          data-thread-id={thread.id}
          className="grid gap-1 rounded-lg border p-2"
        >
          <Button
            type="button"
            variant="ghost"
            className="h-auto justify-start whitespace-normal text-left"
            disabled={controlsLocked}
            onClick={() => {
              setThreadId(thread.id);
              setAnchor(null);
              setError('');
              setNotice('');
            }}
          >
            {anchorLabel(thread.anchor)} — {thread.resolvedAt ? 'Resolved' : 'Unresolved'}
          </Button>
          <p className="text-xs">
            {thread.messageCount} messages · Started by {thread.createdBy.name} ·{' '}
            <time dateTime={thread.createdAt}>{new Date(thread.createdAt).toLocaleString()}</time>
          </p>
          {thread.resolvedAt && (
            <p className="text-xs">
              Resolved by {thread.resolvedBy?.name} ·{' '}
              <time dateTime={thread.resolvedAt}>
                {new Date(thread.resolvedAt).toLocaleString()}
              </time>
            </p>
          )}
          <p className="break-words whitespace-pre-wrap">{thread.latestMessage.body}</p>
          <p className="text-xs text-muted-foreground">
            {thread.latestMessage.author.name} ·{' '}
            <time dateTime={thread.latestMessage.createdAt}>
              {new Date(thread.latestMessage.createdAt).toLocaleString()}
            </time>
          </p>
          {!localAnchor(thread.anchor, projection) && (
            <p className="text-xs">
              Original object deleted. Saved context: {anchorLabel(thread.anchor)}
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => focus(thread.anchor)}>
            {localAnchor(thread.anchor, projection) ? 'Focus anchor' : 'Go to saved position'}
          </Button>
          {writable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={controlsLocked}
              onClick={() =>
                moderation.begin({
                  kind: 'resolve',
                  resource: thread,
                  resolved: thread.resolvedAt === null,
                })
              }
            >
              {thread.resolvedAt ? 'Reopen discussion' : 'Resolve discussion'}
            </Button>
          )}
        </article>
      ))}
      {threads.hasNextPage && (
        <Button
          type="button"
          disabled={!enabled || threads.isFetching}
          onClick={() => void threads.fetchNextPage()}
        >
          Load more discussions
        </Button>
      )}
      {threadId && (
        <section className="grid gap-2 border-t pt-3" aria-label="Discussion messages">
          <h3 className="font-semibold">
            {selected ? anchorLabel(selected.anchor) : 'Selected discussion'}
          </h3>
          {comments.isFetching && <p role="status">Loading messages…</p>}
          {comments.data &&
            (!enabled || comments.isStale || comments.isError || comments.isFetching) && (
              <p className="text-xs" role="status">
                Stale messages. Last fetched{' '}
                <time dateTime={new Date(comments.dataUpdatedAt).toISOString()}>
                  {new Date(comments.dataUpdatedAt).toLocaleString()}
                </time>
                .
              </p>
            )}
          {comments.isError && <p role="alert">Messages could not load. Refresh to retry.</p>}
          {!comments.data && !comments.isFetching && <p>Messages unavailable.</p>}
          {comments.data?.pages
            .flatMap((page) => page.data)
            .map((comment) => (
              <article
                key={comment.id}
                data-comment-id={comment.id}
                className="rounded-lg border p-2"
              >
                <p className="text-xs">
                  {comment.author.name} ·{' '}
                  <time dateTime={comment.createdAt}>
                    {new Date(comment.createdAt).toLocaleString()}
                  </time>
                  {comment.editedAt && ' · Edited'}
                  {comment.deletedAt && ' · Deleted'}
                </p>
                <p className="break-words whitespace-pre-wrap">{comment.body}</p>
                {writable && canModerateComment(access.authority, comment) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={controlsLocked}
                      onClick={() =>
                        moderation.begin({ kind: 'edit', resource: comment, body: comment.body })
                      }
                    >
                      Edit message
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={controlsLocked}
                      onClick={() => moderation.begin({ kind: 'delete', resource: comment })}
                    >
                      Delete message
                    </Button>
                  </div>
                )}
              </article>
            ))}
          {comments.hasNextPage && (
            <Button
              type="button"
              disabled={!enabled || comments.isFetching}
              onClick={() => void comments.fetchNextPage()}
            >
              Load more messages
            </Button>
          )}
        </section>
      )}
      {writable && (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={!candidate || controlsLocked}
            onClick={() => {
              setAnchor(candidate);
              setThreadId(null);
              setError('');
              setNotice('');
            }}
          >
            Discuss selected card or connection
          </Button>
          <div className="grid gap-2">
            <Label htmlFor="discussion-x">World X</Label>
            <Input
              id="discussion-x"
              type="number"
              value={pointX}
              disabled={controlsLocked}
              onChange={(event) => setPointX(event.target.value)}
            />
            <Label htmlFor="discussion-y">World Y</Label>
            <Input
              id="discussion-y"
              type="number"
              value={pointY}
              disabled={controlsLocked}
              onChange={(event) => setPointY(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={controlsLocked}
              onClick={() => {
                if (pointX.trim() && pointY.trim()) choosePoint(Number(pointX), Number(pointY));
                else setError('Enter both world coordinates.');
              }}
            >
              Discuss this point
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={controlsLocked}
              onClick={() => {
                const rect = canvas.current?.getBoundingClientRect();
                if (rect) {
                  const point = flow.screenToFlowPosition({
                    x: rect.left + rect.width / HALF,
                    y: rect.top + rect.height / HALF,
                  });
                  choosePoint(point.x, point.y);
                }
              }}
            >
              Discuss viewport center
            </Button>
          </div>
        </>
      )}
      {(anchor || threadId) && (writable || body || request) && (
        <form
          className="grid gap-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {anchor && <p>{anchorLabel(anchor)}</p>}
          {anchor?.type !== 'point' && anchor && (
            <p className="text-xs">
              New local objects must reach the committed graph before discussion can be sent. Other
              pending graph edits do not block comments.
            </p>
          )}
          <Label htmlFor="discussion-body">{threadId ? 'Reply' : 'First message'}</Label>
          <Textarea
            id="discussion-body"
            value={body}
            disabled={!writable || request !== null}
            aria-describedby="discussion-counter discussion-validation"
            onChange={(event) =>
              setDrafts((previous) => ({ ...previous, [context]: event.target.value }))
            }
          />
          <p id="discussion-counter" className="text-xs">
            {countCommentBodyCharacters(body)} / {MAX_COMMENT_BODY_CHARACTERS} characters
          </p>
          <p id="discussion-validation" className="text-xs text-destructive">
            {body && validation}
          </p>
          {writable && (
            <Button
              type="submit"
              disabled={
                sending || moderation.snapshot.action !== null || (!request && !valid.success)
              }
            >
              {sending ? 'Sending…' : request ? 'Retry identical unsent message' : 'Send message'}
            </Button>
          )}
          {request && !controlsLocked && canRetryDiscussion(request, Date.now()) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRequests((previous) => {
                  const next = { ...previous };
                  delete next[context];
                  return next;
                });
                setError(
                  'The rejected request was not committed. You can edit your retained draft.',
                );
              }}
            >
              Edit rejected draft
            </Button>
          )}
          {request && (
            <CreationRecoveryDialog
              key={request.key}
              request={request}
              scope={scope}
              readable={enabled && !sending}
              onFailure={(cause) => {
                if (!latestAccess.current.accountMatches) return;
                if (cause instanceof ApiClientError && cause.kind === 'unauthenticated')
                  latestAccess.current.handleFailure(cause);
                else if (navigator.onLine)
                  void latestAccess.current.refresh().catch(latestAccess.current.handleFailure);
              }}
              onNewSubmission={() => {
                if (
                  !latestAccess.current.accountMatches ||
                  latestAccess.current.readAuthority().denied ||
                  !navigator.onLine ||
                  canRetryDiscussion(request, Date.now())
                )
                  return;
                setRequests((previous) => {
                  const next = { ...previous };
                  delete next[context];
                  return next;
                });
                setUncertain(false);
                setError(
                  'The original outcome remains unconfirmed. You reviewed visible results and can now explicitly submit a new creation; it may duplicate an earlier message.',
                );
              }}
            />
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {moderation.snapshot.notice && <p role="status">{moderation.snapshot.notice}</p>}
      {moderation.snapshot.action === null && moderation.snapshot.retainedEdits.length > 0 && (
        <section className="grid gap-2 rounded-lg border p-3" aria-label="Retained unsent edits">
          <h3 className="font-semibold">Retained unsent edits</h3>
          <p className="text-xs">
            These edits were not confirmed. You can copy the text even if the original message was
            deleted. Reloading or leaving this board loses them.
          </p>
          {moderation.snapshot.retainedEdits.map((draft) => (
            <p key={draft.commentId} className="break-words whitespace-pre-wrap">
              {draft.body}
            </p>
          ))}
        </section>
      )}
      <DiscussionModerationDialog
        controller={moderation.controller}
        snapshot={moderation.snapshot}
        readable={access.accountMatches && !access.authority.denied}
        writable={writable}
        restoreFocus={moderation.restoreFocus}
      />
      {canvas.current &&
        createPortal(
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            {summaries.map((thread, index) => {
              const position =
                localAnchor(thread.anchor, projection)?.position ?? thread.anchor.position;
              return (
                <span
                  key={thread.id}
                  className="absolute rounded-full border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
                  // World coordinates and zoom are runtime canvas values.
                  style={{
                    left: position.x * viewport.zoom + viewport.x,
                    top: position.y * viewport.zoom + viewport.y,
                    transform: 'translate(12px, -100%)',
                  }}
                >
                  {index + 1} · {thread.resolvedAt ? 'Resolved' : 'Discussion'}
                </span>
              );
            })}
          </div>,
          canvas.current,
        )}
    </section>
  );
}
