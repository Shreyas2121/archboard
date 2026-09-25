import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { BrandMark } from '@/app/components/brand-mark';
import { Button } from '@/components/ui/button';
import { SessionState, signOut, useCurrentUser } from '@/features/auth';
import { BoardDashboard } from '@/features/boards/board-dashboard';

export function BoardsEntryRoute() {
  const navigate = useNavigate();
  const session = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [wasAuthenticated, setWasAuthenticated] = useState(false);
  useEffect(() => {
    if (session.data) setWasAuthenticated(true);
    if (session.isSuccess && session.data === null && !wasAuthenticated) {
      void navigate({ to: '/', search: { returnTo: '/boards' }, replace: true });
    }
  }, [navigate, session.data, session.isSuccess, wasAuthenticated]);
  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      await signOut();
      await navigate({ to: '/', search: {}, replace: true });
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }
  if (session.isPending) return <SessionState state="loading" />;
  if (session.isError) return <SessionState state="error" onRetry={() => void session.refetch()} />;
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            <LogOut /> {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>
      {signOutError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          Sign-out could not finish. Please try again.
        </p>
      ) : null}
      <BoardDashboard />
    </div>
  );
}
