import { Link } from '@tanstack/react-router';
import { ArrowLeft, Compass } from 'lucide-react';

import { BrandMark } from '@/app/components/brand-mark';
import { Button } from '@/components/ui/button';

export function NotFoundRoute() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-xl place-content-center justify-items-center px-6 text-center">
      <BrandMark />
      <Compass className="mt-10 size-10 text-primary" aria-hidden="true" />
      <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        404
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
        This route is outside the boundary.
      </h1>
      <p className="mt-4 text-lg leading-7 text-muted-foreground">
        The page does not exist, but your local workspace is ready.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/demo">Open local demo</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft /> Back home
          </Link>
        </Button>
      </div>
    </main>
  );
}
