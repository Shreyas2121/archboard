import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { selectLocalAccount } from '@archboard/sync-client';
import { BrandMark } from '@/app/components/brand-mark';
import { PageState } from '@/app/components/page-state';
import { ThemeControl } from '@/app/components/theme-control';
import { Button } from '@/components/ui/button';
import { SessionState, useCurrentUser } from '@/features/auth';
import { SignOutControl } from '@/features/auth/sign-out-control';
import { BoardDashboard } from '@/features/boards/board-dashboard';
import { CachedBoardDashboard } from '@/features/boards/cached-board-dashboard';
import { ApiClientError } from '@/platform/api';

const HTTP_SERVER_ERROR = 500;

export function BoardsEntryRoute() {
  const navigate = useNavigate();
  const session = useCurrentUser();
  const [wasAuthenticated, setWasAuthenticated] = useState(false);
  useEffect(() => {
    if (session.data) setWasAuthenticated(true);
    if (session.isSuccess && session.data === null && !wasAuthenticated) {
      void navigate({ to: '/', search: { returnTo: '/boards' }, replace: true });
    }
  }, [navigate, session.data, session.isSuccess, wasAuthenticated]);
  if (session.isPending) return <SessionState state="loading" />;
  if (session.isError) {
    const serverUnavailable =
      session.error instanceof ApiClientError &&
      (session.error.kind === 'network' ||
        (session.error.kind === 'http' && (session.error.status ?? 0) >= HTTP_SERVER_ERROR));
    if (serverUnavailable) {
      const selected = selectLocalAccount(window.location.origin, { kind: 'network-unavailable' });
      if (selected) {
        return (
          <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 sm:px-8">
            <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3">
              <Link
                className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
                to="/boards"
                aria-label="Archboard boards"
              >
                <BrandMark />
                <span>Archboard</span>
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <ThemeControl />
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link to="/demo">Local demo</Link>
                </Button>
                <SignOutControl
                  userId={selected.userId}
                  onComplete={async () => {
                    await navigate({ to: '/', search: {}, replace: true });
                  }}
                />
              </div>
            </header>
            <CachedBoardDashboard sessionUncertain onRetry={() => void session.refetch()} />
          </div>
        );
      }
      return (
        <PageState
          title="No account available offline"
          description="We could not check your session, and this device has no selected account. Reconnect and sign in to see your boards."
          role="status"
        >
          <Button type="button" size="lg" onClick={() => void session.refetch()}>
            Retry session check
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link to="/demo">Open local demo</Link>
          </Button>
        </PageState>
      );
    }
    return <SessionState state="error" onRetry={() => void session.refetch()} />;
  }
  if (session.data === null) {
    if (!wasAuthenticated) return <SessionState state="redirecting" />;
    return (
      <PageState
        title="Your session expired"
        description="Sign in again to view your boards."
        role="alert"
      >
        <Button asChild size="lg">
          <Link to="/" search={{ returnTo: '/boards' }}>
            Sign in again
          </Link>
        </Button>
      </PageState>
    );
  }
  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 sm:px-8">
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3">
        <Link
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
          to="/boards"
          aria-label="Archboard boards"
        >
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <ThemeControl />
          <span
            className="max-w-40 truncate text-sm text-muted-foreground"
            title={session.data.name}
          >
            Signed in as {session.data.name}
          </span>
          <Button asChild type="button" variant="ghost" size="sm">
            <Link to="/demo">Local demo</Link>
          </Button>
          <SignOutControl
            userId={session.data.id}
            onComplete={async () => {
              await navigate({ to: '/', search: {}, replace: true });
            }}
          />
        </div>
      </header>
      <BoardDashboard />
    </div>
  );
}
