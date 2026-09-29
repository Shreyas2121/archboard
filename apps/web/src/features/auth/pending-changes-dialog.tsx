import { useState } from 'react';
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
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Preserve changes before you {action}</DialogTitle>
          <DialogDescription>
            {boards.length} {boards.length === 1 ? 'board has' : 'boards have'} {updateCount}{' '}
            changes saved on this device without server receipts. Retaining leaves private board
            data on this device under the old account; another account cannot open it. Anyone with
            access to this browser profile may still be able to recover that local data.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Download one recovery file containing the graphs and exact queued update bytes before
          choosing to clear. Check that the download completed. Clearing deletes only these board
          namespaces on this device.
        </p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {exported && (
          <p className="text-sm" role="status">
            Recovery download requested. Check the file before clearing.
          </p>
        )}
        <DialogFooter className="sm:flex-wrap">
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
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setExported(false);
                await downloadPendingWork(boards);
                setExported(true);
              }, 'Recovery export failed. Local copies were retained.')
            }
          >
            Download recovery
          </Button>
          <Button
            type="button"
            variant="destructive"
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
