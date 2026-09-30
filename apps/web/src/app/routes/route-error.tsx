import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { PageState } from '@/app/components/page-state';
import { Button } from '@/components/ui/button';

export function RouteError({ reset }: ErrorComponentProps) {
  return (
    <PageState
      title="The workspace could not open."
      description="Your local data was not changed. Retry this route or return home."
      icon={<AlertTriangle className="size-5 text-destructive" aria-hidden="true" />}
      role="alert"
    >
      <Button type="button" size="lg" onClick={reset}>
        <RotateCcw /> Retry
      </Button>
      <Button asChild variant="ghost" size="lg">
        <Link to="/">Back home</Link>
      </Button>
    </PageState>
  );
}
