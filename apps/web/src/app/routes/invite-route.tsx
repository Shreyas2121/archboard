import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CatchBoundary, Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { inviteTokenSchema } from '@archboard/contracts';
import { readLocalSignOutPending } from '@archboard/sync-client';
import { PageState } from '@/app/components/page-state';
import { Button } from '@/components/ui/button';
import { CURRENT_USER_QUERY_KEY, useCurrentUser } from '@/features/auth';
import { currentUserQueryOptions } from '@/features/auth/current-user-query';
import { startSocialSignIn } from '@/features/auth/social-sign-in';
import { InviteAcceptanceFlow } from '@/features/boards/invite-acceptance';
import { inviteFailure } from '@/features/boards/invite-failure';
import { INVITE_STAGE_COPY } from '@/features/boards/invite-stage-copy';
import { acceptInvite, previewInvite } from '@/features/boards/invite-recipient-api';
import { refreshAcceptedBoard } from '@/features/boards/refresh-accepted-board';
import { RouteError } from './route-error';

export function InviteRoute() {
  const { token } = useParams({ from: '/invite/$token' });
  // Catch here before the router's development boundary logs the token-bearing match ID.
  return (
    <CatchBoundary
      getResetKey={() => token}
      errorComponent={RouteError}
      onCatch={() => console.warn('Invitation view failed.')}
    >
      <InvitePage />
    </CatchBoundary>
  );
}

function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  const session = useCurrentUser();
  const refetchSession = session.refetch;
  const [hadSession, setHadSession] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(false);
  useEffect(() => {
    if (session.isSuccess && session.data) setHadSession(true);
  }, [session.isSuccess, session.data]);
  useEffect(() => {
    const connected = () => {
      setOnline(true);
      void refetchSession();
    };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, [refetchSession]);
  async function signIn() {
    if (signingIn || !navigator.onLine) return;
    setSigningIn(true);
    setSignInError(false);
    try {
      if (!(await startSocialSignIn(`/invite/${token}`))) setSignInError(true);
    } catch {
      setSignInError(true);
    } finally {
      setSigningIn(false);
    }
  }
  const back = (
    <Button asChild variant="ghost">
      <Link to="/boards">Back to boards</Link>
    </Button>
  );
  if (!inviteTokenSchema.safeParse(token).success)
    return (
      <PageState {...INVITE_STAGE_COPY.unavailable} role="alert">
        {back}
      </PageState>
    );
  if (!online && !(session.isSuccess && session.data))
    return (
      <PageState
        title="Invitation unavailable offline"
        description="Reconnect to sign in, review or accept this invitation. Nothing will be accepted automatically."
        role="status"
      >
        {back}
      </PageState>
    );
  if (session.isPending)
    return (
      <PageState
        title="Checking your session…"
        description="Sign-in is required before invitation details can be shown."
        role="status"
      >
        {back}
      </PageState>
    );
  if (session.isError)
    return (
      <PageState
        title="Session check unavailable"
        description="We could not verify your account. Retry your connection; this does not mean the invitation is invalid."
        role="alert"
      >
        <Button type="button" onClick={() => void session.refetch()}>
          Retry session check
        </Button>
        {back}
      </PageState>
    );
  if (!session.data) {
    const pendingSignOut = readLocalSignOutPending(window.location.origin) !== null;
    return (
      <PageState
        title={
          pendingSignOut
            ? 'Sign-out is pending'
            : hadSession
              ? 'Your session expired'
              : 'Sign in to review this invitation'
        }
        description={
          pendingSignOut
            ? 'Retry server sign-out before signing in again. Your retained local data stays in its original account.'
            : 'Sign in with the account that should receive access. You will review the invitation before explicitly accepting.'
        }
        role="status"
      >
        {pendingSignOut ? (
          <Button type="button" onClick={() => void session.refetch()}>
            Retry server sign-out
          </Button>
        ) : (
          <Button type="button" disabled={signingIn} onClick={() => void signIn()}>
            {signingIn ? 'Connecting to GitHub…' : 'Continue with GitHub'}
          </Button>
        )}
        {signInError && (
          <span className="text-sm text-destructive" role="alert">
            Sign-in could not start. Please retry.
          </span>
        )}
        {back}
      </PageState>
    );
  }
  // Replace account-bound local results whenever either the actor or invitation changes.
  return (
    <AuthenticatedInvite
      key={`${session.data.id}:${token}`}
      token={token}
      accountId={session.data.id}
      accountName={session.data.name}
      online={online}
    />
  );
}

function AuthenticatedInvite({
  token,
  accountId,
  accountName,
  online,
}: {
  readonly token: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly online: boolean;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const latestNavigate = useRef(navigate);
  latestNavigate.current = navigate;
  const [flow] = useState(() => {
    const current = () =>
      client.getQueryState(CURRENT_USER_QUERY_KEY)?.status === 'success' &&
      client.getQueryData<{ id: string } | null>(CURRENT_USER_QUERY_KEY)?.id === accountId;
    return new InviteAcceptanceFlow({
      current,
      authenticate: async (signal) => {
        if (!navigator.onLine) throw new Error('Reconnect to continue.');
        const session = await client.fetchQuery({ ...currentUserQueryOptions, staleTime: 0 });
        return !signal.aborted && session?.id === accountId && current();
      },
      preview: (signal) => previewInvite(token, signal),
      accept: (signal) => acceptInvite(token, signal),
      failure: inviteFailure,
      alreadyMember: (result, preview) => {
        // The frozen response has no prior-membership flag. Only these roles prove existing access.
        return (
          result.effectiveRole === 'owner' ||
          (preview?.role === 'viewer' && result.effectiveRole === 'editor')
        );
      },
      openBoard: async (result, signal) => {
        await refreshAcceptedBoard(
          client,
          { deploymentOrigin: window.location.origin, accountId, boardId: result.boardId },
          signal,
          current,
        );
        if (current() && !signal.aborted)
          await latestNavigate.current({
            to: '/boards/$boardId',
            params: { boardId: result.boardId },
            replace: true,
          });
      },
    });
  });
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  useEffect(() => {
    flow.activate();
    return () => flow.dispose();
  }, [flow]);
  useEffect(() => {
    if (online) void flow.load();
    else flow.cancelForOffline();
  }, [flow, online]);
  const copy = online
    ? INVITE_STAGE_COPY[state.stage]
    : {
        title: 'Invitation unavailable offline',
        description:
          'Any displayed preview may be stale. Reconnect to review or explicitly confirm acceptance; nothing will be submitted automatically.',
      };
  const busy = state.stage === 'loading' || state.stage === 'accepting' || state.opening;
  return (
    <PageState
      {...copy}
      role={
        ['ready', 'accepted', 'already-member', 'loading', 'accepting', 'idle'].includes(
          state.stage,
        )
          ? 'status'
          : 'alert'
      }
    >
      <section
        className="grid w-full gap-3 text-left"
        aria-label="Invitation review"
        aria-busy={busy}
      >
        <p className="break-words text-sm text-muted-foreground">Signed in as {accountName}</p>
        {state.preview && (
          <dl className="grid gap-2 rounded-lg border bg-card p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Preview fetched</dt>
              <dd>
                {state.previewFetchedAt === null
                  ? 'Unavailable'
                  : new Date(state.previewFetchedAt).toLocaleString()}
                {!online && ' · may be stale'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Board</dt>
              <dd className="break-words font-medium">{state.preview.boardTitle}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Invited by</dt>
              <dd className="break-words">{state.preview.inviterName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Offered role</dt>
              <dd>{state.preview.role === 'editor' ? 'Editor' : 'Viewer'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{new Date(state.preview.expiresAt).toLocaleString()}</dd>
            </div>
          </dl>
        )}
        {state.stage === 'ready' && (
          <Button type="button" disabled={!online || busy} onClick={() => void flow.accept()}>
            Accept invitation
          </Button>
        )}
        {(state.stage === 'uncertain' || state.stage === 'exhausted') && (
          <Button type="button" disabled={!online || busy} onClick={() => void flow.accept()}>
            Confirm previous acceptance for this account
          </Button>
        )}
        {state.result && (
          <>
            <p className="text-sm" role="status">
              Confirmed role: {state.result.effectiveRole}
            </p>
            {state.refreshFailed && (
              <p className="text-sm text-destructive" role="alert">
                Access was confirmed, but the board could not refresh or open. Retry opening;
                acceptance will not be submitted again.
              </p>
            )}
            <Button type="button" disabled={!online || busy} onClick={() => void flow.openBoard()}>
              Open accepted board
            </Button>
          </>
        )}
        {['network', 'archived', 'expired', 'unavailable'].includes(state.stage) && (
          <Button
            type="button"
            variant="outline"
            disabled={!online}
            onClick={() => void flow.load()}
          >
            Retry invitation review
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link to="/boards">Back to boards</Link>
        </Button>
      </section>
    </PageState>
  );
}
