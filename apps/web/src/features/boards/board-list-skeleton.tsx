const LOADING_ENTRY_COUNT = 3;

export function BoardListSkeleton({ label = 'Loading boards' }: { readonly label?: string }) {
  return (
    <div className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={label}>
      {Array.from({ length: LOADING_ENTRY_COUNT }, (_, index) => (
        <div key={index} className="grid gap-3 rounded-lg border bg-card p-4" aria-hidden="true">
          <div className="h-6 w-2/3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
          <div className="grid min-h-10 gap-2">
            <div className="h-4 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
            <div className="h-4 w-3/4 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
          </div>
          <div className="border-t pt-3">
            <div className="h-4 w-1/2 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
