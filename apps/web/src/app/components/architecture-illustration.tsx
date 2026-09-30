import { ArrowRight, Database, Laptop, Server } from 'lucide-react';

export function ArchitectureIllustration() {
  return (
    <div className="rounded-lg border bg-surface-canvas p-4 sm:p-6" aria-hidden="true">
      <p className="mb-6 text-xs font-medium text-muted-foreground">A system, at a glance</p>
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-lg border bg-card p-3 sm:flex-col sm:items-start">
          <Laptop className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Client</span>
        </div>
        <ArrowRight className="size-4 shrink-0 rotate-90 self-center text-edge sm:rotate-0" />
        <div className="flex-[2] rounded-lg border border-dashed border-edge p-3">
          <p className="mb-3 text-xs text-muted-foreground">Application boundary</p>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card p-3 sm:flex-col sm:items-start">
              <Server className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">API</span>
            </div>
            <ArrowRight className="size-4 shrink-0 rotate-90 self-center text-edge sm:rotate-0" />
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card p-3 sm:flex-col sm:items-start">
              <Database className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Database</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 border-l-2 border-primary pl-3 text-xs leading-5 text-muted-foreground">
        Make dependencies visible before the next change.
      </p>
    </div>
  );
}
