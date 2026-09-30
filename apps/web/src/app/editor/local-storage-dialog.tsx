import { useEffect, useState, type RefObject } from 'react';
import {
  LOCAL_DEMO_USER_KEY,
  readBoardStorageHealth,
  type BoardStorageHealth,
} from '@archboard/sync-client';
import { Database, Download, RotateCcw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EditorSession, EditorSessionSnapshot } from '@/features/editor/application';
import { downloadRecoveryArtifact } from '@/features/editor/demo';

import { formatStorageBytes, localWriteDescription } from './storage-health-state';

interface StorageReport {
  readonly session: EditorSession;
  readonly health: BoardStorageHealth | null;
  readonly estimate: StorageEstimate | null;
  readonly readError: boolean;
}

interface LocalStorageDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly session: EditorSession | null;
  readonly snapshot: EditorSessionSnapshot | null;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export function LocalStorageDialog({
  open,
  onOpenChange,
  session,
  snapshot,
  returnFocusRef,
}: LocalStorageDialogProps) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || session === null) return;
    let active = true;
    setReport(null);
    void (async () => {
      const [health, estimate] = await Promise.allSettled([
        readBoardStorageHealth(session.getStorageNamespace()),
        Promise.resolve().then(() => navigator.storage?.estimate() ?? null),
      ]);
      if (!active) return;
      setReport({
        session,
        health: health.status === 'fulfilled' ? health.value : null,
        estimate: estimate.status === 'fulfilled' ? estimate.value : null,
        readError: health.status === 'rejected',
      });
    })();
    return () => {
      active = false;
    };
  }, [open, refreshKey, session]);

  const projection = snapshot?.projection ?? null;
  const visibleReport = report?.session === session ? report : null;
  const metadataAt = visibleReport?.health?.cachedMetadataAt;
  const snapshotAt = visibleReport?.health?.snapshotAt;
  const isDemo = session?.getStorageNamespace().userId === LOCAL_DEMO_USER_KEY;
  const currentCopy =
    visibleReport?.health?.hasSnapshot === true &&
    projection !== null &&
    (isDemo || metadataAt !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            Local storage
          </DialogTitle>
          <DialogDescription>
            Browser storage is best effort. It can be cleared or evicted and is not a backup of your
            board.
          </DialogDescription>
        </DialogHeader>
        {session === null || visibleReport === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking this device’s storage…
          </p>
        ) : (
          <div className="grid gap-4 text-sm" role="status">
            {visibleReport.readError && (
              <p
                className="rounded-control border bg-status-danger-surface p-3 text-destructive"
                role="alert"
              >
                Local records could not be read. Existing data was left unchanged.
              </p>
            )}
            <div className="grid gap-2 rounded-lg border bg-surface-panel p-3">
              <p className="font-medium">
                Local board copy:{' '}
                {visibleReport.readError ? 'Unknown' : currentCopy ? 'Available' : 'Unavailable'}
              </p>
              <p className="text-muted-foreground">
                {localWriteDescription(snapshot?.writer.persistence ?? null)}
              </p>
              {snapshot?.writer.persistence?.diagnostic && (
                <p className="break-words text-destructive" role="alert">
                  {snapshot.writer.persistence.diagnostic}
                </p>
              )}
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Pending server updates</dt>
                {isDemo ? (
                  <dd>Not applicable to the local demo</dd>
                ) : (
                  <dd className="tabular-nums">
                    {visibleReport.readError ? 'Unknown' : visibleReport.health?.pendingCount}
                    {visibleReport.readError ? '' : ' (at last check)'}
                  </dd>
                )}
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Board details cached</dt>
                <dd className="break-words tabular-nums">
                  {metadataAt ? (
                    <time dateTime={metadataAt}>{new Date(metadataAt).toLocaleString()}</time>
                  ) : (
                    'Unavailable'
                  )}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Local snapshot stored</dt>
                <dd className="break-words tabular-nums">
                  {snapshotAt ? (
                    <time dateTime={snapshotAt}>{new Date(snapshotAt).toLocaleString()}</time>
                  ) : (
                    'Unavailable'
                  )}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Browser reported usage / quota</dt>
                <dd className="tabular-nums">
                  {formatStorageBytes(visibleReport.estimate?.usage)} /{' '}
                  {formatStorageBytes(visibleReport.estimate?.quota)}
                </dd>
              </div>
            </dl>
            <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
              Usage and quota are browser estimates for this origin, not a board-specific guarantee.
              A queued update is not saved to the server until acknowledged.
            </p>
          </div>
        )}
        {exportError && (
          <p
            className="flex items-start gap-2 rounded-control border bg-status-danger-surface p-3 text-sm text-destructive"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{exportError}</span>
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={session === null}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RotateCcw /> Refresh
          </Button>
          <Button
            type="button"
            className="h-auto min-h-9 whitespace-normal"
            disabled={projection === null}
            onClick={() => {
              if (projection === null) return;
              setExportError(null);
              try {
                downloadRecoveryArtifact(projection);
              } catch (error) {
                setExportError(error instanceof Error ? error.message : 'Recovery export failed.');
              }
            }}
          >
            <Download /> Download in-memory recovery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
