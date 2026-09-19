import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { BrandMark } from '@/app/components/brand-mark';
import { Button } from '@/components/ui/button';

export function RouteError({ reset }: ErrorComponentProps) {
  return (
    <main
      className="mx-auto grid min-h-dvh max-w-xl place-content-center justify-items-center px-6 text-center"
      role="alert"
    >
      <BrandMark />
      <AlertTriangle className="mt-10 size-10 text-destructive" aria-hidden="true" />
      <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-destructive">
        Route error
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
        The workspace could not open.
      </h1>
      <p className="mt-4 text-lg leading-7 text-muted-foreground">
        Your local data was not changed. Retry this route or return home.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={reset}>
          <RotateCcw /> Retry
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Back home</Link>
        </Button>
      </div>
    </main>
  );
}
