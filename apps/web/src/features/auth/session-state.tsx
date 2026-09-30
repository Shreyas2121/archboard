import { Link } from '@tanstack/react-router';
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react';

import { PageState } from '@/app/components/page-state';
import { Button } from '@/components/ui/button';

interface SessionStateProps {
  readonly state: 'loading' | 'error' | 'redirecting';
  readonly onRetry?: () => void;
}

export function SessionState({ state, onRetry }: SessionStateProps) {
  const failed = state === 'error';
  return (
    <PageState
      role={failed ? 'alert' : 'status'}
      icon={
        failed ? (
          <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
        ) : (
          <LoaderCircle
            className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        )
      }
      title={
        failed
          ? 'We could not check your session.'
          : state === 'redirecting'
            ? 'Opening your boards…'
            : 'Checking your session…'
      }
      description={
        failed
          ? 'Your connection may be unavailable. Retry when you are ready, or use the local demo.'
          : 'This should only take a moment.'
      }
    >
      {failed && onRetry ? (
        <Button type="button" size="lg" onClick={onRetry}>
          <RotateCcw /> Retry session check
        </Button>
      ) : null}
      <Button asChild size="lg" variant={failed && onRetry ? 'ghost' : 'default'}>
        <Link to="/demo">Open local demo</Link>
      </Button>
    </PageState>
  );
}
