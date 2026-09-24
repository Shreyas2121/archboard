import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, LogOut } from 'lucide-react';

import { BrandMark } from '@/app/components/brand-mark';
import { Button } from '@/components/ui/button';
import { SessionState, signOut, useCurrentUser } from '@/features/auth';

export function BoardsEntryRoute() {
  const navigate = useNavigate();
  const session = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  useEffect(() => {
    if (session.isSuccess && session.data === null) {
      void navigate({ to: '/', search: { returnTo: '/boards' }, replace: true });
    }
  }, [navigate, session.data, session.isSuccess]);

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
  if (session.isError) {
    return <SessionState state="error" onRetry={() => void session.refetch()} />;
  }
  if (session.data === null) return <SessionState state="redirecting" />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 sm:px-8">
      <header className="flex min-h-20 items-center justify-between gap-4 border-b border-border/70">
        <Link className="flex items-center gap-2.5 font-semibold" to="/boards">
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <Button
          type="button"
          variant="outline"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          <LogOut /> {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </header>
      <main className="grid flex-1 content-center py-16">
        <p className="text-sm font-semibold text-primary">Signed in as {session.data.name}</p>
        <h1 className="mt-4 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Your boards are next.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-7 text-muted-foreground">
          Your session is ready. The board dashboard is coming in the next step. The local demo is
          available now and keeps its data on this device.
        </p>
        {signOutError ? (
          <p className="mt-5 text-sm text-destructive" role="alert">
            Sign-out could not finish. Please try again.
          </p>
        ) : null}
        <Button asChild className="mt-8 w-fit">
          <Link to="/demo">
            Open local demo <ArrowRight />
          </Link>
        </Button>
      </main>
    </div>
  );
}
