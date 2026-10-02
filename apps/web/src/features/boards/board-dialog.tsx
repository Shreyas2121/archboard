import { useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import {
  MAX_BOARD_DESCRIPTION_CHARACTERS,
  MAX_BOARD_TITLE_CHARACTERS,
  boardTitleSchema,
  boardDescriptionSchema,
  boardDetailResponseSchema,
  createTemplateBoardSchema,
  templateIdSchema,
  duplicateBoardSchema,
  type BoardSummary,
} from '@archboard/contracts';

import { TEMPLATE_CHOICES } from '@archboard/fixtures';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { DEFAULT_NEW_BOARD_TITLE } from './board-api';
import { usePortabilityScope } from '@/features/editor/portability/use-portability-scope';
import { usePortableCreation } from '@/features/editor/portability/use-portable-creation';
import { CreationFeedback } from '@/features/editor/portability/creation-feedback';
import { inspectVisibleBoards } from '@/features/editor/portability/inspect-boards';
import { isNewPrivateBoard } from '@/features/editor/portability/portability-policy';

const ACTION_LABELS: Record<BoardAction, string> = {
  create: 'Create board',
  edit: 'Edit board',
  archive: 'Archive board',
  restore: 'Restore board',
  duplicate: 'Duplicate board',
};

interface BoardDialogProps {
  accountId: string;
  action: BoardAction;
  board: BoardSummary | null;
  onClose: () => void;
  onSuccess: (action: BoardAction, title: string) => void;
  onConflict: (id: string) => Promise<BoardSummary>;
  returnFocus: HTMLElement | null;
}

export function BoardDialog({
  accountId,
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
  const [template, setTemplate] = useState('blank');
  const [description, setDescription] = useState(board?.description ?? '');
  const [error, setError] = useState('');
  const [mutationBusy, setBusy] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [sourceSelected, setSourceSelected] = useState(false);
  const [reviewedBoards, setReviewedBoards] = useState<string[]>([]);
  const scope = usePortabilityScope(accountId, board?.id ?? 'create');
  const creation = usePortableCreation(
    scope,
    action === 'duplicate' ? `/boards/${board?.id ?? ''}/duplicate` : '/boards',
    boardDetailResponseSchema.refine(
      (result) =>
        isNewPrivateBoard(result.data, accountId, board?.id) && result.data.memberCount === 1,
    ),
    (result) => onSuccess(action, result.data.title),
    async () => setReviewedBoards(await inspectVisibleBoards(scope)),
  );
  const creates = action === 'create' || action === 'duplicate';
  const busy = mutationBusy || creation.busy;
  const locked = creates && creation.intent !== null;
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
    if (creates) {
      if (action === 'duplicate' && !sourceSelected) return;
      setError('');
      await creation.submit(() =>
        action === 'duplicate'
          ? duplicateBoardSchema.parse({ title })
          : createTemplateBoardSchema.parse({
              title: title.trim() || DEFAULT_NEW_BOARD_TITLE,
              description,
              ...(template === 'blank' ? {} : { templateId: templateIdSchema.parse(template) }),
            }),
      );
      return;
    }
    const token = scope.capture();
    setBusy(true);
    setError('');
    try {
      await scope.authenticate();
      if (!scope.accepts(token)) return;
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
      if (scope.accepts(token)) onSuccess(action, result.title);
    } catch (failure) {
      if (!scope.accepts(token)) return;
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
        if (!open && !busy && !locked) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus();
          }
        }}
        showCloseButton={!busy && !locked}
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
                ? 'Copies committed server content into a new private board. Unsynchronized local edits are excluded. Open the source board to wait for acknowledgment or download local JSON, then import it.'
                : action === 'archive'
                  ? 'The board will move to Archived boards. Its content and access remain intact.'
                  : action === 'restore'
                    ? 'The board will return to Active boards.'
                    : action === 'create'
                      ? 'Create a private board from a blank canvas or a bundled template. Online sign-in is required. Leave the title empty to use the default.'
                      : 'Change the board title or description.'}
            </DialogDescription>
          </DialogHeader>
          {action === 'create' && (
            <div className="grid gap-2">
              <Label htmlFor="board-template">Starting content</Label>
              <Select value={template} onValueChange={setTemplate} disabled={busy || locked}>
                <SelectTrigger id="board-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Blank board</SelectItem>
                  {TEMPLATE_CHOICES.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {template === 'blank'
                  ? 'An empty canvas with no objects or steps.'
                  : TEMPLATE_CHOICES.find((choice) => choice.id === template)?.description}
              </p>
              {!scope.online && <p role="status">Reconnect to create a board.</p>}
            </div>
          )}
          {action === 'duplicate' && (
            <div className="grid gap-2">
              {board && (
                <Link to="/boards/$boardId" params={{ boardId: board.id }} className="underline">
                  Open source to synchronize or download local JSON
                </Link>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy || locked}
                onClick={() => setSourceSelected(true)}
              >
                Use committed server content, excluding pending edits
              </Button>
            </div>
          )}
          {editsText ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="board-title">Title</Label>
                <Input
                  id="board-title"
                  autoFocus
                  value={title}
                  disabled={busy || locked}
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
                    disabled={busy || locked}
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
          {creates && <CreationFeedback {...creation} />}
          {!!reviewedBoards.length && (
            <details>
              <summary>Reviewed visible boards; matching titles are not receipt proof</summary>
              {reviewedBoards.map((row) => (
                <p key={row}>{row}</p>
              ))}
            </details>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy || locked} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                conflicted ||
                !scope.readable ||
                (action === 'duplicate' && !sourceSelected) ||
                (locked && !creation.intent?.retryable(Date.now()))
              }
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
