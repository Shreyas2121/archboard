import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { selectLocalAccount } from '@archboard/sync-client';
import { BrandMark } from '@/app/components/brand-mark';
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
          <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 sm:px-8">
            <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3">
              <Link className="flex items-center gap-2.5 font-semibold" to="/boards">
                <BrandMark />
                <span>Archboard</span>
              </Link>
              <div className="flex items-center gap-2">
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
        <main
          className="mx-auto grid min-h-dvh max-w-xl place-content-center justify-items-center px-6 text-center"
          role="status"
        >
          <BrandMark />
          <h1 className="mt-6 text-3xl font-semibold">No account available offline</h1>
          <p className="mt-3 text-center text-muted-foreground">
            We could not check your session, and this device has no selected account. Reconnect and
            sign in to see your boards.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={() => void session.refetch()}>
              Retry session check
            </Button>
            <Button asChild variant="outline">
              <Link to="/demo">Open local demo</Link>
            </Button>
          </div>
        </main>
      );
    }
    return <SessionState state="error" onRetry={() => void session.refetch()} />;
  }
  if (session.data === null) {
    if (!wasAuthenticated) return <SessionState state="redirecting" />;
    return (
      <main
        className="mx-auto grid min-h-dvh max-w-xl place-content-center px-6 text-center"
        role="alert"
      >
        <h1 className="text-2xl font-semibold">Your session expired</h1>
        <p className="mt-3 text-muted-foreground">Sign in again to view your boards.</p>
        <Button asChild className="mx-auto mt-6">
          <Link to="/" search={{ returnTo: '/boards' }}>
            Sign in again
          </Link>
        </Button>
      </main>
    );
  }
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 sm:px-8">
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3">
        <Link className="flex items-center gap-2.5 font-semibold" to="/boards">
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
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
