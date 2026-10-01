import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from '@tanstack/react-router';
import { LoaderCircle, RefreshCw, UsersRound } from 'lucide-react';
import { listAccountPendingBoards } from '@archboard/sync-client';
import type { EditorSession } from '@/features/editor/application';
import { IconButton } from '@/app/components/icon-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PendingChangesDialog } from '@/features/auth/pending-changes-dialog';
import { downloadPendingWork } from '@/features/auth/pending-work';
import { BoardMemberList } from './board-member-list';
import {
  canLeaveBoard,
  sharingWriteBlocker,
  type SharingConfirmation,
} from './board-sharing-policy';
import { MemberLeave } from './member-leave';
import { useBoardSharing } from './use-board-sharing';
import { useBoardInvites } from './use-board-invites';
import { BoardInviteControls } from './board-invite-controls';
import type { BoardQueryScope } from './board-resource-refresh';

interface BoardSharingControlProps {
  readonly session: EditorSession;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function BoardSharingControl(props: BoardSharingControlProps) {
  const scope = props.session.resourceScope;
  return scope === null ? null : (
    <ScopedSharingControl key={JSON.stringify(scope)} {...props} scope={scope} />
  );
}

function ScopedSharingControl({
  session,
  scope,
  open,
  onOpenChange,
}: BoardSharingControlProps & { readonly scope: BoardQueryScope }) {
  const sharing = useBoardSharing(session, scope, open);
  const invites = useBoardInvites(scope, sharing, open);
  const latest = useRef(sharing);
  latest.current = sharing;
  const trigger = useRef<HTMLButtonElement>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const dialogContent = useRef<HTMLDivElement>(null);
  const [confirmation, setConfirmation] = useState<SharingConfirmation | null>(null);
  const [leave] = useState(
    () =>
      new MemberLeave({
        namespace: session.getStorageNamespace(),
        assertAllowed: () => latest.current.assertAllowed(scope.accountId, true),
        freeze: () => session.prepareForLeavingBoard(),
        resume: () => session.cancelLeavingBoard(),
        readPending: () =>
          listAccountPendingBoards({
            deploymentOrigin: scope.deploymentOrigin,
            userId: scope.accountId,
          }),
        download: downloadPendingWork,
        remove: () => latest.current.mutate(scope.accountId, null, true),
        left: () => session.denyBoardAccess(),
      }),
  );
  const leaving = useSyncExternalStore(leave.subscribe, leave.getSnapshot, leave.getSnapshot);
  useEffect(() => {
    leave.activate();
    return () => leave.dispose();
  }, [leave]);
  const busy =
    sharing.busyMember !== null ||
    invites.busy ||
    leaving.phase === 'checking' ||
    leaving.phase === 'leaving';
  const protectedData = sharing.accountMatches && !session.getSnapshot().accessDenied;
  const board = protectedData ? sharing.metadata.data : undefined;
  const members = protectedData ? sharing.members.data : undefined;
  const blocker = sharingWriteBlocker(sharing.authority);
  const pendingPreservation =
    leaving.phase === 'preserve' || (leaving.phase === 'leaving' && leaving.boards.length > 0);
  const loading = sharing.metadata.isFetching || sharing.members.isFetching;
  const failedRead = sharing.metadata.isError || sharing.members.isError;
  const stale =
    !sharing.online ||
    !sharing.authenticated ||
    failedRead ||
    loading ||
    sharing.metadata.isStale ||
    sharing.members.isStale;

  function changeOpen(next: boolean) {
    const phase = leave.getSnapshot().phase;
    if (busy || phase === 'checking' || phase === 'leaving') return;
    if (!next) {
      leave.cancel();
      setConfirmation(null);
    }
    onOpenChange(next);
  }
  async function confirm() {
    if (confirmation === null || busy) return;
    try {
      if (confirmation.kind === 'remove') {
        await sharing.mutate(confirmation.userId, null);
      } else {
        // Enter the cancellable preservation boundary before any asynchronous preflight.
        // The mutation hook refreshes server authority immediately before sending DELETE.
        await leave.begin();
        if (leave.getSnapshot().phase === 'ready') await leave.commit();
      }
      setConfirmation(null);
    } catch (cause) {
      if (confirmation.kind === 'leave') sharing.handleFailure(cause);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <IconButton ref={trigger} label="Share board" variant="ghost">
            <UsersRound />
          </IconButton>
        </DialogTrigger>
        <DialogContent
          ref={dialogContent}
          className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
          aria-busy={busy || loading}
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {confirmation?.kind === 'remove'
                ? `Remove ${confirmation.name}?`
                : confirmation?.kind === 'leave'
                  ? 'Leave this board?'
                  : 'Share board'}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.kind === 'remove'
                ? 'This member will lose server access to the board. Copies already downloaded to their device cannot be remotely erased.'
                : confirmation?.kind === 'leave'
                  ? 'Leaving ends your server access. Your local graph and queued changes stay in this account on this device. We will check pending changes before sending the request.'
                  : 'Everyone with access can see the member list. The owner manages roles and removal; editors and viewers can leave their own membership.'}
            </DialogDescription>
          </DialogHeader>
          {!protectedData ? (
            <section className="grid gap-3" aria-label="Board access ended">
              <p className="text-sm" role="status">
                {sharing.accountMatches
                  ? 'Server access to this board ended. Your local recovery copy is retained.'
                  : 'This board is no longer the active account session.'}
              </p>
              <Button asChild variant="outline">
                <Link to="/boards">Back to boards</Link>
              </Button>
            </section>
          ) : confirmation ? (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  leave.cancel();
                  setConfirmation(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || blocker !== null}
                onClick={() => void confirm()}
              >
                {busy
                  ? 'Checking access…'
                  : confirmation.kind === 'leave'
                    ? 'Check changes and leave'
                    : 'Remove member'}
              </Button>
            </DialogFooter>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-medium">
                  {board?.title ?? 'Board members'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !sharing.authenticated || !sharing.online || loading}
                  onClick={() => void sharing.refresh().catch(sharing.handleFailure)}
                >
                  <RefreshCw aria-hidden="true" />
                  {loading ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
              {loading && !members && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <LoaderCircle
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  Loading board access…
                </p>
              )}
              {members && board ? (
                <>
                  <p className="text-xs text-muted-foreground" role="status">
                    {stale
                      ? 'Cached member list · may be stale'
                      : 'Member list fetched from server'}
                    {' · '}
                    {sharing.members.dataUpdatedAt > 0 &&
                      `Fetched ${new Date(sharing.members.dataUpdatedAt).toLocaleString()}`}
                  </p>
                  <BoardMemberList
                    members={members}
                    authority={sharing.authority}
                    busyMember={sharing.busyMember}
                    blocked={busy || leaving.phase !== 'idle'}
                    onRole={(userId, role) =>
                      void sharing.mutate(userId, role).catch(() => undefined)
                    }
                    onRemove={(member) =>
                      setConfirmation({
                        kind: 'remove',
                        userId: member.user.id,
                        name: member.user.name,
                      })
                    }
                  />
                  {members.filter(({ user }) => user.id !== board.owner.id).length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No other members have access yet.
                    </p>
                  )}
                  {sharing.authority.ownerId !== scope.accountId && (
                    <Button
                      ref={leaveButton}
                      type="button"
                      variant="outline"
                      className="justify-self-start"
                      disabled={busy || !canLeaveBoard(sharing.authority)}
                      onClick={() => setConfirmation({ kind: 'leave' })}
                    >
                      Leave board
                    </Button>
                  )}
                </>
              ) : (
                !loading && (
                  <p className="text-sm text-muted-foreground">
                    {failedRead
                      ? 'Member data could not load. Refresh to retry.'
                      : 'No member list is available on this device. Reconnect to load it.'}
                  </p>
                )
              )}
              <BoardInviteControls
                invites={invites}
                blocked={sharing.busyMember !== null || leaving.phase !== 'idle'}
              />
            </>
          )}
          {blocker && protectedData && (
            <p
              className="rounded-lg border bg-surface-panel p-3 text-sm text-muted-foreground"
              role="status"
            >
              {blocker}
            </p>
          )}
          {sharing.error && (
            <p className="text-sm text-destructive" role="alert">
              {sharing.error}
            </p>
          )}
          {sharing.notice && (
            <p className="text-sm" role="status">
              {sharing.notice}
            </p>
          )}
          {busy && (
            <p className="text-sm text-muted-foreground" role="status">
              Finishing the member action…
            </p>
          )}
        </DialogContent>
      </Dialog>
      {pendingPreservation && sharing.accountMatches && (
        <PendingChangesDialog
          key={JSON.stringify(leaving.boards.map(({ updateIds }) => updateIds))}
          open
          action="leave this board"
          boards={leaving.boards}
          allowClear={false}
          onDownload={() => leave.download()}
          onReturnFocus={() => {
            if (leaveButton.current && !leaveButton.current.disabled) leaveButton.current.focus();
            else dialogContent.current?.focus();
          }}
          onCancel={() => {
            leave.cancel();
            setConfirmation(null);
          }}
          onRetain={async () => {
            await leave.commit();
            setConfirmation(null);
          }}
        />
      )}
    </>
  );
}
