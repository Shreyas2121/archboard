import { Link } from '@tanstack/react-router';
import { ArrowLeft, Compass } from 'lucide-react';

import { PageState } from '@/app/components/page-state';
import { Button } from '@/components/ui/button';

export function NotFoundRoute() {
  return (
    <PageState
      title="Page not found"
      description="The page does not exist, but your local workspace is ready."
      icon={<Compass className="size-5 text-muted-foreground" aria-hidden="true" />}
    >
      <Button asChild size="lg">
        <Link to="/demo">Open local demo</Link>
      </Button>
      <Button asChild variant="ghost" size="lg">
        <Link to="/">
          <ArrowLeft /> Back home
        </Link>
      </Button>
    </PageState>
  );
}
