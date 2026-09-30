import { useRef, useState, type FormEvent } from 'react';
import {
  MAX_BOARD_DESCRIPTION_CHARACTERS,
  MAX_BOARD_TITLE_CHARACTERS,
  boardTitleSchema,
  boardDescriptionSchema,
  type BoardSummary,
} from '@archboard/contracts';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/platform/api';

import { submitBoardAction, type BoardAction } from './board-api';

const ACTION_LABELS: Record<BoardAction, string> = {
  create: 'Create board',
  edit: 'Edit board',
  archive: 'Archive board',
  restore: 'Restore board',
  duplicate: 'Duplicate board',
};

interface BoardDialogProps {
  action: BoardAction;
  board: BoardSummary | null;
  onClose: () => void;
  onSuccess: (action: BoardAction, title: string) => void;
  onConflict: (id: string) => Promise<BoardSummary>;
  returnFocus: HTMLElement | null;
}

export function BoardDialog({
  action,
  board,
  onClose,
  onSuccess,
  onConflict,
  returnFocus,
}: BoardDialogProps) {
  const [title, setTitle] = useState(
    action === 'duplicate' ? `${board?.title ?? ''} copy` : (board?.title ?? ''),
  );
  const [description, setDescription] = useState(board?.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  // A mounted dialog represents one user intent. A failed request keeps this key for a safe retry.
  const idempotency = useRef({ key: crypto.randomUUID(), request: '' });
  const editsText = action === 'create' || action === 'edit' || action === 'duplicate';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (editsText && action !== 'create' && !boardTitleSchema.safeParse(title).success) {
      setError(`Enter a title between 1 and ${MAX_BOARD_TITLE_CHARACTERS} characters.`);
      return;
    }
    if (editsText && !boardDescriptionSchema.safeParse(description).success) {
      setError(`Description must be at most ${MAX_BOARD_DESCRIPTION_CHARACTERS} characters.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = JSON.stringify({
        action,
        boardId: board?.id,
        title: title.trim(),
        description,
      });
      if (idempotency.current.request && idempotency.current.request !== request) {
        idempotency.current.key = crypto.randomUUID();
      }
      idempotency.current.request = request;
      const result = await submitBoardAction(
        action,
        board,
        title,
        description,
        idempotency.current.key,
      );
      onSuccess(action, result.title);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.code === 'VERSION_CONFLICT') {
        setConflicted(true);
        try {
          const latest = await onConflict(board?.id ?? '');
          setError(
            `This board changed. Current title: ${latest.title}. Close and reopen to review the latest details.`,
          );
        } catch {
          setError('This board changed. Close and reopen after refreshing the board list.');
        }
      } else if (failure instanceof ApiClientError && failure.kind === 'network') {
        setError('The network is unavailable. Check your connection and retry this action.');
      } else {
        setError(
          failure instanceof Error ? failure.message : 'This action could not be completed.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus();
          }
        }}
        showCloseButton={!busy}
        className={editsText ? 'sm:max-w-lg' : 'sm:max-w-md'}
      >
        <form
          onSubmit={(event) => void submit(event)}
          className="grid gap-6"
          aria-describedby={error ? 'board-action-error' : undefined}
        >
          <DialogHeader>
            <DialogTitle>{ACTION_LABELS[action]}</DialogTitle>
            <DialogDescription>
              {action === 'duplicate'
                ? 'Copies the committed server version into a new private board. Local demo changes are not included.'
                : action === 'archive'
                  ? 'The board will move to Archived boards. Its content and access remain intact.'
                  : action === 'restore'
                    ? 'The board will return to Active boards.'
                    : action === 'create'
                      ? 'Create a blank private board. Leave the title empty to use the default.'
                      : 'Change the board title or description.'}
            </DialogDescription>
          </DialogHeader>
          {editsText ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="board-title">Title</Label>
                <Input
                  id="board-title"
                  autoFocus
                  value={title}
                  maxLength={MAX_BOARD_TITLE_CHARACTERS}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              {action !== 'duplicate' ? (
                <div className="grid gap-2">
                  <Label htmlFor="board-description">Description (optional)</Label>
                  <Textarea
                    id="board-description"
                    value={description}
                    maxLength={MAX_BOARD_DESCRIPTION_CHARACTERS}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p id="board-action-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || conflicted}
              variant={action === 'archive' ? 'destructive' : 'default'}
            >
              {busy ? 'Working…' : ACTION_LABELS[action]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
