import { useState } from 'react';
import type { CreateInvite } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { canReconcileInvite } from './invite-request';
import type { useBoardInvites } from './use-board-invites';

export function BoardInviteControls({
  invites,
  blocked,
}: {
  readonly invites: ReturnType<typeof useBoardInvites>;
  readonly blocked: boolean;
}) {
  const [role, setRole] = useState<CreateInvite['role']>('viewer');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  if (!invites.owner) return null;
  const disabled = blocked || !invites.allowed;
  const pages = invites.list.data?.pages;
  const rows = pages?.flatMap((page) => page.data);
  const fresh = invites.fresh;
  const retryable = invites.uncertain && canReconcileInvite(invites.uncertain, Date.now());
  return (
    <section
      className="grid gap-3 border-t pt-4"
      aria-label="Board invitations"
      aria-busy={invites.busy}
    >
      <h3 className="text-sm font-semibold">Invitations</h3>
      <p className="text-xs text-muted-foreground">
        Links are single-use and expire after seven days. Share manually with the intended
        recipient. Fresh links and recovery requests remain only in memory; reload loses them.
        Review existing invitations before issuing a replacement after reload.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="invite-role">Invitation role</Label>
          <Select
            value={role}
            disabled={disabled || invites.uncertain !== null}
            onValueChange={(value) => {
              if (value === 'viewer' || value === 'editor') setRole(value);
            }}
          >
            <SelectTrigger id="invite-role" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          disabled={disabled || invites.uncertain !== null || fresh?.inviteUrl != null}
          onClick={() => void invites.create(role)}
        >
          Create invitation
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || invites.list.isFetching}
          onClick={() => void invites.refresh().catch(() => undefined)}
        >
          Refresh invitations
        </Button>
      </div>
      {invites.uncertain && (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-sm" role="status">
            Creation is unconfirmed. The original role and request key are retained. No new
            invitation will be issued automatically.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => void (retryable ? invites.reconcile() : invites.reviewExpired())}
          >
            {retryable ? 'Reconcile original request' : 'Review list after retry expiry'}
          </Button>
        </div>
      )}
      {fresh && (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-sm">
            {fresh.role === 'editor' ? 'Editor' : 'Viewer'} invitation · Created{' '}
            {new Date(fresh.createdAt).toLocaleString()} · Expires{' '}
            {new Date(fresh.expiresAt).toLocaleString()}
          </p>
          {fresh.inviteUrl ? (
            <>
              <Label htmlFor="fresh-invite-link">
                New invitation link — copy manually or use Copy link
              </Label>
              <Input
                id="fresh-invite-link"
                value={fresh.inviteUrl}
                readOnly
                autoComplete="off"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="outline" onClick={() => void invites.copy()}>
                Copy link
              </Button>
              <p className="text-xs text-muted-foreground">
                Closing this dialog removes this link from view. It cannot be recovered from the
                list.
              </p>
            </>
          ) : (
            <p className="text-sm">
              The original link cannot be recovered. Revoke this invitation in the list before
              creating a replacement.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={invites.busy}
            onClick={invites.dismissFresh}
          >
            Done reviewing this result (discard link)
          </Button>
        </div>
      )}
      {invites.list.isFetching && (
        <p role="status" className="text-sm">
          Loading invitations…
        </p>
      )}
      {invites.list.isError && (
        <p role="alert" className="text-sm text-destructive">
          Invitations could not refresh. Cached entries may be stale.
        </p>
      )}
      {rows ? (
        <>
          <p className="text-xs text-muted-foreground" role="status">
            {invites.list.isStale || disabled
              ? 'Cached invitations · may be stale'
              : 'Invitations fetched from server'}
            {' · '}Fetched {new Date(invites.list.dataUpdatedAt).toLocaleString()}
          </p>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No invitations.</p>}
          <ul
            className="max-h-56 overflow-y-auto divide-y rounded-lg border"
            aria-label="Invitation metadata"
          >
            {rows.map((invite) => (
              <li key={invite.id} className="grid gap-2 p-3">
                <p className="text-sm">
                  {invite.role === 'editor' ? 'Editor' : 'Viewer'} ·{' '}
                  {invite.status === 'accepted'
                    ? 'Consumed'
                    : invite.status === 'active'
                      ? 'Active (last fetched)'
                      : invite.status === 'expired'
                        ? 'Expired'
                        : 'Revoked'}
                  {fresh?.id === invite.id && ' · Current result'}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  Created by {invite.createdBy.name} · {new Date(invite.createdAt).toLocaleString()}{' '}
                  · Expires {new Date(invite.expiresAt).toLocaleString()}
                </p>
                {invite.status === 'active' &&
                  (confirmRevoke === invite.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">Revoke this invitation?</span>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={invites.busy}
                        onClick={() => setConfirmRevoke(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={disabled}
                        onClick={() => {
                          void invites.revoke(invite.id);
                          setConfirmRevoke(null);
                        }}
                      >
                        Confirm revoke
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-self-start"
                      disabled={disabled}
                      onClick={() => setConfirmRevoke(invite.id)}
                    >
                      Revoke invitation
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
          {invites.list.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || invites.list.isFetching}
              onClick={() => void invites.list.fetchNextPage().catch(() => undefined)}
            >
              Load more invitations
            </Button>
          )}
        </>
      ) : (
        !invites.list.isFetching && (
          <p className="text-sm text-muted-foreground">
            No invitation list is available on this device. Reconnect and refresh.
          </p>
        )
      )}
      {invites.busy && (
        <p className="text-sm" role="status">
          Finishing invitation action…
        </p>
      )}
      {invites.notice && (
        <p className="text-sm" role="status">
          {invites.notice}
        </p>
      )}
      {invites.error && (
        <p className="text-sm text-destructive" role="alert">
          {invites.error}
        </p>
      )}
    </section>
  );
}
