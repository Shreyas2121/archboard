import { useEffect, useState, type RefObject } from 'react';
import {
  LOCAL_DEMO_USER_KEY,
  readBoardStorageHealth,
  type BoardStorageHealth,
} from '@archboard/sync-client';
import { Download, RotateCcw } from 'lucide-react';

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
          <DialogTitle>Local storage</DialogTitle>
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
          <div className="grid gap-2 text-sm" role="status">
            {visibleReport.readError && (
              <p className="text-destructive" role="alert">
                Local records could not be read. Existing data was left unchanged.
              </p>
            )}
            <p>
              Local board copy:{' '}
              {visibleReport.readError ? 'Unknown' : currentCopy ? 'Available' : 'Unavailable'}
            </p>
            <p>{localWriteDescription(snapshot?.writer.persistence ?? null)}</p>
            {snapshot?.writer.persistence?.diagnostic && (
              <p className="text-destructive">{snapshot.writer.persistence.diagnostic}</p>
            )}
            {isDemo ? (
              <p>Pending server updates: not applicable to the local demo</p>
            ) : (
              <p>
                Pending server updates:{' '}
                {visibleReport.readError ? 'Unknown' : visibleReport.health?.pendingCount}
                {visibleReport.readError ? '' : ' (at last check)'}
              </p>
            )}
            <p>
              Board details cached:{' '}
              {metadataAt ? (
                <time dateTime={metadataAt}>{new Date(metadataAt).toLocaleString()}</time>
              ) : (
                'Unavailable'
              )}
            </p>
            <p>
              Local snapshot stored:{' '}
              {snapshotAt ? (
                <time dateTime={snapshotAt}>{new Date(snapshotAt).toLocaleString()}</time>
              ) : (
                'Unavailable'
              )}
            </p>
            <p>
              Browser reported usage: {formatStorageBytes(visibleReport.estimate?.usage)}; quota:{' '}
              {formatStorageBytes(visibleReport.estimate?.quota)}
            </p>
            <p className="text-xs text-muted-foreground">
              Usage and quota are browser estimates for this origin, not a board-specific guarantee.
              A queued update is not saved to the server until acknowledged.
            </p>
          </div>
        )}
        {exportError && (
          <p className="text-sm text-destructive" role="alert">
            {exportError}
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
            variant="outline"
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
