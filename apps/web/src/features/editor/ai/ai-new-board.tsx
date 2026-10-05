import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  importBoardSchema,
  importBoardResponseSchema,
  MAX_BOARD_TITLE_CHARACTERS,
} from '@archboard/contracts';
import { capturePortableEnvelope } from '@archboard/export';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { boardListQueryKey } from '@/features/boards/board-resource-refresh';
import { usePortabilityScope } from '@/features/editor/portability/use-portability-scope';
import { usePortableCreation } from '@/features/editor/portability/use-portable-creation';
import {
  PortableSubmission,
  isNewPrivateBoard,
} from '@/features/editor/portability/portability-policy';
import { CreationFeedback } from '@/features/editor/portability/creation-feedback';
import { inspectVisibleBoards } from '@/features/editor/portability/inspect-boards';
import { type AiApplyJournal } from './ai-apply-intent';
import type { AiDiagramDraft } from './ai-diagram-draft';

export function AiNewBoard({
  accountId,
  boardId,
  runId,
  journal,
  draft,
  allowed,
}: {
  readonly accountId: string;
  readonly boardId: string;
  readonly runId: string;
  readonly journal: AiApplyJournal;
  readonly draft: Pick<AiDiagramDraft, 'graph' | 'ids'>;
  readonly allowed: () => boolean;
}) {
  const scope = usePortabilityScope(accountId, boardId);
  const navigate = useNavigate();
  const [title, setTitle] = useState('Generated architecture');
  const [results, setResults] = useState<string[]>([]);
  const [created, setCreated] = useState(() => journal.get(runId)?.newBoardId);
  const recovery = useMemo(
    () => ({
      allowed,
      read: () => {
        const record = journal.get(runId);
        if (record?.newBoardId) throw new Error('A board was already created from this proposal.');
        const saved = record?.import;
        if (!saved) return null;
        const restored = new PortableSubmission(
          saved.key,
          JSON.parse(saved.json ?? '{}'),
          saved.startedAt,
        );
        restored.state = saved.state;
        return restored;
      },
      write: (intent: PortableSubmission | null) => {
        if (intent) journal.prepare(runId, draft.ids);
        journal.saveImport(
          runId,
          intent
            ? {
                key: intent.key,
                json: intent.json,
                startedAt: intent.startedAt,
                state: intent.state,
              }
            : undefined,
        );
      },
    }),
    [journal, runId, draft, allowed],
  );
  const creation = usePortableCreation(
    scope,
    '/imports',
    importBoardResponseSchema.refine((result) =>
      isNewPrivateBoard(result.data, accountId, boardId),
    ),
    (result) => {
      journal.saveImport(runId, undefined, result.data.id);
      setCreated(result.data.id);
      void scope.client.invalidateQueries({ queryKey: boardListQueryKey(scope.origin, accountId) });
      void navigate({ to: '/boards/$boardId', params: { boardId: result.data.id } });
    },
    async () => {
      setResults(await inspectVisibleBoards(scope));
    },
    recovery,
  );
  if (created)
    return (
      <p role="status" className="break-all text-sm">
        New board creation confirmed: {created}.
      </p>
    );
  return (
    <section className="grid gap-2" aria-label="Create generated private board">
      <Label htmlFor="ai-new-board-title">New private board title</Label>
      <Input
        id="ai-new-board-title"
        maxLength={MAX_BOARD_TITLE_CHARACTERS}
        value={title}
        disabled={creation.busy || !!creation.intent}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={
          !scope.readable ||
          !allowed() ||
          creation.busy ||
          (!!creation.intent && !creation.intent.retryable(Date.now()))
        }
        onClick={() =>
          void creation.submit(() => {
            if (!allowed()) throw new Error('Proposal access or content has expired.');
            return importBoardSchema.parse({
              title,
              file: capturePortableEnvelope(
                {
                  exportedAt: new Date().toISOString(),
                  board: { title, description: '' },
                  graph: draft.graph,
                },
                {
                  online: false,
                  authoritative: false,
                  persistencePending: true,
                  outboxPending: true,
                  acknowledged: false,
                },
              ),
            });
          })
        }
      >
        {creation.busy
          ? 'Creating…'
          : creation.intent
            ? 'Recover identical new-board request'
            : 'Create as a new private board'}
      </Button>
      <CreationFeedback {...creation} persisted />
      {results.map((result) => (
        <p key={result} className="break-all text-xs">
          {result}
        </p>
      ))}
    </section>
  );
}
