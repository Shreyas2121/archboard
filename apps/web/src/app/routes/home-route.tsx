import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowRight, Database, GitBranch, Laptop, LogIn } from 'lucide-react';
import { readLocalSignOutPending } from '@archboard/sync-client';

import { BrandMark } from '@/app/components/brand-mark';
import { ArchitectureIllustration } from '@/app/components/architecture-illustration';
import { PageState } from '@/app/components/page-state';
import { ThemeControl } from '@/app/components/theme-control';
import { Button } from '@/components/ui/button';
import { safeReturnPath, SessionState, useCurrentUser } from '@/features/auth';
import { startSocialSignIn } from '@/features/auth/social-sign-in';

const FEATURES = [
  {
    title: 'Local by design',
    description: 'The local demo keeps its workspace on this device.',
    icon: Database,
  },
  {
    title: 'Built for systems',
    description: 'Shape components, boundaries, data, and their relationships.',
    icon: GitBranch,
  },
  {
    title: 'No account required',
    description: 'Open the demo and start mapping without a sign-in step.',
    icon: Laptop,
  },
] as const;

export function HomeRoute() {
  const navigate = useNavigate();
  const { returnTo: requestedReturnTo } = useSearch({ from: '/' });
  const returnTo = safeReturnPath(requestedReturnTo);
  const session = useCurrentUser();
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(false);
  const serverSignOutPending = readLocalSignOutPending(window.location.origin) !== null;

  useEffect(() => {
    if (session.isSuccess && session.data) {
      if (returnTo?.startsWith('/invite/')) {
        void navigate({
          to: '/invite/$token',
          params: { token: returnTo.slice('/invite/'.length) },
          replace: true,
        });
      } else void navigate({ to: '/boards', replace: true });
    }
  }, [navigate, returnTo, session.data, session.isSuccess]);

  async function handleSignIn() {
    setSigningIn(true);
    setSignInError(false);
    try {
      if (!(await startSocialSignIn(returnTo ?? '/boards'))) setSignInError(true);
    } catch {
      setSignInError(true);
    } finally {
      setSigningIn(false);
    }
  }

  if (session.isPending) return <SessionState state="loading" />;
  if (serverSignOutPending) {
    return (
      <PageState
        title="Signed out on this device"
        description="Server session invalidation is pending. Reconnect and retry before signing in to an account again. Your retained local boards stay under the previous account."
        role="status"
      >
        <Button type="button" size="lg" onClick={() => void session.refetch()}>
          Retry server sign-out
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link to="/demo">Open local demo</Link>
        </Button>
      </PageState>
    );
  }
  if (session.isError) {
    return <SessionState state="error" onRetry={() => void session.refetch()} />;
  }
  if (session.data) return <SessionState state="redirecting" />;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 sm:px-8">
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3">
        <Link
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
          to="/"
          aria-label="Archboard home"
        >
          <BrandMark />
          <span>Archboard</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeControl />
          <Button asChild variant="ghost" size="sm">
            <Link to="/demo">Open local demo</Link>
          </Button>
        </div>
      </header>
      <main>
        <section
          className="grid items-center gap-10 border-b border-border/70 py-12 sm:py-16 lg:grid-cols-2 lg:gap-12 lg:py-20"
          aria-labelledby="hero-title"
        >
          <div>
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Architecture, made tangible
            </p>
            <h1
              id="hero-title"
              className="max-w-2xl text-balance text-5xl leading-[3.25rem] font-semibold tracking-[-0.035em] lg:text-[4rem] lg:leading-[4.25rem]"
            >
              Think in systems.
              <br />
              See the whole board.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-base leading-6 text-muted-foreground">
              Map the software you have and the software you are building next. Explore in the local
              demo, or sign in to manage your boards.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="lg"
                disabled={signingIn}
                onClick={() => void handleSignIn()}
              >
                <LogIn /> {signingIn ? 'Connecting to GitHub…' : 'Continue with GitHub'}
              </Button>
              <Button asChild variant="ghost" size="lg">
                <Link to="/demo">
                  Open local demo <ArrowRight />
                </Link>
              </Button>
            </div>
            {signInError ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                GitHub sign-in could not start. Please try again.
              </p>
            ) : null}
          </div>
          <ArchitectureIllustration />
        </section>
        <section
          className="grid border-b border-border/70 md:grid-cols-3"
          aria-labelledby="features-title"
        >
          <h2 id="features-title" className="sr-only">
            Why Archboard
          </h2>
          {FEATURES.map((feature) => (
            <article
              className="border-b border-border/70 py-6 last:border-b-0 md:border-r md:border-b-0 md:px-6 md:first:pl-0 md:last:border-r-0 md:last:pr-0"
              key={feature.title}
            >
              <feature.icon className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold">{feature.title}</h3>
              <p className="mt-2 max-w-sm text-sm leading-5 text-muted-foreground">
                {feature.description}
              </p>
            </article>
          ))}
        </section>
      </main>
      <footer className="flex items-center justify-between py-6 text-xs text-muted-foreground">
        <span>Local demo and connected boards</span>
        <span>Archboard</span>
      </footer>
    </div>
  );
}
