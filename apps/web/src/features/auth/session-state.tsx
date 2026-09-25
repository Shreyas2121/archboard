import { Link } from '@tanstack/react-router';
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react';

import { BrandMark } from '@/app/components/brand-mark';
import { Button } from '@/components/ui/button';

interface SessionStateProps {
  readonly state: 'loading' | 'error' | 'redirecting';
  readonly onRetry?: () => void;
}

export function SessionState({ state, onRetry }: SessionStateProps) {
  const failed = state === 'error';
  return (
    <main
      className="mx-auto grid min-h-dvh max-w-xl place-content-center justify-items-center px-6 text-center"
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <BrandMark />
      {failed ? (
        <AlertTriangle className="mt-10 size-9 text-destructive" aria-hidden="true" />
      ) : (
        <LoaderCircle
          className="mt-10 size-9 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        {failed
          ? 'We could not check your session.'
          : state === 'redirecting'
            ? 'Opening your boards…'
            : 'Checking your session…'}
      </h1>
      <p className="mt-3 text-muted-foreground">
        {failed
          ? 'Your connection may be unavailable. Retry when you are ready, or use the local demo.'
          : 'This should only take a moment.'}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {failed && onRetry ? (
          <Button type="button" onClick={onRetry}>
            <RotateCcw /> Retry session check
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/demo">Open local demo</Link>
        </Button>
      </div>
    </main>
  );
}
