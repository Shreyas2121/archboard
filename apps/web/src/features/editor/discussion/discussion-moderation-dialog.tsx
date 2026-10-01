import {
  MAX_COMMENT_BODY_CHARACTERS,
  commentBodySchema,
  countCommentBodyCharacters,
} from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { DiscussionModeration, ModerationSnapshot } from './discussion-moderation-state';

export function DiscussionModerationDialog({
  controller,
  snapshot,
  readable,
  writable,
  restoreFocus,
}: {
  readonly controller: DiscussionModeration;
  readonly snapshot: ModerationSnapshot;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly restoreFocus: () => void;
}) {
  const action = snapshot.action;
  const busy = snapshot.phase === 'sending' || snapshot.phase === 'refreshing';
  const valid = action?.kind !== 'edit' || commentBodySchema.safeParse(action.body).success;
  const current = snapshot.current;
  const deleted = current?.kind === 'comment' && current.value.deletedAt !== null;
  return (
    <Dialog
      open={readable && action !== null}
      onOpenChange={(open) => {
        if (!open && !busy) controller.cancel();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {action?.kind === 'edit'
              ? 'Edit message'
              : action?.kind === 'delete'
                ? 'Delete message'
                : action?.kind === 'resolve' && action.resolved
                  ? 'Resolve discussion'
                  : 'Reopen discussion'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'delete'
              ? 'Deletion leaves a permanent message marker. The original author and time stay visible.'
              : 'Changes use the displayed resource version. Drafts remain unsent until the server confirms the change.'}
          </DialogDescription>
        </DialogHeader>
        {action && (
          <p className="text-xs">
            Original version: {action.resource.version}
            {action.kind !== 'resolve' && ` · Author: ${action.resource.author.name}`}
          </p>
        )}
        {action?.kind === 'edit' && (
          <div className="grid gap-2">
            <Label htmlFor="discussion-edit">Unsent edit</Label>
            <Textarea
              id="discussion-edit"
              value={action.body}
              disabled={busy || !writable}
              aria-invalid={!valid}
              aria-describedby="discussion-edit-count"
              onChange={(event) => controller.setBody(event.target.value)}
            />
            <p id="discussion-edit-count" className="text-xs">
              {countCommentBodyCharacters(action.body)} / {MAX_COMMENT_BODY_CHARACTERS} characters
              {!valid && ' · Enter nonblank text within the limit.'}
            </p>
          </div>
        )}
        {action?.kind === 'delete' && (
          <p className="break-words whitespace-pre-wrap">{action.resource.body}</p>
        )}
        {snapshot.error && (
          <p role="alert" className="text-destructive">
            {snapshot.error}
          </p>
        )}
        {current && (
          <section className="grid gap-2 rounded-lg border p-3" aria-label="Current server content">
            <h3 className="font-semibold">Current server version: {current.value.version}</h3>
            {current.kind === 'comment' ? (
              <>
                <p className="text-xs">
                  {current.value.author.name}
                  {current.value.deletedAt && ' · Deleted'}
                  {current.value.editedAt && ' · Edited'}
                </p>
                <p className="break-words whitespace-pre-wrap">{current.value.body}</p>
              </>
            ) : (
              <p>
                {current.value.resolvedAt
                  ? `Resolved by ${current.value.resolvedBy?.name ?? 'a member'}`
                  : 'Unresolved'}
              </p>
            )}
            {deleted && <p>This message is deleted. Its marker cannot be edited or restored.</p>}
          </section>
        )}
        {busy && (
          <p role="status">
            {snapshot.phase === 'sending' ? 'Sending change…' : 'Fetching current content…'}
          </p>
        )}
        <DialogFooter className="flex-wrap [&>button]:h-auto [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:whitespace-normal">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => controller.cancel()}
          >
            Cancel and retain draft
          </Button>
          {snapshot.phase === 'draft' && (
            <Button
              type="button"
              disabled={!writable || !valid || busy}
              onClick={() => void controller.submit()}
            >
              {action?.kind === 'delete'
                ? 'Confirm deletion'
                : action?.kind === 'resolve'
                  ? 'Confirm state change'
                  : 'Save edit'}
            </Button>
          )}
          {snapshot.phase === 'review' && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !readable}
                onClick={() => void controller.review()}
              >
                Refresh current content
              </Button>
              {current && (
                <Button
                  type="button"
                  disabled={!writable || !valid || deleted || busy}
                  onClick={() => void controller.retryReviewed()}
                >
                  Retry after review against version {current.value.version}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
