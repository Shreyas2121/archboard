import { useState } from 'react';
import { LogOut } from 'lucide-react';
import {
  clearAccountBoardNamespaces,
  listAccountPendingBoards,
  type PendingAccountBoard,
} from '@archboard/sync-client';

import { Button } from '@/components/ui/button';

import { PendingChangesDialog } from './pending-changes-dialog';
import { signOut } from './session-query';

interface SignOutControlProps {
  readonly userId: string;
  readonly onComplete: () => Promise<void>;
}

export function SignOutControl({ userId, onComplete }: SignOutControlProps) {
  const [busy, setBusy] = useState(false);
  const [pendingBoards, setPendingBoards] = useState<readonly PendingAccountBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const account = { deploymentOrigin: window.location.origin, userId };

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await signOut(userId);
      setPendingBoards(null);
      await onComplete();
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    setBusy(true);
    setError(null);
    let boards: readonly PendingAccountBoard[];
    try {
      boards = await listAccountPendingBoards(account);
    } catch {
      setError('Could not check pending changes. Sign-out was not started.');
      setBusy(false);
      return;
    }
    if (boards.length > 0) {
      setPendingBoards(boards);
      setBusy(false);
      return;
    }
    try {
      await finish();
    } catch {
      setError('Sign-out could not finish. Check the current session status and retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void begin()}
      >
        <LogOut /> {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {pendingBoards && (
        <PendingChangesDialog
          open
          action="sign out"
          boards={pendingBoards}
          onCancel={() => setPendingBoards(null)}
          onRetain={finish}
          onClear={async () => {
            await clearAccountBoardNamespaces(account, pendingBoards);
            await finish();
          }}
        />
      )}
    </>
  );
}
