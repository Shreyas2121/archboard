import { useState } from 'react';
import { CheckCircle2, Download, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { PendingAccountBoard } from '@archboard/sync-client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { downloadPendingWork } from './pending-work';

interface PendingChangesDialogProps {
  readonly open: boolean;
  readonly action: 'sign out' | 'switch accounts';
  readonly boards: readonly PendingAccountBoard[];
  readonly onCancel: () => void;
  readonly onRetain: () => Promise<void>;
  readonly onClear: () => Promise<void>;
}

export function PendingChangesDialog({
  open,
  action,
  boards,
  onCancel,
  onRetain,
  onClear,
}: PendingChangesDialogProps) {
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateCount = boards.reduce((count, board) => count + board.pendingCount, 0);

  async function run(operation: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2">
            <ShieldAlert className="mt-1 size-5 shrink-0 text-status-warning" aria-hidden="true" />
            <span>Preserve changes before you {action}</span>
          </DialogTitle>
          <DialogDescription>
            {boards.length} {boards.length === 1 ? 'board has' : 'boards have'} {updateCount}{' '}
            changes saved on this device without server receipts. Retaining leaves private board
            data on this device under the old account; another account cannot open it. Anyone with
            access to this browser profile may still be able to recover that local data.
          </DialogDescription>
        </DialogHeader>
        <section
          className="grid gap-3 rounded-lg border bg-surface-panel p-3"
          aria-label="Recovery before clearing"
        >
          <p className="text-sm leading-5 text-muted-foreground">
            Download one recovery file containing the graphs and exact queued update bytes before
            choosing to clear. Check that the download completed. Clearing deletes only these board
            namespaces on this device.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setExported(false);
                await downloadPendingWork(boards);
                setExported(true);
              }, 'Recovery export failed. Local copies were retained.')
            }
          >
            <Download /> Download recovery
          </Button>
        </section>
        {error && (
          <p
            className="flex items-start gap-2 rounded-control border bg-status-danger-surface p-3 text-sm text-destructive"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}
        {exported && (
          <p className="flex items-start gap-2 text-sm text-status-success" role="status">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Recovery download requested. Check the file before clearing.
          </p>
        )}
        {busy && (
          <p className="text-xs text-muted-foreground" role="status">
            Finishing this action…
          </p>
        )}
        <DialogFooter className="flex-col sm:grid sm:grid-cols-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run(onRetain, 'Could not continue.')}
          >
            Retain local copies
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-auto min-h-9 whitespace-normal sm:col-span-2"
            disabled={busy || !exported}
            onClick={() => void run(onClear, 'Local copies could not be cleared.')}
          >
            Clear copies and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
